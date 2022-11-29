import Logger from "js-logger";
import { ClusterFunMessageHeader, ClusterFunRoutingHeader, parseMessage, stringifyMessage } from "libs/comms";
import { IMessageThing } from "./MessageThing";

// Regex for parsing incoming messages - a JSON header and an arbitrary payload
// separated by a caret.
const MESSAGE_REGEX = /^(?<header>{[^^]*})\^(?<payload>.*)$/;

export default class ClusterfunListener<REQUEST, RESPONSE> {
    route: string;
    private _messageThing: IMessageThing;
    private _apiCallback: (value: REQUEST) => RESPONSE | PromiseLike<RESPONSE>;
    private _messageCallback: (ev: { data: string; }) => void;

    constructor(route: string, messageThing: IMessageThing, apiCallback: (value: REQUEST) => RESPONSE | PromiseLike<RESPONSE>) {
        this.route = route;
        this._messageThing = messageThing;
        this._apiCallback = apiCallback;
        this._messageCallback = (ev: { data: string; }) => {
            this.respondToRequest(ev.data);
        }
        this._messageThing.addEventListener("message", this._messageCallback);
    }

    private async respondToRequest(data: string): Promise<void> {
        // Parse the input message into header and payload, if possible
        // TODO: Note that the payload is untrusted - can we add verification here?
        let header: ClusterFunMessageHeader;
        let routing: ClusterfunRoutingHeader;
        let payload: REQUEST;
        try {
            const parsedMessage = parseMessage(data);
            header = parsedMessage.header;
            routing = parsedMessage.routing;
            payload = parsedMessage.payload as REQUEST;
        } catch (e) {
            Logger.warn("Improperly formatted message received");
            return;
        }
        if (routing.route !== this.route && routing.role !== "request") {
            return; // this message is not for us
        }
        try {
            const rawResult = this._apiCallback(payload);
            let result: RESPONSE;
            if ("then" in rawResult && typeof(rawResult.then) === "function") {
                result = await rawResult;
            } else {
                result = rawResult as RESPONSE;
            }
            if (result) {
                const responseHeader: ClusterFunMessageHeader = {
                    r: header.s,
                    s: header.r,
                    id: header.id + "-response"
                };
                const responseRouting: ClusterfunRoutingHeader = {
                    requestId: routing.requestId,
                    role: "response",
                    route: this.route
                }
                const responseData = stringifyMessage(responseHeader, responseRouting, result);
                this._messageThing.send(responseData, () => {});
            }
        } catch (e) {
            const responseHeader: ClusterFunMessageHeader = {
                r: header.s,
                s: header.r,
                id: header.id + "-error"
            };
            const responseRouting: ClusterfunRoutingHeader = {
                requestId: routing.requestId,
                role: "error",
                route: this.route
            }
            const responseData = stringifyMessage(responseHeader, responseRouting, e);
            this._messageThing.send(responseData, () => {});
        }
    }

    unsubscribe() {
        this._messageThing.removeEventListener("message", this._messageCallback);
    }
}