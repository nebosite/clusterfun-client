import Logger from "js-logger";
import { ITelemetryLogger } from "../../libs";



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
