import Logger from "js-logger";
import { ClusterFunMessageHeader, ClusterFunRoutingHeader, parseMessage, stringifyMessage } from "libs/comms";
import MessageEndpoint from "./MessageEndpoint";
import { IMessageThing } from "./MessageThing";

enum RequestState {
    Unsettled,
    Resolved,
    Rejected
}

/**
 * Object tracking an outstanding request to another network participant.
 */
export default class ClusterfunRequest<REQUEST, RESPONSE> implements PromiseLike<RESPONSE> {
    endpoint: MessageEndpoint<REQUEST, RESPONSE>
    request: REQUEST;
    sender: string;
    receiver: string;
    id: string;
    private _messageThing: IMessageThing;
    private _state: RequestState;
    private _response?: RESPONSE;
    private _error?: any;
    private _fulfilledCallbacks?: ((value: RESPONSE) => void)[];
    private _rejectedCallbacks?: ((error: any) => void)[];
    private _messageCallback?: (ev: { data: string; }) => void;
    private _startTime: number;
    private _lastSendTime: number;
    private _timeout?: NodeJS.Timeout;

    constructor(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>, 
        request: REQUEST, 
        sender: string, 
        receiver: string,
        id: string, 
        messageThing: IMessageThing)
    {
        this.endpoint = endpoint;
        this.request = request;
        this.sender = sender;
        this.receiver = receiver;
        this.id = id;
        this._messageThing = messageThing;
        this._state = RequestState.Unsettled;
        this._fulfilledCallbacks = [];
        this._rejectedCallbacks = [];

        this._messageCallback = (ev: { data: string; }) => {
            this.respondToMessage(ev.data);
        }
        this._messageThing.addEventListener("message", this._messageCallback);

        this._startTime = window.performance.now();
        this._lastSendTime = window.performance.now();
        this.resend();
        this.timerHandler();
    }

    then<TResult1 = RESPONSE, TResult2 = never>(
        onfulfilled?: ((value: RESPONSE) => TResult1 | PromiseLike<TResult1>) | null | undefined, 
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined): PromiseLike<TResult1 | TResult2> {
        if (this._state === RequestState.Resolved && onfulfilled) {
            return Promise.resolve(onfulfilled(this._response!));
        } else if (this._state === RequestState.Rejected && onrejected) {
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
        if (routing.route !== this.endpoint.route || routing.requestId !== this.id) {
            return; // this message is not for us
        }
        if (routing.role === "response") {
            this.resolve(payload as RESPONSE);
        } else if (routing.role === "error") {
            this.reject(new Error(payload));
        }
    }

    private resolve(value: RESPONSE): void {
        if (this._state !== RequestState.Unsettled) {
            throw new Error(`Request was already settled as ${this._state}`)
        }
        const fulfilledCallbacks = this._fulfilledCallbacks!;
        delete this._fulfilledCallbacks;
        delete this._rejectedCallbacks;
        this._response = value;
        this._state = RequestState.Resolved;
        this.forget();
        for (const callback of fulfilledCallbacks) {
            callback(this._response);
        }
    }

    private reject(error: any): void {
        if (this._state !== RequestState.Unsettled) {
            throw new Error(`Request was already settled as ${this._state}`)
        }
        const rejectedCallbacks = this._rejectedCallbacks!;
        delete this._fulfilledCallbacks;
        delete this._rejectedCallbacks;
        this._error = error;
        this._state = RequestState.Rejected;
        this.forget();
        for (const callback of rejectedCallbacks) {
            callback(this._error);
        }
    }

    private timerHandler = () => {
        if (this._state !== RequestState.Unsettled) {
            return; // we have a result, no need to send more messages
        }
        const now = window.performance.now();
        const totalLifetime = ("suggestedTotalLifetimeMs" in this.endpoint ? this.endpoint.suggestedTotalLifetimeMs! : 30000);
        if (this._startTime + totalLifetime < now) {
            this.reject(new Error(`Could not receive a response for ${this.endpoint.route} from ${this.receiver}`));
            return;
        }
        const retryInterval = ("suggestedRetryIntervalMs" in this.endpoint ? this.endpoint.suggestedRetryIntervalMs! : Number.POSITIVE_INFINITY);
        if (this._lastSendTime + retryInterval < now) {
            this.resend();
        }
        const nextTimeoutTime = Math.min(
            this._startTime - now + totalLifetime,
            this._lastSendTime - now + retryInterval
        );
        this._timeout = setTimeout(this.timerHandler, nextTimeoutTime);
    }

    resend(): void {
        this._lastSendTime = window.performance.now();
        const header: ClusterFunMessageHeader = {
            r: this.receiver,
            s: this.sender,
            id: this.id + "-request"
        }
        const routing: ClusterFunRoutingHeader = {
            requestId: this.id,
            route: this.endpoint.route,
            role: "request"
        }
        const data = stringifyMessage(header, routing, this.request);
        this._messageThing.send(data, () => {
            Logger.warn("Could not send message to relay server, will retry")
        })
    }

    forget(): void {
        if (this._state === RequestState.Unsettled && this.endpoint.responseRequired) {
            Logger.warn(`Called forget() on a request that requires a response (route ${this.endpoint.route})`)
        }
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = undefined;
        }
        if (this._messageCallback) {
            this._messageThing.removeEventListener("message", this._messageCallback);
            this._messageCallback = undefined;
        }
    }
}