import Logger from "js-logger";
import { ITelemetryLogger } from "../../libs";

// -------------------------------------------------------------------
//  MockTelemetryLoggerFactory
// -------------------------------------------------------------------
export class MockTelemetryLoggerFactory {
    getLogger(name: string) {
        return new MockTelemetryLogger(name);
    }
}

export class MockTelemetryLogger implements ITelemetryLogger {
    constructor(public name: string) {
    }
    logEvent(category: string, action: string, label?: string, value?: number) {
        Logger.info(`TelemetryEvent(${this.name}): ${category}|${action}|${label}|${value}`)
    }
    logPageView(relativeUrl: string) {
        Logger.info(`TelemetryPageView(${this.name}): ${relativeUrl}`)
    }
}
