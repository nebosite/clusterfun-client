import Logger from "js-logger";
import { action, makeAutoObservable } from "mobx";
import ClusterfunListener from "./ClusterfunListener";
import ClusterfunRequest from "./ClusterfunRequest";
import MessageEndpoint from "./MessageEndpoint";
import { IMessageThing } from './MessageThing';
import { RoomInfoResponse } from "libs/config";

// -------------------------------------------------------------------
// SessionHelper
// -------------------------------------------------------------------
export interface ISessionHelper {
    readonly roomId: string;
    readonly personalId: string;
    readonly personalSecret: string;
    readonly isVip: boolean;
    listen<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>, 
        apiCallback: (sender: string, value: REQUEST) => RESPONSE | PromiseLike<RESPONSE>
        ): ClusterfunListener<REQUEST, RESPONSE>;
    listenPresenter<REQUEST, RESPONSE>(endpoint: MessageEndpoint<REQUEST, RESPONSE>, 
        apiCallback: (value: REQUEST) => RESPONSE | PromiseLike<RESPONSE>
        ): ClusterfunListener<REQUEST, RESPONSE>;
    listenVip<REQUEST, RESPONSE>(endpoint: MessageEndpoint<REQUEST, RESPONSE>, 
        apiCallback: (value: REQUEST) => RESPONSE | PromiseLike<RESPONSE>
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
    requestVip<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>,
        request: REQUEST
        ): ClusterfunRequest<REQUEST, RESPONSE>;
    updateVip(): PromiseLike<string>;
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
    private _vipId: string | undefined;
    public get isVip() { return this._messageThing.personalId === this._vipId }
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
    constructor(messageThing: IMessageThing, roomId: string, presenterId: string, isVip: boolean, serverCall: <T>(url: string, payload: any) => Promise<T>) {
        this.roomId = roomId;
        this._presenterId = presenterId;
        this.serverCall = serverCall;
        this._messageThing = messageThing;
        if (isVip) {
            this._vipId = messageThing.personalId;
        }
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
    // Listen for a request, responding using the provided callback
    //--------------------------------------------------------------------------------------
    listen<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>, 
        apiCallback: (sender: string, value: REQUEST) => RESPONSE | PromiseLike<RESPONSE>
        ): ClusterfunListener<REQUEST, RESPONSE> {
        return new ClusterfunListener<REQUEST, RESPONSE>(endpoint, this._messageThing, apiCallback);
    }

    //--------------------------------------------------------------------------------------
    // Listen for a request specifically from the presenter. A request of this type sent
    // from any other participant will have an error thrown back at it.
    //--------------------------------------------------------------------------------------
    listenPresenter<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>, 
        apiCallback: (value: REQUEST) => RESPONSE | PromiseLike<RESPONSE>
        ): ClusterfunListener<REQUEST, RESPONSE> {
        return new ClusterfunListener<REQUEST, RESPONSE>(endpoint, this._messageThing, (sender: string, value: REQUEST) => {
            if (sender === this._presenterId) {
                return apiCallback(value);
            } else {
                throw new Error("Sender is not the presenter")
            }
        });
    }

    //--------------------------------------------------------------------------------------
    // Listen for a request specifically from the VIP. A request of this type sent
    // from any other participant will have an error thrown back at it.
    //--------------------------------------------------------------------------------------
    listenVip<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>, 
        apiCallback: (value: REQUEST) => RESPONSE | PromiseLike<RESPONSE>
        ): ClusterfunListener<REQUEST, RESPONSE> {
        return new ClusterfunListener<REQUEST, RESPONSE>(endpoint, this._messageThing, async (sender: string, value: REQUEST) => {
            // Double check with the server who the VIP is
            await this.updateVip();
            if (sender === this._vipId) {
                return apiCallback(value);
            } else {
                throw new Error("Sender is not the VIP")
            }
        });
    }

    //--------------------------------------------------------------------------------------
    // Make a request to a given endpoint on the given receiver
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
    // Make a request to a given endpoint on the presenter
    //--------------------------------------------------------------------------------------
    requestPresenter<REQUEST, RESPONSE>(endpoint: MessageEndpoint<REQUEST, RESPONSE>, request: REQUEST) {
        return this.request(endpoint, this._presenterId, request);
    }

    //--------------------------------------------------------------------------------------
    // Make a request to a given endpoint on the VIP
    //--------------------------------------------------------------------------------------
    requestVip<REQUEST, RESPONSE>(endpoint: MessageEndpoint<REQUEST, RESPONSE>, request: REQUEST) {
        if (!this._vipId) {
            throw new Error("The VIP has not been established yet or is not accessible to this user")
        }
        return this.request(endpoint, this._vipId, request);
    }

    //--------------------------------------------------------------------------------------
    // Contact the relay server to figure out who the VIP is
    //--------------------------------------------------------------------------------------
    async updateVip(): Promise<string> {
        const roomInfo = await this.serverCall<RoomInfoResponse>("/api/get_room_info", 
            { roomId: this.roomId, personalId: this.personalId, personalSecret: this.personalSecret});
        if (roomInfo.vipId) {
            this._vipId = roomInfo.vipId;
            return roomInfo.vipId;
        } else {
            throw new Error("Current user does not have access to the VIP");
        }
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