import Logger from "js-logger";
import { action, makeAutoObservable } from "mobx";
import { ClusterFunSerializer, ClusterFunMessageConstructor, ClusterFunMessageBase } from "../../libs"
import { IMessageThing } from './MessageThing';

export interface IMessageReceipt
{
    id: number,
    message: ClusterFunMessageBase
}

// -------------------------------------------------------------------
// SessionHelper
// -------------------------------------------------------------------
export interface ISessionHelper {
    readonly roomId: string;
    readonly personalId: string;
    readonly personalSecret: string;
    sendMessage(receiver: string, payload: object): Promise<IMessageReceipt>;
    sendMessageToPresenter(payload: object): Promise<IMessageReceipt>;
    resendMessage(receiver: string, oldMessage: IMessageReceipt): void;
    addListener<P, M extends ClusterFunMessageBase>(
        messageClass: ClusterFunMessageConstructor<P, M>, 
        owner: object, 
        listener: (message: M) => unknown): void;
    addOpenedListener(listener: () => void): void;
    addClosedListener(listener: (code: number) => void): void;
    removeListener<P, M extends ClusterFunMessageBase>(
        messageClass: ClusterFunMessageConstructor<P, M>, 
        owner: object): void;
    removeAllListenersForOwner(owner: object): void;
    onError(doThis: (err:string) => void): void;
    serverCall: <T>(url: string, payload: any ) => Promise<T>;
    stats: {
        sentCount: number
        bytesSent: number
        recievedCount: number
        bytesRecieved: number
    }
}

// -------------------------------------------------------------------
// SessionHelper
// -------------------------------------------------------------------
export class SessionHelper implements ISessionHelper {
    public readonly roomId: string;
    public get personalId() { return this._messageThing.personalId}
    public get personalSecret() { return this._messageThing.personalSecret}
    private readonly _presenterId: string;
    private readonly _serializer: ClusterFunSerializer;
    private _messageThing: IMessageThing;
    private _listeners = new Map<ClusterFunMessageConstructor<unknown, ClusterFunMessageBase>, Map<object, (message: ClusterFunMessageBase) => void>>()
    
    sessionError?:string;
    serverCall: <T>(url: string, payload: any) => Promise<T>;
    stats = {
        sentCount: 0,
        bytesSent: 0,
        recievedCount: 0,
        bytesRecieved: 0,
    }

    // -------------------------------------------------------------------
    // ctor
    // ------------------------------------------------------------------- 
    constructor(messageThing: IMessageThing, roomId: string, presenterId: string, serializer: ClusterFunSerializer, serverCall: <T>(url: string, payload: any) => Promise<T>) {
        this.roomId = roomId;
        this._serializer = serializer;
        this._presenterId = presenterId;
        this.serverCall = serverCall;
        this._messageThing = messageThing;

        this._messageThing.addEventListener("open", () => {
            Logger.debug("Socket Opened")
        });

        this._messageThing.addEventListener("message", (ev: { data: string; }) => {
            let message: ClusterFunMessageBase;
            action(()=>{
                this.stats.recievedCount++;
                this.stats.bytesRecieved += ev.data.length;
            })()
            try {
                message = this._serializer.deserialize(ev.data);
            } catch (e) {
                Logger.error("Error happened during deserialization", e);
                return;
            }

            Logger.debug(`RECV: ${message.messageId} from ${message.sender}`)

            const listenersForMessage = this._listeners.get(
                message.constructor as ClusterFunMessageConstructor<unknown, ClusterFunMessageBase>);
            if (listenersForMessage) {
                const listenerFunctions = listenersForMessage.values()
                for (const listener of listenerFunctions) {
                    listener(message); 
                }
            }
        })

        this._messageThing.addEventListener("close", (ev: { code: number }) => {

        })

        makeAutoObservable(this.stats);
    }

    // -------------------------------------------------------------------
    // sendMessageToPresenter
    // ------------------------------------------------------------------- 
    async sendMessageToPresenter(message: ClusterFunMessageBase) {
        return this.sendMessage(this._presenterId, message);
    }

    private _errorSubs: ((err:string)=>void)[] = []

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    onError(doThis: (err: string) => void) {
        this._errorSubs.push(doThis);
    }

    // -------------------------------------------------------------------
    // sendMessage
    // ------------------------------------------------------------------- 
    async sendMessage(receiver: string, message: ClusterFunMessageBase) {
        const contents = this._serializer.serialize(receiver, this.personalId, message);
        Logger.debug(`SEND: ${contents}`)

        action(()=>{
            this.stats.sentCount++;
            this.stats.bytesSent += contents.length;
        })()
    
        await this._messageThing.send(contents, () => this._errorSubs.forEach(e => e(`Message send failure`)))
                .catch(err => {
                    this._errorSubs.forEach(e => e(`${err}`))
                })
        
        return {id: message.messageId, message} as IMessageReceipt;
    }

    // -------------------------------------------------------------------
    // ResendMessage - oldMessage comes from the output of a previous sendMessage()
    // ------------------------------------------------------------------- 
    resendMessage(receiver: string, oldMessage: IMessageReceipt) {
        this.sendMessage(receiver, oldMessage.message);
    }

    // -------------------------------------------------------------------
    // addListener
    // ------------------------------------------------------------------- 
    addListener<P, M extends ClusterFunMessageBase>(messageClass: ClusterFunMessageConstructor<P, M>, owner: object, listener: (message: M) => unknown) {
        if(!this._listeners.has(messageClass as ClusterFunMessageConstructor<unknown, M>))
        {
            // Create the set of listeners for the new class,
            // also ensuring the class is registered in the hydrator
            this._listeners.set(messageClass as ClusterFunMessageConstructor<unknown, M>, new Map<object, (message: object) => unknown>());
            this._serializer.register(messageClass);
            Logger.debug("REGISTERING: " + messageClass.messageTypeName)
        }
        const listenersForType = this._listeners.get(messageClass as ClusterFunMessageConstructor<unknown, M>) as Map<object, (message: M) => unknown>;
        listenersForType.set(owner, listener);
    }

    // -------------------------------------------------------------------
    // removeListener
    // ------------------------------------------------------------------- 
    removeListener<P, M extends ClusterFunMessageBase>(messageClass: ClusterFunMessageConstructor<P, M>, owner: object) {
        if(this._listeners.has(messageClass as ClusterFunMessageConstructor<unknown, M>))
        {
            const listenersForType = this._listeners.get(messageClass as ClusterFunMessageConstructor<unknown, M>) as Map<object, (message: M) => unknown>;
            listenersForType.delete(owner);
            Logger.debug("UNREGISTERING: " + messageClass.messageTypeName)
        }
    }

    // -------------------------------------------------------------------
    // removeAllListenersForOwner
    // ------------------------------------------------------------------- 
    removeAllListenersForOwner(owner: object) {
        for (const key of this._listeners.keys()) {
            this.removeListener(key, owner);
        }
    }

    // -------------------------------------------------------------------
    // addOpenedListener
    // ------------------------------------------------------------------- 
    addOpenedListener(listener: () => void) {
        if (this._messageThing.isOpen) {
            setTimeout(() => listener(), 0);
        } else {
            this._messageThing.addEventListener("open", (ev) => listener());
        }
    }

    // -------------------------------------------------------------------
    // addClosedListener
    // ------------------------------------------------------------------- 
    addClosedListener(listener: (code: number) => void) {
        if (this._messageThing.isClosed) {
            setTimeout(() => listener(this._messageThing.closeCode), 0);
        } else {
            this._messageThing.addEventListener("close", (ev) => listener(ev.code));
        }
    }
}