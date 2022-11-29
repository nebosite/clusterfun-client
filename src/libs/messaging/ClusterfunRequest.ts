import { ClusterFunMessageHeader, ClusterFunRoutingHeader, parseMessage, stringifyMessage } from "libs/comms";
import { IMessageThing } from "./MessageThing";

/**
 * Object tracking an outstanding request to another network participant.
 */
export default class ClusterfunRequest<REQUEST, RESPONSE> implements PromiseLike<RESPONSE> {
    request: REQUEST;
    sender: string;
    receiver: string;
    route: string;
    id: string;
    private _messageThing: IMessageThing;
    private _response?: RESPONSE;
    private _error?: any;
    private _fulfilledCallbacks?: ((value: RESPONSE) => void)[];
    private _rejectedCallbacks?: ((error: any) => void)[];
    private _messageCallback: (ev: { data: string; }) => void;

    constructor(request: REQUEST, sender: string, receiver: string, route: string, id: string, messageThing: IMessageThing) {
        this.request = request;
        this.sender = sender;
        this.receiver = receiver;
        this.route = route;
        this.id = id;
        this._messageThing = messageThing;
        this._fulfilledCallbacks = [];
        this._rejectedCallbacks = [];

        this._messageCallback = (ev: { data: string; }) => {
            this.respondToMessage(ev.data);
        }
        this._messageThing.addEventListener("message", this._messageCallback);
        this.resend();
    }

    then<TResult1 = RESPONSE, TResult2 = never>(
        onfulfilled?: ((value: RESPONSE) => TResult1 | PromiseLike<TResult1>) | null | undefined, 
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined): PromiseLike<TResult1 | TResult2> {
        if ("_response" in this && onfulfilled) {
            return Promise.resolve(onfulfilled(this._response!));
        } else if ("_error" in this && onrejected) {
            return Promise.reject(onrejected(this._error!))
        }

        return new Promise<TResult1>((resolve, reject) => {
            if (onfulfilled) {
                this._fulfilledCallbacks!.push((value: RESPONSE) => {
                    resolve(onfulfilled(value));
                });
            }
            if (onrejected) {
                this._rejectedCallbacks!.push((error: any) => {
                    reject(onrejected(error));
                });                
            }
        });
    }

    private respondToMessage(data: string): void {
        const { header, routing, payload } = parseMessage(data);
        if (routing.route !== this.route || routing.requestId !== this.id) {
            return; // this message is not for us
        }
        if (routing.role === "response") {
            this.resolve(payload as RESPONSE);
        } else if (routing.role === "error") {
            this.reject(new Error(payload));
        }
    }

    // TODO: Figure out a better, more private way to call these two functions
    private resolve(value: RESPONSE): void {
        const fulfilledCallbacks = this._fulfilledCallbacks!;
        delete this._fulfilledCallbacks;
        delete this._rejectedCallbacks;
        this._response = value;
        for (const callback of fulfilledCallbacks) {
            callback(this._response);
        }
    }

    private reject(error: any): void {
        const rejectedCallbacks = this._rejectedCallbacks!;
        delete this._fulfilledCallbacks;
        delete this._rejectedCallbacks;
        this._error = error;
        for (const callback of rejectedCallbacks) {
            callback(this._error);
        }
    }

    resend(): void {
        const header: ClusterFunMessageHeader = {
            r: this.receiver,
            s: this.sender,
            id: this.id + "-request"
        }
        const routing: ClusterFunRoutingHeader = {
            requestId: this.id,
            route: this.route,
            role: "request"
        }
        const data = stringifyMessage(header, routing, this.request);
        this._messageThing.send(data, () => {
            // TODO: This should utilize a timeout/retry count
            this.reject(new Error("Failed to send message to relay server"))
        })
    }

    unsubscribe(): void {
        this._messageThing.removeEventListener("message", this._messageCallback);
    }
}