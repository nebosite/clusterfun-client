import { ClusterFunMessageHeader } from "./ClusterFunMessageHeader";
import { ClusterFunRoutingHeader } from "./ClusterFunRoutingHeader";

// Regex for parsing incoming messages - a JSON header and an arbitrary payload
// separated by a caret.
const MESSAGE_REGEX = /^(?<header>{[^^]*})\^(?<routing>{[^^]*})\^(?<payload>.*)$/;
const MESSAGE_HEADER_ONLY_REGEX = /^(?<header>{[^^]*})\^/;

export function parseMessage(data: string): { header: ClusterFunMessageHeader, routing: ClusterFunRoutingHeader, payload: any } {
    const regexMatch = data.match(MESSAGE_REGEX);
    if (!regexMatch) {
        throw new SyntaxError("Improperly formatted message");
    }
    const header = JSON.parse(regexMatch.groups!["header"]) as ClusterFunMessageHeader;
    const routing = JSON.parse(regexMatch.groups!["routing"]) as ClusterFunRoutingHeader;
    const payload = JSON.parse(regexMatch.groups!["payload"]);
    return { header, routing, payload };
}

export function parseHeaderOnly(data: string): ClusterFunMessageHeader {
    const regexMatch = data.match(MESSAGE_HEADER_ONLY_REGEX);
    if (!regexMatch) {
        throw new SyntaxError("Improperly formatted message");
    }
    return JSON.parse(regexMatch.groups!["header"]) as ClusterFunMessageHeader;
}

export function stringifyMessage(header: ClusterFunMessageHeader, routing: ClusterFunRoutingHeader, payload: any): string {
    return JSON.stringify(header) + "^" + JSON.stringify(routing) + "^" + JSON.stringify(payload);
}