import React, { CSSProperties } from "react";
export interface DevUIOptions {
    context?: {
        devFast: boolean;
        devPause: boolean;
    };
    style?: CSSProperties;
    children: React.ReactNode;
}
export default class DevUI extends React.Component<DevUIOptions> {
    render(): JSX.Element | null;
}
