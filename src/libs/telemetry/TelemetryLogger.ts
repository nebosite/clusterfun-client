import Logger from "js-logger";
import ReactGA from "react-ga4";
import { MockTelemetryLogger } from "../../libs";
import { AnalyticsParams } from "./AnalyticsTypes";

// -------------------------------------------------------------------
//  TrackingInfo - associates a name with unique tracking ID
// -------------------------------------------------------------------
export interface TrackingInfo {
  name: string;
  trackingId: string;
}

export interface ITelemetryLoggerFactory {
  getLogger: (name: string) => ITelemetryLogger;
}

// -------------------------------------------------------------------
// TelemetryBag - Factory for telemetry loggers
// -------------------------------------------------------------------
export class TelemetryLoggerFactory {
  trackingIds: TrackingInfo[];
  private _defaultTrackingId?: TrackingInfo;
  private _initializedTrackingIds = new Map<string, string>();

  // -------------------------------------------------------------------
  //  ctor
  // -------------------------------------------------------------------
  constructor(trackingIds: TrackingInfo[]) {
    this.trackingIds = trackingIds;
    this._defaultTrackingId = this.trackingIds.find((id) => id.name === "DEFAULT");
  }

  // -------------------------------------------------------------------
  // Get one of the initialized loggers
  // -------------------------------------------------------------------
  getLogger(name: string) {
    const trackingInfo = this.trackingIds.find((id) => id.name === name) ?? this._defaultTrackingId;
    if (!trackingInfo) {
      Logger.error("Error: No tracking id found for " + name);
      return new MockTelemetryLogger(name);
    }
    // Keyed by TRACKING ID, not by the requested name.  Now that every game
    // falls through to DEFAULT, keying by name would re-initialize the same
    // measurement id once per game - and gtag would then send every event
    // twice over.
    if (!this._initializedTrackingIds.has(trackingInfo.trackingId)) {
      Logger.info(`Tracking id for ${name} is ${trackingInfo.trackingId}`);
      const trackingData = [
        { trackingId: trackingInfo.trackingId, gaOptions: { name: trackingInfo.name } },
      ];
      const debug = process.env.REACT_APP_DEVMODE === "development";
      ReactGA.initialize(trackingData, { testMode: debug });
      this._initializedTrackingIds.set(trackingInfo.trackingId, trackingInfo.name);
    }
    // The logger reports through the tracker that was actually configured -
    // which is DEFAULT's name for a game with no entry of its own.  Naming a
    // tracker that was never initialized silently drops every event.
    return new TelemetryLogger(trackingInfo.name, name);
  }
}

// -------------------------------------------------------------------
//  ITelemetryLogger
// -------------------------------------------------------------------
export interface ITelemetryLogger {
  logEvent: (category: string, action: string, label?: string, value?: number) => void;
  logPageView: (relativeUrl: string) => void;
  // GA4-native: a flat event name plus arbitrary scalar parameters.  This is what
  // GameAnalytics uses; the category/action/label form above is the older UA-shaped
  // API kept for the call sites that still use it.
  logAnalyticsEvent: (event: string, params: AnalyticsParams) => void;
}

// -------------------------------------------------------------------
//  TelemetryLogger
// -------------------------------------------------------------------
export class TelemetryLogger implements ITelemetryLogger {
  // The configured gtag tracker to report through
  private _trackerName: string;
  // What asked for this logger (a game name, or "lobby") - used for page views
  private _sourceName: string;

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(trackerName: string, sourceName: string = trackerName) {
    this._trackerName = trackerName;
    this._sourceName = sourceName;
  }

  // -------------------------------------------------------------------
  // logEvent
  // -------------------------------------------------------------------
  logEvent(category: string, action: string, label?: string, value?: number) {
    ReactGA.event({ category, action, label, value }, [this._trackerName]);
  }

  // -------------------------------------------------------------------
  // logAnalyticsEvent - a GA4 event with real parameters.  Reported on the
  // default tracker rather than a named one: ClusterFun sends everything to a
  // single property and separates games with the `game` parameter.
  // -------------------------------------------------------------------
  logAnalyticsEvent(event: string, params: AnalyticsParams) {
    ReactGA.event(event, params);
  }

  // -------------------------------------------------------------------
  //  logPageView
  // -------------------------------------------------------------------
  logPageView(relativeUrl: string) {
    ReactGA.send({ hitType: "pageview", page: "/" + this._sourceName + "/" + relativeUrl });
  }
}
