import React from "react";
export interface ClusterCanvasProps {
    canvasId: string;
    width: number;
    height: number;
    onClick?: (x: number, y: number) => void;
}
export class ClusterCanvas extends React.Component<ClusterCanvasProps> {
    canvasId: string;
    isMousing: boolean;
    canvasContext?: CanvasRenderingContext2D;
    w: number;
    h: number;
    mouseWidth: number;
    mouseHeight: number;
    mouseStartX: number;
    mouseStartY: number;
    mouseDownTime: number;
    moveDelta: number;
    canvasScreenOffset: {
        left: number;
        top: number;
    };
    constructor(props: ClusterCanvasProps);
    handleMouseDown: (event: React.MouseEvent) => void;
    handleMouseUp: (event: React.MouseEvent) => void;
    handleMouseMove: (event: React.MouseEvent) => void;
    componentDidMount(): void;
    componentWillUnmount(): void;
    handleResize: () => void;
    render(): JSX.Element;
}
