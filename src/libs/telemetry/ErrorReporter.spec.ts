import { GameAnalytics } from "./GameAnalytics";
import { ITelemetryLogger } from "./TelemetryLogger";
import { AnalyticsEvent, AnalyticsParams } from "./AnalyticsTypes";
import {
  configureErrorReporter,
  reportError,
  resetErrorReporterForTests,
  MAX_REPORTS_PER_SESSION,
} from "./ErrorReporter";

// ==========================================================================================
// The reporter exists so a crash on a guest's phone stops being invisible.  Its three rules
// are all failure modes that would make it worse than nothing:
//
//   never throw   - a reporter that breaks while reporting takes the app with it
//   never flood   - a render loop throws every frame; GA4 must not receive thousands of them
//   never send long values - GA4 truncates a parameter at 100 chars, so a raw stack arrives
//                   as a useless prefix and the real message is lost
// ==========================================================================================

interface Sent {
  event: string;
  params: AnalyticsParams;
}

function armed() {
  const sent: Sent[] = [];
  const logger: ITelemetryLogger = {
    logEvent: () => {},
    logPageView: () => {},
    logAnalyticsEvent: (event, params) => sent.push({ event, params: params as AnalyticsParams }),
  };
  configureErrorReporter(
    new GameAnalytics(logger, { game: "TestGame", deviceId: "dev1", entity: "client" }),
  );
  return sent;
}

beforeEach(() => resetErrorReporterForTests());

describe("ErrorReporter", () => {
  it("reports a react error with its name, message and origin", () => {
    const sent = armed();
    const err = new Error("things fell over");
    err.stack = "Error: things fell over\n    at Board (/src/games/X/Board.tsx:42:7)";

    reportError("react", err);

    expect(sent.length).toBe(1);
    expect(sent[0].event).toBe(AnalyticsEvent.ClientError);
    expect(sent[0].params.error_source).toBe("react");
    expect(sent[0].params.error_name).toBe("Error");
    expect(sent[0].params.error_message).toBe("things fell over");
    expect(sent[0].params.error_where).toBe("/src/games/X/Board.tsx:42:7");
  });

  it("stamps the standing dimensions like any other event", () => {
    const sent = armed();
    reportError("window", new Error("boom"));
    expect(sent[0].params.game).toBe("TestGame");
    expect(sent[0].params.entity).toBe("client");
    expect(sent[0].params.device_id).toBe("dev1");
  });

  it("sends the same failure only once, however often it repeats", () => {
    const sent = armed();
    // A throwing render loop does this every frame.
    for (let i = 0; i < 500; i++) reportError("react", new Error("same every frame"));
    expect(sent.length).toBe(1);
  });

  it("still reports genuinely different failures", () => {
    const sent = armed();
    reportError("react", new Error("first"));
    reportError("react", new Error("second"));
    expect(sent.length).toBe(2);
  });

  it("caps how many distinct failures one page load can send", () => {
    const sent = armed();
    for (let i = 0; i < MAX_REPORTS_PER_SESSION + 20; i++) {
      reportError("react", new Error(`different ${i}`));
    }
    expect(sent.length).toBe(MAX_REPORTS_PER_SESSION);
  });

  it("numbers the reports, so a storm is visible in the data", () => {
    const sent = armed();
    reportError("react", new Error("one"));
    reportError("react", new Error("two"));
    expect(sent[0].params.error_index).toBe(1);
    expect(sent[1].params.error_index).toBe(2);
  });

  it("clips long values, because GA4 drops everything past 100 characters", () => {
    const sent = armed();
    reportError("window", new Error("x".repeat(500)));
    const message = String(sent[0].params.error_message);
    expect(message.length).toBeLessThanOrEqual(91); // 90 + the ellipsis
    expect(message.endsWith("…")).toBe(true);
  });

  it("skips node_modules frames to find OUR code in the stack", () => {
    const sent = armed();
    const err = new Error("deep");
    err.stack = [
      "Error: deep",
      "    at invoke (/app/node_modules/react-dom/index.js:1:1)",
      "    at ourThing (/src/libs/Thing.ts:9:3)",
    ].join("\n");

    reportError("react", err);

    expect(sent[0].params.error_where).toBe("/src/libs/Thing.ts:9:3");
  });

  it("copes with something that is not an Error at all", () => {
    const sent = armed();
    expect(() => reportError("promise", "just a string")).not.toThrow();
    expect(sent[0].params.error_message).toBe("just a string");
  });

  it("does not throw when nothing has been configured yet", () => {
    // Startup: an error can happen before the analytics channel exists.
    expect(() => reportError("window", new Error("too early"))).not.toThrow();
  });

  it("does not throw when the analytics channel itself is broken", () => {
    const logger: ITelemetryLogger = {
      logEvent: () => {},
      logPageView: () => {},
      logAnalyticsEvent: () => {
        throw new Error("analytics is down");
      },
    };
    configureErrorReporter(new GameAnalytics(logger, { game: "G", deviceId: "d", entity: "host" }));
    expect(() => reportError("react", new Error("real problem"))).not.toThrow();
  });
});
