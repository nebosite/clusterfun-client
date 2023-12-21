import { ITypeHelper, ISessionHelper, ITelemetryLogger, 
    IStorage, EventThing, 
    BaseAnimationController, BruteForceSerializer
} from "../../libs";

import { action, observable } from "mobx";
import Logger from "js-logger";
import ClusterfunListener from "libs/messaging/ClusterfunListener";
import MessageEndpoint from "libs/messaging/MessageEndpoint";

// Finalizer to track whether models have been properly cleared
// Remove when debugging makes us confident of this
const debug_model_finalizer = new FinalizationRegistry((name) => {
    Logger.info(`Model with ${name} successfully garbage collected`);
})


const GAMESTATE_LABEL = "game_state";
const STASH_LABEL = "__stash_game_state";

export enum GeneralGameState 
{
    Unknown = "Unknown",
    Instructions = "Instructions",
    Playing = "Playing",
    Paused = "Paused",
    GameOver = "GameOver",
    Destroyed = "Destroyed"
}

// -------------------------------------------------------------------
// get the saved game if available or create a new one
// -------------------------------------------------------------------
export function instantiateGame<T extends BaseGameModel>(typeHelper: ITypeHelper, logger: ITelemetryLogger, storage: IStorage)
{
    const serializer = createSerializer(typeHelper);

    try {
        const savedDataJson = storage.get(GAMESTATE_LABEL);
        if (savedDataJson) {
            const savedData = serializer.parse<BaseGameModel>(savedDataJson);
            if(savedData.gameState !== GeneralGameState.Destroyed)
            {
                Logger.info(`Found a saved game (${savedDataJson.length} bytes).  Resuming ...`)
                savedData.serializer = serializer;
                return savedData;
            }
            else {
                Logger.info(`Saved game state was 'destroyed'.  Going with new game.`)
            } 
        }
    } 
    catch(err) 
    {
        logger.logEvent("Error", "Failed Game Restore", (err as any).message )
        Logger.error(`getSavedGame: Could not restore game because: `, err);
    }

    const gameTypeName = typeHelper.rootTypeName;
    let returnMe: T | undefined;

    returnMe = typeHelper.constructType(gameTypeName) as T;
    Logger.info(`Creating fresh ${gameTypeName}.  State is ${returnMe?.gameState}`)
    if(!returnMe) throw Error(`Unable to construct ${gameTypeName}`)

    returnMe.serializer = serializer;
    return returnMe!;
}

// -------------------------------------------------------------------
// Create a serializer
// -------------------------------------------------------------------
function createSerializer(typeHelper: ITypeHelper)
{
    const deepTypeHelper: ITypeHelper = {
        rootTypeName: "na",
        getTypeName(o: object): string {
            if (o.constructor === Object) return "Object";
            if (o instanceof Map) return "Map";
            if (o instanceof Set) return "Set";
            const typeName = typeHelper.getTypeName(o);
            if (!typeName) {
                throw Error(`Object with constructor ${o.constructor.name} not added to getTypeName`);
            }
            return typeName;
        },
        constructType(typeName: string) {
            const output = typeHelper.constructType(typeName);
            if(!output) {
                throw Error(`Could not construct type: ${typeName}`)
            }
            return output;
        },
        shouldStringify(typeName: string, propertyName: string, object: any)
        {
            if(object === undefined || object === null) return false;

            // Some of the state on the base game model should not get serialized since
            // it is transitory information
            if(object instanceof BaseGameModel)
            {
                switch(propertyName)
                {
                    case "_scheduledEvents":
                    case "_messageListeners":
                    case "_events":
                    case "_ticker":
                    case "_isCheckpointing":
                    case "_lastCheckpointTime":
                    case "_isShutdown":
                    case "telemetryLogger":
                    case "onTick":
                    case "serializer":
                    case "session":
                    case "storage":
                        return false;
                }

            }
            
            return typeHelper.shouldStringify(typeName, propertyName, object);
        } ,
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
        {
            return typeHelper.reconstitute(typeName, propertyName, rehydratedObject);
        }
     
    }
    return new BruteForceSerializer(deepTypeHelper);
}

// -------------------------------------------------------------------
// Handle basic operations for any game instance, client or presenter
// -------------------------------------------------------------------
export abstract class BaseGameModel  {
    name: string;
    @observable  private _gameTime_ms = 0
    get gameTime_ms() {return this._gameTime_ms}
    set gameTime_ms(value) {action(()=>{this._gameTime_ms = value})()}
    
    fastRunMultiplier = 32.0;
    tickInterval_ms = 33;
    checkpointInternvalMin_ms = 500;  // Don't try to save checkpoints more frequently than this

    @observable private _gameState: string = GeneralGameState.Unknown;
    get gameState() {return this._gameState}
    set gameState(value: string) {
        if(value === GeneralGameState.Unknown) {
            throw Error("Attempting to set game state to 'unknown'")
        }
        Logger.info(`${this.name} state set to ${value}`)
        if(this._gameState === GeneralGameState.Destroyed) {
            Logger.warn(`WEIRD: Attempted to set destroyed ${this.name} to ${value}`)
        }
        else {
            action(()=>{
                this._gameState = value;
                this.devFast = false;
            })()
            this.invokeEvent(value);
        }
    }

    get roomId() {return this.session.roomId;}
    // Pause the game in development mode
    @observable _devPause = false;
    public get devPause() { return this._devPause;}
    public set devPause(value: boolean) { action(()=>{this._devPause = value;})() }

    // Turbo game speed in development mode 
    @observable _devFast = false;
    public get devFast() { return this._devFast;}
    public set devFast(value: boolean) { action(()=>{this._devFast = value;})() }

    public session: ISessionHelper;
    protected telemetryLogger: ITelemetryLogger;
    protected storage: IStorage;

    public onTick = new EventThing<number>("BaseGameModel");
    private _scheduledEvents: Map<number, Array<() => void>>;
    private _messageListeners: ClusterfunListener<unknown, unknown>[] = [];
    
    private _isShutdown = false;
    public get isShutdown() { return this._isShutdown; }

    

    //private _deserializeHelper: (propertyName: string, data: any) => any
    private _events = new Map<string, EventThing<any>>();
    private _ticker?: NodeJS.Timeout;
    serializer?: BruteForceSerializer
    private _isCheckpointing = false;
    private _lastCheckpointTime = 0;
    private _isLoading = false;

    // -------------------------------------------------------------------
    // ctor
    //
    // deserializeHelper - use this for special serialization.  It transforms
    //                      data into the correct form (e.g. when serializing
    //                      to a class with functions).  Return null for items
    //                      that should not be deserialized.
    // -------------------------------------------------------------------
    constructor(
        name: string,
        sessionHelper: ISessionHelper, 
        logger: ITelemetryLogger, 
        storage: IStorage
        )
    {
        this.name = name;
        this.telemetryLogger = logger;
        this.session = sessionHelper;
        this.storage = storage;

        this._scheduledEvents = new Map<number, Array<() => void>>();
        debug_model_finalizer.register(this, this.name);
    }

    // This method is called after loading a saved game from memory.  Here is 
    // where to hook up stuff the serialize couldn't get back
    reconstitute():void {
        this.session.addClosedListener(this, code => this.onSessionClosed(code));
   
        // Set up a regular ticker to drive scheduled events and animations
        let timeOfLastTick = Date.now();
        this._ticker = setInterval(() => {
            const now = Date.now();
            this.tick(now - timeOfLastTick);
            timeOfLastTick = now;
        }, this.tickInterval_ms );

        this.telemetryLogger.logPageView(this.name);
    }

    // -------------------------------------------------------------------
    //  quitApp
    // -------------------------------------------------------------------
    quitApp = () => {
        Logger.info("Quitting the app")
        this.gameState = GeneralGameState.Destroyed;
        this.storage.remove(GAMESTATE_LABEL);
        this.shutdown();
    }

    // -------------------------------------------------------------------
    //  shutdown - Shut down the model without destroying saved state
    // -------------------------------------------------------------------
    shutdown = () => {
        Logger.info("Shutting down model");
        if (this._ticker) {
            clearInterval(this._ticker);
        }
        for (const listener of this._messageListeners) {
            listener.unsubscribe();
        }
        this._messageListeners = [];
        this.session.removeClosedListener(this);
        this._events.clear();
        this._scheduledEvents.clear();
        this._isShutdown = true;
    }

    // -------------------------------------------------------------------
    // onSessionClosed
    // -------------------------------------------------------------------
    protected onSessionClosed(code: number) {
        Logger.info("Session was closed with code: " + code);
        const CLOSECODE_PAGEREFRESH = 1001
        const CLOSECODE_PLEASERETRY = 1013

        // The game is really over only if the server is shutting us down
        if (code !== CLOSECODE_PAGEREFRESH 
            && code !== CLOSECODE_PLEASERETRY) {
            this.clearCheckpoint();
            this.quitApp();
        }
    }

    // -------------------------------------------------------------------
    //  subscribe to an event
    // -------------------------------------------------------------------
    subscribe(event: string, subscriptionId: string, callback: (...args: any[])=>void) {
        if(!this._events.has(event)) {
            this._events.set(event, new EventThing<any>(this.name));
        }

        this._events!.get(event)!.subscribe(subscriptionId, callback);
    }

    // -------------------------------------------------------------------
    // invokeEvent - force an event to trigger
    // -------------------------------------------------------------------
    invokeEvent(event: string, ...args: any[]) {
        const eventFunction = this._events.get(event);
        return new Promise<void>(resolve => {
            setTimeout(() => {
                eventFunction?.invoke(...args);
                resolve();
            },1)            
        })
    }

    private _lastCheckpointFinishTime = Date.now();

    // -------------------------------------------------------------------
    // export class properties to JSON in storage
    // -------------------------------------------------------------------
    saveCheckpoint() {
        if(this.gameState === GeneralGameState.Destroyed) return;
        if(this._isLoading) { return; }

        if(this._isCheckpointing) {
            const timeSinceLastSuccess = Date.now() - this._lastCheckpointFinishTime;
            if(timeSinceLastSuccess > 3000) {
                Logger.warn(`WEIRD: Last checkpoint did not appear to finish.  Took ${(timeSinceLastSuccess/1000).toFixed(1)} seconds`)
                this._isCheckpointing = false;
            }
            else {
                return;
            }
        }

        if(this.serializer)
        {
            this._isCheckpointing = true;
            const timeSinceLastCheckpoint = Date.now() - this._lastCheckpointTime;
            let delay = this.checkpointInternvalMin_ms - timeSinceLastCheckpoint;
            if(delay < 0) delay = 0;


            setTimeout(()=> {
                const jsonToSave = this.serializer!.stringify(this);
                Logger.info(`Saving checkpoint (${jsonToSave.length} bytes)`)
                if(this.gameState !== GeneralGameState.Destroyed) {
                    this.storage.set(GAMESTATE_LABEL, jsonToSave)
                }
                this._isCheckpointing = false;
                this._lastCheckpointTime = Date.now();
                this._lastCheckpointFinishTime = Date.now();
            },delay);
        }
        else {
            Logger.warn(`WEIRD: No serializer??`)
        }
    }

    // -------------------------------------------------------------------
    // clearCheckpoint
    // -------------------------------------------------------------------
    clearCheckpoint() {
        this.storage.set(GAMESTATE_LABEL, "")
    }

    // -------------------------------------------------------------------
    // put the checkpoint in a place where we can pull it back if needed
    // THis is for clients that accidentally disconnect.  On reconnet,
    // they will unstash the checkpoint
    // -------------------------------------------------------------------
    stashCheckpoint() {

        const checkpoint = this.storage.get(GAMESTATE_LABEL)
        if(checkpoint) {
            Logger.info("************** STASHING  " + this.session.personalId)
            this.storage.set(STASH_LABEL, checkpoint);
            this.storage.set(GAMESTATE_LABEL, "");
        }
    }

    // -------------------------------------------------------------------
    // restore the checkpoint from the stash if it exists
    // -------------------------------------------------------------------
    unStashCheckpoint() {

        const checkpoint = this.storage.get(STASH_LABEL)
        if(checkpoint) {
            Logger.info("************** UNSTASHING  " + this.session.personalId)
            this.storage.set(GAMESTATE_LABEL, checkpoint);
            this.storage.set(STASH_LABEL, "");
        }
    }

    private _animationCurrentId = 0;
    // -------------------------------------------------------------------
    // registerAnimation
    // -------------------------------------------------------------------
    public registerAnimation = (controller: BaseAnimationController) => {
        const tag = `anim${this._animationCurrentId++}`;
        this.onTick.subscribe(tag, (t) => {
            controller.handleFrame(t)
            if(controller.sequenceFinished && controller.animationsFinished) this.onTick.unsubscribe(tag);
        });  
    }
    
    // -------------------------------------------------------------------
    // tick
    // -------------------------------------------------------------------
    public tick = (milliseconds: number) => {
        if(this.devPause || this.gameState === GeneralGameState.Paused)  return;

        if(this.gameState === GeneralGameState.Destroyed) 
        {
            clearInterval(this._ticker);
            return;
        } 

        const adjustedInterval = milliseconds * (this.devFast ? this.fastRunMultiplier : 1.0);
        this.gameTime_ms += adjustedInterval;

        // gather up events that should have been triggered
        const scheduledTimesPassed = [];    
        for (const scheduledTime of this._scheduledEvents.keys()) {
            if (this.gameTime_ms > scheduledTime) {
                scheduledTimesPassed.push(scheduledTime);
            }
        }
        scheduledTimesPassed.sort((a, b) => a - b);

        // harvest passed events from the event queue
        const eventsToRun = [];
        for (const scheduledTime of scheduledTimesPassed) {
            for (const event of this._scheduledEvents.get(scheduledTime) ?? []) {
                eventsToRun.push(event);
            }
            this._scheduledEvents.delete(scheduledTime);
        }

        eventsToRun.forEach(e => e());

        this.onTick.invoke(this.gameTime_ms);
    }

    // -------------------------------------------------------------------
    // return a promise that goes off after x game time milliseconds
    // ------------------------------------------------------------------- 
    protected waitForGameTime(ms: number): Promise<void> {
        return new Promise((resolve, _reject) => {
            this.scheduleEvent(this.gameTime_ms + ms, resolve)
        })
    }

    // -------------------------------------------------------------------
    // return a promise that goes off after x real time milliseconds
    // ------------------------------------------------------------------- 
    protected waitForRealTime(ms: number): Promise<void> {
        return new Promise((resolve, _reject) => {
            setTimeout(resolve, ms);
        })
    }

    // -------------------------------------------------------------------
    // Create a request listener, registering it for removal when the
    // model is shut down
    // ------------------------------------------------------------------- 
    protected listenToEndpoint<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>,
        apiCallback: (sender: string, request: REQUEST) => RESPONSE | PromiseLike<RESPONSE>) {
        const listener = this.session.listen(endpoint, apiCallback);
        this._messageListeners.push(listener as ClusterfunListener<unknown, unknown>);
        return listener;
    }

    // -------------------------------------------------------------------
    // Create a request listener specifically for a presenter - a request
    // from any other caller has an error thrown back at it
    // ------------------------------------------------------------------- 
    protected listenToEndpointFromPresenter<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>,
        apiCallback: (request: REQUEST) => RESPONSE | PromiseLike<RESPONSE>) {
        const listener = this.session.listenPresenter(endpoint, apiCallback);
        this._messageListeners.push(listener as ClusterfunListener<unknown, unknown>);
        return listener;
    }

    // -------------------------------------------------------------------
    // scheduleEvent
    // -------------------------------------------------------------------
    protected scheduleEvent(time: number, event: () => void) {
        if (!this._scheduledEvents.has(time)) {
            this._scheduledEvents.set(time, new Array<() => void>());
        }
        this._scheduledEvents.get(time)!.push(event);
    }

    // -------------------------------------------------------------------
    //  randomInt
    // -------------------------------------------------------------------
    randomInt(max: number)
    {
        return Math.floor(Math.random() * max);
    }

    // -------------------------------------------------------------------
    //  randomDouble
    // -------------------------------------------------------------------
    randomDouble(max: number)
    {
        return Math.random() * max;
    }

    // -------------------------------------------------------------------
    //  randomItem
    // -------------------------------------------------------------------
    randomItem<T>(items: T[])
    {
        return items[this.randomInt(items.length)]
    }
}
