import React from "react";
export declare class ErrorBoundary extends React.Component<{
    children: any[] | any;
}, {
    errorMessage: string | undefined;
}> {
    constructor(props: {
        children: any[] | any;
    });
    componentDidCatch(error: Error, errorInfo: Object): void;
    render(): JSX.Element | React.ReactNode;
}
