import Logger from "js-logger";
import { parseHeaderOnly } from "libs/comms";

// -------------------------------------------------------------------
// IMessageThing
// -------------------------------------------------------------------
export interface IMessageThing {
    personalId: string;
    personalSecret: string;
    addEventListener: (eventName: string, handler: (event?: any) => void) => void;
    removeEventListener: (eventName: string, handler: (event?: any) => void) => void;
    send: (payload: string, onFailure: ()=>void) => Promise<void>;
    readonly isOpen: boolean;
    readonly isClosed: boolean;
    readonly closeCode: number;
}

export interface IMessageThingReceiver {
    receiveMessage: (payload: string) => void;
}

// -------------------------------------------------------------------
// WebSocketMessageThing
// -------------------------------------------------------------------
export class WebSocketMessageThing implements IMessageThing {
    personalId: string;
    personalSecret: string = "";
    isOpen: boolean = false;
    isClosed: boolean = false;
    closeCode: number = 0;
    private _websocket: WebSocket;

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    constructor(origin: string, roomId: string, personalId: string, personalSecret: string )
    {
        const url = origin + "/talk/" + roomId + "/" + personalId;
        this._websocket = new WebSocket(url, ['Secret' + personalSecret]);
        this.personalId = personalId;
        this.personalSecret = personalSecret;
        this._websocket.addEventListener("open", (ev) => {
            this.isOpen = true;
        });
   
        this._websocket.addEventListener("close", (ev) => {
            this.isClosed = true;
            this.closeCode = ev.code;
        })
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    addEventListener(eventName: string, handler: (event?: any) => void) {
        this._websocket.addEventListener(eventName, handler)
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    removeEventListener(eventName: string, handler: (event?: any) => void) {
        this._websocket.removeEventListener(eventName, handler)
    }


    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    async send(payload: string, onFailure: ()=>void) {
        let retries = 8;
        let backoffTime = 50;

        return new Promise<void>((resolve, reject)=>{
            const delayedSend = () => {
                if(this._websocket.readyState === 1)
                {
                    this._websocket.send(payload);    
                    resolve();  
                }
                else 
                {
                    retries--;
                    if(retries <= 0)
                    {
                        reject("ERROR: out of retries sending " + payload)
                        if(onFailure) onFailure();
                    }
                    else {
                        backoffTime *= 2;
                        Logger.info(`Socket not ready.  Backing off ${backoffTime}ms`)
                        setTimeout(delayedSend,backoffTime);
                    }
                }
            }
            setTimeout(delayedSend,0);

        }) 
    }
}

// -------------------------------------------------------------------
// MessagePortMessageThing
// -------------------------------------------------------------------
export class MessagePortMessageThing implements IMessageThing {
    readonly personalId: string;
    get personalSecret(): string { return "N/A" };
    
    // NOTE: These are not quite correct - it is indeed possible to close
    // a MessagePort. We don't get an event for it, though.
    get isOpen() { return true; }
    get isClosed() { return false; }
    get closeCode() { return 0; }

    private _messagePort: MessagePort;

    constructor(messagePort: MessagePort, personalId: string) {
        this._messagePort = messagePort;
        this.personalId = personalId;
        this._messagePort.start();
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    addEventListener(eventName: string, handler: (event?: any) => void) {
        this._messagePort.addEventListener(eventName, handler)
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    removeEventListener(eventName: string, handler: (event?: any) => void) {
        this._messagePort.removeEventListener(eventName, handler)
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    async send (payload: string, onFailure: () => void) {
        this._messagePort.postMessage(payload);
    }
}

export class MessagePortMessageThingReceiver implements IMessageThingReceiver {
    private _listeners = new Map<string, any[]>();
    private _room: Map<string, IMessageThingReceiver>;
    private _messagePort: MessagePort;
    personalId: string;
    personalSecret: string = "there is no queen of england";

    constructor (messagePort: MessagePort,
        roomInhabitants: Map<string, IMessageThingReceiver>, 
        personalId: string) {
            this._room = roomInhabitants;
            this.personalId = personalId;
            this._messagePort = messagePort;
            this._room.set(personalId, this);

        this._messagePort.addEventListener("message", (event) => {
            const payload = event.data;
            const header = parseHeaderOnly(payload);
            if (header.s !== this.personalId) {
                throw new SyntaxError("Sender of header must match personal ID")
            }

            return new Promise<void>((resolve, reject) => {
                setTimeout(()=> {
                    if(!this._room.has(header.r)) {
                        reject("No recipient with id: " + header.r);
                    } else {
                        this._room.get(header.r)?.receiveMessage(payload)
                        resolve();
                    }
                }, 0)
            })
        })
        this._messagePort.start();
    }
    

    // -------------------------------------------------------------------
    // addEventListener
    // -------------------------------------------------------------------
    addEventListener(eventName: string, handler: (event?: any) => void) {
        if(!this._listeners.has(eventName)) {
            this._listeners.set(eventName, [])
        }
        this._listeners.get(eventName)!.push( handler);
    }

    // -------------------------------------------------------------------
    // removeEventListener
    // -------------------------------------------------------------------
    removeEventListener(eventName: string, handler: (event?: any) => void) {
        if(this._listeners.has(eventName)) {
            const eventListeners = this._listeners.get(eventName)!;
            const index = eventListeners.indexOf(handler);
            if (index !== -1) {
                eventListeners.splice(index, 1);
            }
        }
    }

    receiveMessage(payload: string): void {
        this._messagePort.postMessage(payload);
    }
}

// -------------------------------------------------------------------
// LocalMessageThing
// -------------------------------------------------------------------
export class LocalMessageThing implements IMessageThing, IMessageThingReceiver {
    personalId: string;
    personalSecret: string = "there is no queen of england";
    simulatedMinPingMs: number;
    simulatedMaxPingMs: number;
    get isOpen() { return true; }
    get isClosed() { return false; }
    get closeCode() { return 0; }
    private _listeners = new Map<string, any[]>();
    private _room: Map<string, IMessageThingReceiver>;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(
        roomInhabitants: Map<string, IMessageThingReceiver>, 
        personalId: string, 
        simulatedMinPingMs: number, simulatedMaxPingMs: number)
    {
        this._room = roomInhabitants;
        this.personalId = personalId;
        this._room.set(personalId, this);
        this.simulatedMinPingMs = simulatedMinPingMs;
        this.simulatedMaxPingMs = simulatedMaxPingMs;
    }

    // -------------------------------------------------------------------
    // addEventListener
    // -------------------------------------------------------------------
    addEventListener(eventName: string, handler: (event?: any) => void) {
        if(!this._listeners.has(eventName)) {
            this._listeners.set(eventName, [])
        }
        this._listeners.get(eventName)!.push( handler);
    }

    // -------------------------------------------------------------------
    // addEventListener
    // -------------------------------------------------------------------
    removeEventListener(eventName: string, handler: (event?: any) => void) {
        if(this._listeners.has(eventName)) {
            const eventListeners = this._listeners.get(eventName)!;
            const index = eventListeners.indexOf(handler);
            if (index !== -1) {
                eventListeners.splice(index, 1);
            }
        }
    }

    // -------------------------------------------------------------------
    // send
    // -------------------------------------------------------------------
    async send(payload: string, _onFailure: ()=>void) {
        const header = parseHeaderOnly(payload);
        if (header.s !== this.personalId) {
            throw new SyntaxError("Sender of header must match personal ID")
        }

        return new Promise<void>((resolve, reject) => {
            setTimeout(()=> {
                if(!this._room.has(header.r)) {
                    reject("No recipient with id: " + header.r);
                } else {
                    this._room.get(header.r)?.receiveMessage(payload)
                    resolve();
                }
            }, this.simulatedMinPingMs)
        })

    }

    // -------------------------------------------------------------------
    // receiveMessage
    // -------------------------------------------------------------------
    receiveMessage(message: string){
        const listeners = this._listeners.get("message");
        if(listeners) {
            listeners.forEach(listener => {
                setTimeout(() => { listener({ data: message }); }, Math.random() * (this.simulatedMaxPingMs - this.simulatedMinPingMs));
            })
        }
    }
}

