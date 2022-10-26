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
        name: string, 
        listener: (message: M) => unknown): void;
    addOpenedListener(listener: () => void): void;
    addClosedListener(listener: (code: number) => void): void;
    onError(doThis: (err:string) => void): void;
    serverCall: <T>(url: string, payload: any) => Promise<T>;
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
    private _listeners = new Map<ClusterFunMessageConstructor<unknown, ClusterFunMessageBase>, Map<string, (message: object) => void>>()
    sessionError?:string;
    serverCall: <T>(url: string, payload: any) => Promise<T>;

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
            console.log("Socket Opened")
        });

        this._messageThing.addEventListener("message", (ev: { data: string; }) => {
            let message: ClusterFunMessageBase;
            try {
                message = this._serializer.deserialize(ev.data);
            } catch (e) {
                console.error("Error happened during deserialization", e);
                return;
            }

            console.log(`RECV: ${message.messageId} from ${message.sender}`)

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
        console.log(`SEND: ${contents}`)

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
    addListener<P, M extends ClusterFunMessageBase>(messageClass: ClusterFunMessageConstructor<P, M>, name: string, listener: (message: M) => unknown) {
        if(!this._listeners.has(messageClass as ClusterFunMessageConstructor<unknown, M>))
        {
            // Create the set of listeners for the new class,
            // also ensuring the class is registered in the hydrator
            this._listeners.set(messageClass as ClusterFunMessageConstructor<unknown, M>, new Map<string, (message: object) => unknown>());
            this._serializer.register(messageClass);
            //console.log("REGISTERING: " + messageClass)
        }
        const listenersForType = this._listeners.get(messageClass as ClusterFunMessageConstructor<unknown, M>) as Map<string, (message: M) => unknown>;
        listenersForType.set(name, listener);
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