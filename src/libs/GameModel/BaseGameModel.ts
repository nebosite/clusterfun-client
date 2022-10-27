import { ClusterFunGameProps, ITypeHelper, ISessionHelper, ITelemetryLogger, 
    IStorage, EventThing, ClusterFunMessageBase, ClusterFunMessageConstructor, 
    BaseAnimationController, ClusterFunReceiptAckMessage, BruteForceSerializer
} from "../../libs";

import { action, makeObservable, observable } from "mobx";


const GAMESTATE_LABEL = "game_state";
const STASH_LABEL = "__stash_game_state";

export enum GeneralGameState 
{
    Unknown = "Unknown",
    Paused = "Paused",
    GameOver = "GameOver",
    Destroyed = "Destroyed"
}

// -------------------------------------------------------------------
// get the saved game if available or create a new one
// -------------------------------------------------------------------
export function instantiateGame<T extends BaseGameModel>(typeHelper: ITypeHelper)
{
    const serializer = createSerializer(typeHelper);
    const gameTypeName = typeHelper.rootTypeName;
    let returnMe: T | undefined;

    returnMe = typeHelper.constructType(gameTypeName) as T;
    console.info(`Creating fresh ${gameTypeName}.  State is ${returnMe?.gameState}`)
    if(!returnMe) throw Error(`Unable to construct ${gameTypeName}`)

    returnMe.serializer = serializer;
    return returnMe!;
}

// -------------------------------------------------------------------
// Create a serializer
// -------------------------------------------------------------------
function createSerializer(typeHelper: ITypeHelper)
{
    const deepTypeHelper = {
        rootTypeName: "na",
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
                    case "_events":
                    case "_ticker":
                    case "_isCheckpointing":
                    case "_lastCheckpointTime":
                    case "logger":
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
        console.info(`${this.name} state set to ${value}`)
        if(this._gameState === GeneralGameState.Destroyed) {
            console.warn(`WEIRD: Attempted to set destroyed ${this.name} to ${value}`)
        }
        else {
            action(()=>{
                this._gameState = value;
                this.devFast = false;
            })()
            this.invokeEvent(value);
            this.saveCheckpoint();       
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

    protected session: ISessionHelper;
    protected telemetryLogger: ITelemetryLogger;
    protected storage: IStorage;

    public onTick = new EventThing<number>("BaseGameModel");
    private _scheduledEvents: Map<number, Array<() => void>>;

    //private _deserializeHelper: (propertyName: string, data: any) => any
    private _events = new Map<string, EventThing<any>>();
    private _ticker: NodeJS.Timeout;
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
        makeObservable(this);
        this.name = name;
        this.telemetryLogger = logger;
        this.session = sessionHelper;
        this.storage = storage;

        this._scheduledEvents = new Map<number, Array<() => void>>();
        this.session.addClosedListener(code => this.onSessionClosed(code));
   
        // Set up a regular ticker to drive scheduled events and animations
        let timeOfLastTick = Date.now();
        this._ticker = setInterval(() => {
            const now = Date.now();
            this.tick(now - timeOfLastTick);
            timeOfLastTick = now;
        }, this.tickInterval_ms );

        this.telemetryLogger.logPageView(name);
    }

    // -------------------------------------------------------------------
    // get the saved game if available or create a new one
    // -------------------------------------------------------------------
    tryLoadOldGame(gameProps: ClusterFunGameProps)
    {
        if(!this.serializer) throw Error("No serializer in tryLoadOldGame")
        this._isLoading =true;

        // Do this async so that we don't trip state dependencies during construction
        setTimeout(()=>{
            try {
                const savedDataJson = gameProps.storage.get(GAMESTATE_LABEL);
                if(savedDataJson) {
                    const savedData = this.serializer!.parse<BaseGameModel>(savedDataJson);
                    if(savedData.gameState !== GeneralGameState.Destroyed)
                    {
                        console.info("Found a saved game.  Resuming ...")
                        action(()=>{
                            Object.assign(this, savedData)
                            this.reconstitute();                          
                        })()        
                    }
                    else {
                        console.info(`Saved game state was 'destroyed'.  Going with new game.`)
                    } 
                }      
            }
            catch(err) 
            {
                gameProps.logger.logEvent("Error", "Failed Game Restore", (err as any).message )
                console.error("getSavedGame: Could not restore game because: " + err);
            }
            this._isLoading = false;
        },50)

    }


    // This method is called after loading a saved game from memory.  Here is 
    // where to hook up stuff the serialize couldn't get back
    abstract reconstitute():void

    // -------------------------------------------------------------------
    //  quitApp
    // -------------------------------------------------------------------
    quitApp = () => {
        console.info("Quitting the app")
        this.gameState = GeneralGameState.Destroyed;
        clearInterval(this._ticker);
        this.storage.remove(GAMESTATE_LABEL);
    }

    // -------------------------------------------------------------------
    // onSessionClosed
    // -------------------------------------------------------------------
    protected onSessionClosed(code: number) {
        console.info("Session was closed with code: " + code);
        const CLOSECODE_PAGEREFRESH = 1001
        const CLOSECODE_PLEASERETRY = 1013

        // The game is really over only if the server is shutting us down
        if (code !== CLOSECODE_PAGEREFRESH 
            && code !== CLOSECODE_PLEASERETRY) {
            this.clearCheckpoint();
            this.quitApp();
        } else {
            this.saveCheckpoint();
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
    // addMessageListener - register a listening for a specific clusterfun
    // message type.
    // -------------------------------------------------------------------
    addMessageListener<P, M extends ClusterFunMessageBase>(
        messageClass: ClusterFunMessageConstructor<P, M>, 
        name: string, 
        listener: (message: M) => unknown) {
        this.session.addListener(messageClass, name, listener);
    }

    // -------------------------------------------------------------------
    // invokeEvent - force an event to trigger
    // -------------------------------------------------------------------
    invokeEvent(event: string, ...args: any[]) {
        return new Promise<void>(resolve => {
            setTimeout(() => {
                this._events.get(event)?.invoke(...args);
                resolve();
            },1)            
        })
    }

    // -------------------------------------------------------------------
    // export class properties to JSON in storage
    // -------------------------------------------------------------------
    saveCheckpoint() {
        if(this.gameState === GeneralGameState.Destroyed) return;
        if(this._isLoading) { return; }

        if(this.serializer && !this._isCheckpointing)
        {
            this._isCheckpointing = true;
            const timeSinceLastCheckpoint = Date.now() - this._lastCheckpointTime;
            let delay = this.checkpointInternvalMin_ms - timeSinceLastCheckpoint;
            if(delay < 0) delay = 0;


            setTimeout(()=> {
                const jsonToSave = this.serializer!.stringify(this);
                console.info(`Saving checkpoint (${jsonToSave.length} bytes)`)
                if(this.gameState !== GeneralGameState.Destroyed) {
                    this.storage.set(GAMESTATE_LABEL, jsonToSave)
                }
                this._isCheckpointing = false;
                this._lastCheckpointTime = Date.now();
            },delay);
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
            console.info("************** STASHING  " + this.session.personalId)
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
            console.info("************** UNSTASHING  " + this.session.personalId)
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
    // acknowledge a message
    // ------------------------------------------------------------------- 
    ackMessage(message: ClusterFunMessageBase) {
        this.session.sendMessage(message.sender, new ClusterFunReceiptAckMessage({
            sender: this.session.personalId,
            ackedMessageId: message.messageId ?? 0
        }))
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
