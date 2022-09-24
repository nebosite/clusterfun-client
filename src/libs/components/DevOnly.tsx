import React, { CSSProperties } from "react";
import styles from './DevOnly.module.css';

export interface DevOnlyProps {
    style?: CSSProperties;
    children: React.ReactNode;
}

export class DevOnly extends React.Component<DevOnlyProps>
{
    render() {
        return (process.env.REACT_APP_DEVMODE !== "development") 
        ? null
        : <div className={styles.devOnlyBox} style={this.props.style}> {this.props.children} </div>;
    }
}