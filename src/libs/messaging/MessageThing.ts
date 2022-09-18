import { ClusterFunSerializer } from "libs/comms"

// -------------------------------------------------------------------
// IMessageThing
// -------------------------------------------------------------------
export interface IMessageThing {
    personalId: string;
    personalSecret: string;
    addEventListener: (eventName: string, handler: (event?: any) => void) => void;
    send: (payload: string, onFailure: ()=>void) => Promise<void>;
    readonly isOpen: boolean;
    readonly isClosed: boolean;
    readonly closeCode: number;
}

// -------------------------------------------------------------------
// WebSocketMessageThing
// -------------------------------------------------------------------
export class WebSocketMessageThing implements IMessageThing {
    personalId: string;
    personalSecret: string;
    isOpen: boolean = false;
    isClosed: boolean = false;
    closeCode: number = 0;
    private _websocket: WebSocket;

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    constructor(roomId: string, personalId: string, personalSecret: string )
    {
        const url = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + window.location.host + "/talk/" + roomId + "/" + personalId;
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
                        console.log(`Socket not ready.  Backing off ${backoffTime}ms`)
                        setTimeout(delayedSend,backoffTime);
                    }
                }
            }
            setTimeout(delayedSend,0);

        }) 
    }
}


// -------------------------------------------------------------------
// LocalMessageThing
// -------------------------------------------------------------------
export class LocalMessageThing implements IMessageThing {
    personalId: string;
    personalSecret: string;
    get isOpen() { return true; }
    get isClosed() { return false; }
    get closeCode() { return 0; }
    private _listeners = new Map<string, any[]>();
    private _room: Map<string, LocalMessageThing>;
    private _serializer: ClusterFunSerializer;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(roomInhabitants:  Map<string, LocalMessageThing>, playerName: string, personalId: string )
    {
        this._room = roomInhabitants;
        this.personalId = personalId;
        this._room.set(personalId, this);
        this._serializer = new ClusterFunSerializer();
    }

    // -------------------------------------------------------------------
    // addEventListener
    // -------------------------------------------------------------------
    addEventListener(eventName: string, handler: (event?: any) => void) {
        if(!this._listeners.has(eventName)) {
            this._listeners.set(eventName, [])
        }
        this._listeners.get(eventName).push( handler);
    }

    // -------------------------------------------------------------------
    // send
    // -------------------------------------------------------------------
    async send(payload: string, onFailure: ()=>void) {
        const header = this._serializer.deserializeHeaderOnly(payload);
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
            })
        })

    }

    // -------------------------------------------------------------------
    // receiveMessage
    // -------------------------------------------------------------------
    receiveMessage(message: string){
        const listeners = this._listeners.get("message");
        if(listeners) {
            for(const listener of listeners)
            {
                listener({data: message});
            }
        }
    }
}

