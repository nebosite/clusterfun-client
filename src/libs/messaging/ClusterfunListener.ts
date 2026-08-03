import Logger from "js-logger";
import {
  ClusterFunMessageHeader,
  ClusterFunRoutingHeader,
  parseEnvelope,
  parsePayload,
  stringifyMessage,
} from "libs/comms";
import MessageEndpoint from "./MessageEndpoint";
import { IMessageThing } from "./MessageThing";

export default class ClusterfunListener<REQUEST, RESPONSE> {
  endpoint: MessageEndpoint<REQUEST, RESPONSE>;
  private _messageThing: IMessageThing;
  private _apiCallback: (sender: string, value: REQUEST) => RESPONSE | PromiseLike<RESPONSE>;
  private _messageCallback: (ev: { data: string }) => void;

  constructor(
    endpoint: MessageEndpoint<REQUEST, RESPONSE>,
    messageThing: IMessageThing,
    apiCallback: (sender: string, value: REQUEST) => RESPONSE | PromiseLike<RESPONSE>,
  ) {
    this.endpoint = endpoint;
    this._messageThing = messageThing;
    this._apiCallback = apiCallback;
    this._messageCallback = (ev: { data: string }) => {
      this.respondToRequest(ev.data);
    };
    this._messageThing.addEventListener("message", this._messageCallback);
  }

  private async respondToRequest(data: string): Promise<void> {
    // Parse the input message into header and payload, if possible
    // TODO: Note that the payload is untrusted - can we add verification here?
    let header: ClusterFunMessageHeader;
    let routing: ClusterFunRoutingHeader;
    let payloadText: string;
    try {
      const envelope = parseEnvelope(data);
      header = envelope.header;
      routing = envelope.routing;
      payloadText = envelope.payloadText;
    } catch (e) {
      Logger.warn("Improperly formatted message received: " + e);
      return;
    }
    // Decide whether this is ours BEFORE touching the payload.  Every listener
    // on this device sees every message, so parsing first meant a 133KB upload
    // was JSON-parsed once per listener just to be thrown away.
    if (
      routing.route !== this.endpoint.route ||
      (routing.role !== "request" && routing.role !== "message")
    ) {
      return; // this message is not for us
    }
    let payload: REQUEST;
    try {
      payload = parsePayload(payloadText) as REQUEST;
    } catch (e) {
      Logger.warn("Message payload could not be read: " + e);
      return;
    }
    try {
      const rawResult = this._apiCallback(header.s, payload);
      let result: RESPONSE;
      if (
        rawResult &&
        typeof rawResult === "object" &&
        "then" in rawResult &&
        typeof rawResult.then === "function"
      ) {
        result = await rawResult;
      } else {
        result = rawResult as RESPONSE;
      }
      if (routing.role === "request") {
        // a request was expected, so reply back
        const responseHeader: ClusterFunMessageHeader = {
          r: header.s,
          s: header.r,
          id: header.id + "-response",
        };
        const responseRouting: ClusterFunRoutingHeader = {
          requestId: routing.requestId,
          role: "response",
          route: this.endpoint.route,
        };
        const responseData = stringifyMessage(responseHeader, responseRouting, result);
        this._messageThing.send(responseData, () => {});
      }
    } catch (e) {
      const responseHeader: ClusterFunMessageHeader = {
        r: header.s,
        s: header.r,
        id: header.id + "-error",
      };
      const responseRouting: ClusterFunRoutingHeader = {
        requestId: routing.requestId,
        role: "error",
        route: this.endpoint.route,
      };
      const responseData = stringifyMessage(responseHeader, responseRouting, e);
      this._messageThing.send(responseData, () => {});
    }
  }

  unsubscribe() {
    Logger.info("Unsubscribing route: ", this.endpoint.route);
    this._messageThing.removeEventListener("message", this._messageCallback);
  }
}
