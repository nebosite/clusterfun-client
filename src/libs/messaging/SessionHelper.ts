import Logger from "js-logger";
import { action, makeAutoObservable } from "mobx";
import ClusterfunListener from "./ClusterfunListener";
import ClusterfunRequest from "./ClusterfunRequest";
import MessageEndpoint from "./MessageEndpoint";
import { IMessageThing } from './MessageThing';

// -------------------------------------------------------------------
// SessionHelper
// -------------------------------------------------------------------
export interface ISessionHelper {
    readonly roomId: string;
    readonly personalId: string;
    readonly personalSecret: string;
    listen<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>, 
        apiCallback: (sender: string, value: REQUEST) => RESPONSE | PromiseLike<RESPONSE>
        ): ClusterfunListener<REQUEST, RESPONSE>;
    request<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>, 
        receiverId: string, 
        request: REQUEST
        ): ClusterfunRequest<REQUEST, RESPONSE>;
    requestPresenter<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>,
        request: REQUEST
        ): ClusterfunRequest<REQUEST, RESPONSE>;
    addClosedListener(owner: object, listener: (code: number) => void): void;
    removeClosedListener(owner: object): void;
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
    public get personalId() { return this._messageThing.personalId }
    public get personalSecret() { return this._messageThing.personalSecret }
    private readonly _presenterId: string;
    private _messageThing: IMessageThing;
    private _closedListeners = new Map<object, (code: number) => void>();
    private _errorSubs: ((err:string)=>void)[] = []
    private _currentRequestId: number;
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
    constructor(messageThing: IMessageThing, roomId: string, presenterId: string, serverCall: <T>(url: string, payload: any) => Promise<T>) {
        this.roomId = roomId;
        this._presenterId = presenterId;
        this.serverCall = serverCall;
        this._messageThing = messageThing;
        this._currentRequestId = Math.floor(Math.random() * 0xffffffff);

        this._messageThing.addEventListener("open", () => {
            Logger.debug("Socket Opened")
        });

        this._messageThing.addEventListener("message", (ev: { data: string; }) => {
            action(()=>{
                this.stats.recievedCount++;
                this.stats.bytesRecieved += ev.data.length;
            })()
        })

        this._messageThing.addEventListener("close", (ev: { code: number }) => {
            for (const listener of this._closedListeners.values()) {
                listener(ev.code);
            }
        })

        makeAutoObservable(this.stats);
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    listen<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>, 
        apiCallback: (sender: string, value: REQUEST) => RESPONSE | PromiseLike<RESPONSE>
        ): ClusterfunListener<REQUEST, RESPONSE> {
        return new ClusterfunListener<REQUEST, RESPONSE>(endpoint, this._messageThing, apiCallback);
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    request<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>, 
        receiverId: string, 
        request: REQUEST
        ): ClusterfunRequest<REQUEST, RESPONSE> {
        return new ClusterfunRequest(
            endpoint,
            request, 
            this.personalId, 
            receiverId,
            (this._currentRequestId++).toString(), 
            this._messageThing);
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    requestPresenter<REQUEST, RESPONSE>(endpoint: MessageEndpoint<REQUEST, RESPONSE>, request: REQUEST) {
        return this.request(endpoint, this._presenterId, request);
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    onError(doThis: (err: string) => void) {
        this._errorSubs.push(doThis);
    }

    // -------------------------------------------------------------------
    // addClosedListener
    // ------------------------------------------------------------------- 
    addClosedListener(owner: object, listener: (code: number) => void) {
        if (this._messageThing.isClosed) {
            listener(this._messageThing.closeCode);
        } else {
            this._closedListeners.set(owner, listener);
        }
    }

    // -------------------------------------------------------------------
    // removeClosedListener
    // ------------------------------------------------------------------- 
    removeClosedListener(owner: object) {
        this._closedListeners.delete(owner);
    }
}