import { ITelemetryLogger } from "../../libs";



export class MockTelemetryLogger implements ITelemetryLogger {
    constructor(public name: string) {
    }
    logEvent(category: string, action: string, label?: string, value?: number) {
        console.log(`TelemetryEvent(${this.name}): ${category}|${action}|${label}|${value}`)
    }
    logPageView(relativeUrl: string) {
        console.log(`TelemetryPageView(${this.name}): ${relativeUrl}`)
    }
}
