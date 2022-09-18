import React from "react";

// -------------------------------------------------------------------
// Wrap elements in this so that errors in rendering code don't 
// clobber the whole app
// -------------------------------------------------------------------
export class ErrorBoundary extends React.Component<{children: any[] | any}, {errorMessage: string | undefined}> {
    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: {children: any[] | any}) {
        super(props);
        this.state = { errorMessage: undefined };
    }
  
    // -------------------------------------------------------------------
    // Intercept errors
    // -------------------------------------------------------------------
    componentDidCatch(error: Error, errorInfo: Object): void {
        this.setState({ errorMessage: error.toString() });
    }
  
    // -------------------------------------------------------------------
    // Rended as an error if there was a problem
    // -------------------------------------------------------------------
    render(): JSX.Element | React.ReactNode {
        const { children } = this.props;
        const { errorMessage } = this.state;
  
        if (errorMessage) return (<div>Something went wrong: {errorMessage}</div>);
        else return children;
    }
  }
  