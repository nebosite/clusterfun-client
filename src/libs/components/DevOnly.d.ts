import React, { CSSProperties } from "react";
export interface DevOnlyProps {
    style?: CSSProperties;
    children: React.ReactNode;
}
export class DevOnly extends React.Component<DevOnlyProps> {
    render(): JSX.Element | null;
}
