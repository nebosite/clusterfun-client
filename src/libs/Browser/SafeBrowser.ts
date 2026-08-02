// -------------------------------------------------------------------
// The safebrowser class exposes browser APIs in a safe way so that
// attempting unsupported operations doesn't break the app
// -------------------------------------------------------------------
export class SafeBrowser {
  // -------------------------------------------------------------------
  // Return what kind of browser is running.  Note that on iOS, everything
  // is really the safari browser, so for chrome in iOS, both "chrome"
  // and "safari" will be true;
  // -------------------------------------------------------------------
  static isBrowser() {
    return {
      chrome: navigator.userAgent.indexOf("Chrome/") > -1,
      ie: navigator.userAgent.indexOf("MSIE") > -1,
      ie10: navigator.userAgent.indexOf("MSIE 10") > -1,
      ie11: navigator.userAgent.indexOf("MSIE 11") > -1,
      firefox: navigator.userAgent.indexOf("Firefox/") > -1,
      safari: navigator.userAgent.indexOf("Safari/") > -1,
      opera: navigator.userAgent.indexOf("Opera") > -1,
      presto: navigator.userAgent.indexOf("Presto/") > -1,
      edge: navigator.userAgent.indexOf("Edge/") > -1,
    };
  }

  // -------------------------------------------------------------------
  // vibrate - args are a series of millisecond timings for vibrate
  // and pause alternating
  // -------------------------------------------------------------------
  static vibrate(args: number[]) {
    if (navigator.vibrate && process.env.REACT_APP_DEVMODE !== "development") {
      navigator.vibrate(args);
    }
  }

  // -------------------------------------------------------------------
  // History.  A hash rather than a path, because the app is served as a static bundle:
  // a real path would 404 on refresh, a hash cannot.  Every call is guarded - an
  // embedded or sandboxed browser can refuse history access, and losing the lobby over
  // a decorative URL would be a poor trade.
  // -------------------------------------------------------------------
  static pushRoute(hash: string) {
    try {
      window.history.pushState({ clusterfunRoute: hash }, "", hash);
    } catch {
      /* a URL is a nicety; never break the app over one */
    }
  }

  /** Undo our own pushRoute, when the game was left by some means other than Back. */
  static dropRoute() {
    try {
      if (window.history.state?.clusterfunRoute) window.history.back();
    } catch {
      /* as above */
    }
  }

  static onPopState(handler: () => void): () => void {
    try {
      window.addEventListener("popstate", handler);
      return () => window.removeEventListener("popstate", handler);
    } catch {
      return () => {};
    }
  }
}
