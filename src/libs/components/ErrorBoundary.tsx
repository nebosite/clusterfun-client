import React from "react";
import { reportError } from "../telemetry/ErrorReporter";

// -------------------------------------------------------------------
// Wrap elements in this so that errors in rendering code don't
// clobber the whole app
// -------------------------------------------------------------------
export class ErrorBoundary extends React.Component<
  { children: any[] | any },
  { errorMessage: string | undefined }
> {
  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(props: { children: any[] | any }) {
    super(props);
    this.state = { errorMessage: undefined };
  }

  // -------------------------------------------------------------------
  // Intercept errors
  //
  // Showing the message is only half the job: a guest reads "Something went
  // wrong", puts the phone down, and nobody ever finds out.  Reporting it is
  // what turns a ruined round into something that can be fixed.
  // -------------------------------------------------------------------
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // The component stack names the component that blew up, which the error's
    // own stack often does not once the code is minified.
    const componentStack = errorInfo?.componentStack ?? "";
    const firstFrame = componentStack.split("\n").find((line) => line.trim().length > 0);
    reportError("react", error, firstFrame?.trim());
    this.setState({ errorMessage: error.toString() });
  }

  // -------------------------------------------------------------------
  // Rended as an error if there was a problem
  // -------------------------------------------------------------------
  render(): JSX.Element | React.ReactNode {
    const { children } = this.props;
    const { errorMessage } = this.state;

    if (errorMessage) return <div>Something went wrong: {errorMessage}</div>;
    else return children;
  }
}
