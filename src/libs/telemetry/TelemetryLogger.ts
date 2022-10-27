import ReactGA from 'react-ga4';
import { MockTelemetryLogger } from '../../libs';

// -------------------------------------------------------------------
//  TrackingInfo - associates a name with unique tracking ID
// -------------------------------------------------------------------
export interface TrackingInfo {
    name: string,
    trackingId: string
}

export interface ITelemetryLoggerFactory {
    getLogger: (name: string) => ITelemetryLogger;
}

// -------------------------------------------------------------------
// TelemetryBag - Factory for telemetry loggers 
// -------------------------------------------------------------------
export class TelemetryLoggerFactory {
    trackingIds: TrackingInfo[]
    private _initializedTrackingIds = new Map<string, string>();

    // -------------------------------------------------------------------
    //  ctor
    // -------------------------------------------------------------------
    constructor(trackingIds: TrackingInfo[])
    {
        this.trackingIds = trackingIds;
    }

    // -------------------------------------------------------------------
    // Get one of the initialized loggers
    // -------------------------------------------------------------------
    getLogger(name: string) {
        const trackingInfo = this.trackingIds.find(id => id.name === name);
        if(!trackingInfo)
        {
            console.error("Error: No logger for " + name); 
            return new MockTelemetryLogger(name);
        }
        if(!this._initializedTrackingIds.has(name))
        {
            const trackingData = [{ trackingId: trackingInfo.trackingId, gaOptions: { name: trackingInfo.name } }]
            const debug = process.env.REACT_APP_DEVMODE === "development";
            ReactGA.initialize(trackingData, { testMode: debug });
            this._initializedTrackingIds.set(name, name);
        }
        return new TelemetryLogger(name)
    }

}


// -------------------------------------------------------------------
//  MockTelemetryLoggerFactory
// -------------------------------------------------------------------
export class MockTelemetryLoggerFactory {
    getLogger(name: string) {
        return new MockTelemetryLogger(name);
    }
}

// -------------------------------------------------------------------
//  ITelemetryLogger
// -------------------------------------------------------------------
export interface ITelemetryLogger {
    logEvent:(category: string, action: string, label?: string, value?: number)=>void;
    logPageView:(relativeUrl: string) => void;
}

// -------------------------------------------------------------------
//  TelemetryLogger
// -------------------------------------------------------------------
export class TelemetryLogger implements ITelemetryLogger
{
    private _name: string;

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(name: string){
        this._name = name;
    }

    // -------------------------------------------------------------------
    // logEvent 
    // -------------------------------------------------------------------
    logEvent(category: string, action: string, label?: string, value?: number)
    {
        ReactGA.event({ category, action, label, value }, [this._name]);
    }

    // -------------------------------------------------------------------
    //  logPageView
    // -------------------------------------------------------------------
    logPageView(relativeUrl: string)
    {
        ReactGA.send({ hitType: "pageview", page: "/" + this._name + "/" + relativeUrl });
    }
}