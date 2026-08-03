import { ClusterFunMessageHeader } from "./ClusterFunMessageHeader";
import { ClusterFunRoutingHeader } from "./ClusterFunRoutingHeader";

// Regex for parsing incoming messages - a JSON header and an arbitrary payload
// separated by a caret.
const MESSAGE_REGEX = /^(?<header>{[^^]*})\^(?<routing>{[^^]*})\^(?<payload>.*)$/;
const MESSAGE_HEADER_ONLY_REGEX = /^(?<header>{[^^]*})\^/;

export function parseMessage(data: string): {
  header: ClusterFunMessageHeader;
  routing: ClusterFunRoutingHeader;
  payload: any;
} {
  const regexMatch = data.match(MESSAGE_REGEX);
  if (!regexMatch) {
    throw new SyntaxError("Improperly formatted message");
  }
  const header = JSON.parse(regexMatch.groups!["header"]) as ClusterFunMessageHeader;
  const routing = JSON.parse(regexMatch.groups!["routing"]) as ClusterFunRoutingHeader;
  const payloadString = regexMatch.groups!["payload"];
  let payload: any;
  if (payloadString === "" || payloadString === "undefined") {
    payload = undefined;
  } else {
    payload = JSON.parse(regexMatch.groups!["payload"]);
  }
  return { header, routing, payload };
}

// ------------------------------------------------------------------------------------------
// parseEnvelope - everything needed to decide whether a message is ours, and NOT a byte more.
//
// Every listener and every in-flight request attaches its own "message" handler, and each one
// used to run a full parseMessage - JSON.parse over the entire payload - before looking at the
// route to discover the message was for somebody else.  Cost was
// O(listeners x messages x payload size): a PartyPix presenter with ten listeners parsed a
// 133KB photo upload ten times, about 1.3MB of JSON parsing on the main thread, for one photo.
//
// The payload comes back as text.  Call parsePayload on it once the route matches.
// ------------------------------------------------------------------------------------------
export function parseEnvelope(data: string): {
  header: ClusterFunMessageHeader;
  routing: ClusterFunRoutingHeader;
  payloadText: string;
} {
  // indexOf rather than the regex on purpose.  MESSAGE_REGEX ends with (?<payload>.*), so
  // merely matching it allocates the entire payload as a capture group - which is most of the
  // work we are trying to avoid.  Two index lookups and two small slices cost nothing, and
  // the payload is not materialised until somebody asks for it.
  //
  // Same assumption the regex made: neither header nor routing contains a caret.
  const firstCaret = data.indexOf("^");
  if (firstCaret < 0) throw new SyntaxError("Improperly formatted message");
  const secondCaret = data.indexOf("^", firstCaret + 1);
  if (secondCaret < 0) throw new SyntaxError("Improperly formatted message");

  const headerText = data.slice(0, firstCaret);
  const routingText = data.slice(firstCaret + 1, secondCaret);
  if (headerText[0] !== "{" || routingText[0] !== "{") {
    throw new SyntaxError("Improperly formatted message");
  }

  let header: ClusterFunMessageHeader;
  let routing: ClusterFunRoutingHeader;
  try {
    header = JSON.parse(headerText) as ClusterFunMessageHeader;
    routing = JSON.parse(routingText) as ClusterFunRoutingHeader;
  } catch {
    throw new SyntaxError("Improperly formatted message");
  }

  return { header, routing, payloadText: data.slice(secondCaret + 1) };
}

/** The other half of parseEnvelope: the payload, once it is worth reading. */
export function parsePayload(payloadText: string): any {
  if (payloadText === "" || payloadText === "undefined") return undefined;
  return JSON.parse(payloadText);
}

export function parseHeaderOnly(data: string): ClusterFunMessageHeader {
  const regexMatch = data.match(MESSAGE_HEADER_ONLY_REGEX);
  if (!regexMatch) {
    throw new SyntaxError("Improperly formatted message");
  }
  return JSON.parse(regexMatch.groups!["header"]) as ClusterFunMessageHeader;
}

export function stringifyMessage(
  header: ClusterFunMessageHeader,
  routing: ClusterFunRoutingHeader,
  payload: any,
): string {
  return JSON.stringify(header) + "^" + JSON.stringify(routing) + "^" + JSON.stringify(payload);
}
