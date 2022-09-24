import React, { CSSProperties } from "react";
export interface DevOnlyProps {
    style?: CSSProperties;
    children: React.ReactNode;
}
export default class DevOnly extends React.Component<DevOnlyProps> {
    render(): JSX.Element | null;
}
