import Logger from "js-logger";
import { GameAnalytics } from "./GameAnalytics";
import { AnalyticsEvent } from "./AnalyticsTypes";

// ==========================================================================================
// ErrorReporter - the one place a crash on somebody's phone becomes a fact we know.
//
// Before this, a guest whose phone threw saw "Something went wrong" and that was the end of
// it: ErrorBoundary set a state string, there was no window.onerror and no
// unhandledrejection handler, and the project learned nothing.  Every real-world failure was
// invisible, which makes every other risk harder to rank.
//
// It is a module singleton rather than something threaded through constructors because the
// two places errors actually surface - a React error boundary and the global handlers - have
// no model, no session and no props to receive one through.
//
// Three rules it must never break:
//   1. Never throw.  A reporter that breaks while reporting is worse than no reporter.
//   2. Never flood.  A render loop that throws does so every frame; GA4 would be sent
//      thousands of identical events and the interesting first one would be lost in them.
//   3. Never send anything long.  GA4 truncates a parameter at 100 characters, so a raw
//      stack would arrive as a useless prefix of itself.
// ==========================================================================================

// GA4's limit is 100; leave room for the ellipsis.
const MAX_PARAM_CHARS = 90;

// Per page load.  Enough to see a storm starting, few enough to be worth reading.
export const MAX_REPORTS_PER_SESSION = 10;

export type ErrorSource = "react" | "window" | "promise";

let analytics: GameAnalytics | undefined;
let reportCount = 0;
// Signatures already sent, so the same failure repeating every frame costs one event.
const seen = new Set<string>();
let handlersInstalled = false;

function clip(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_PARAM_CHARS ? flat : `${flat.slice(0, MAX_PARAM_CHARS)}…`;
}

// -------------------------------------------------------------------
// The most useful line of a stack: the first frame that is OUR code.
// Everything before it is usually framework noise, and the raw stack is far
// too long to send.
// -------------------------------------------------------------------
function originOf(stack: string | undefined): string {
  if (!stack) return "";
  for (const line of stack.split("\n").slice(1)) {
    if (line.includes("node_modules")) continue;
    const match = line.match(/\(?([^()\s]+:\d+:\d+)\)?\s*$/);
    if (match) return clip(match[1]);
  }
  return "";
}

// -------------------------------------------------------------------
// configure - point the reporter at a live analytics channel.
//
// Called once with the app-shell analytics, and again by each game model so
// that an error inside a game is attributed to that game and to the right
// entity (host vs client) rather than to the shell.
// -------------------------------------------------------------------
export function configureErrorReporter(channel: GameAnalytics) {
  analytics = channel;
}

// -------------------------------------------------------------------
// reportError - the whole API.  Safe to call from anywhere, at any time,
// including before configure() (the error is logged and dropped).
// -------------------------------------------------------------------
export function reportError(source: ErrorSource, error: unknown, extra?: string) {
  try {
    const err = error instanceof Error ? error : undefined;
    const name = err?.name ?? typeof error;
    const message = err?.message ?? String(error);
    const where = originOf(err?.stack) || clip(extra ?? "");

    // Deduplicate on what the failure IS, not on when it happened.
    const signature = `${source}|${name}|${message}|${where}`;
    if (seen.has(signature)) return;
    seen.add(signature);

    // Always log, even past the cap: the console is the developer's copy and
    // costs nothing.  Only the reporting is capped.
    Logger.error(`[${source}] ${name}: ${message}${where ? ` @ ${where}` : ""}`);

    if (reportCount >= MAX_REPORTS_PER_SESSION) return;
    reportCount++;

    analytics?.track(AnalyticsEvent.ClientError, {
      error_source: source,
      error_name: clip(name),
      error_message: clip(message),
      error_where: where,
      // Which error of this page load this was.  A cluster of them says
      // "one thing is broken repeatedly", which reads very differently
      // from a single isolated crash.
      error_index: reportCount,
    });
  } catch {
    // Rule 1.  There is deliberately nothing here.
  }
}

// -------------------------------------------------------------------
// installGlobalErrorHandlers - catches what React cannot: a throw from an
// event handler, a timer, an async boundary, a rejected promise nobody
// awaited.  An error boundary sees none of those.
// -------------------------------------------------------------------
export function installGlobalErrorHandlers() {
  if (handlersInstalled || typeof window === "undefined") return;
  handlersInstalled = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    // A failed <img>/<audio> load also raises "error" on the window during
    // capture, but those carry no `error` and are not what this is for.
    if (!event.error && !event.message) return;
    reportError("window", event.error ?? event.message, `${event.filename}:${event.lineno}`);
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    reportError("promise", event.reason);
  });
}

// Test seam: forget everything this page load learned.
export function resetErrorReporterForTests() {
  analytics = undefined;
  reportCount = 0;
  seen.clear();
  handlersInstalled = false;
}
