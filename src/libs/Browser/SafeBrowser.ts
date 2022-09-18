

// -------------------------------------------------------------------
// The safebrowser class exposes browser APIs in a safe way so that
// attempting unsupported operations doesn't break the app
// -------------------------------------------------------------------
export class SafeBrowser
{
    // -------------------------------------------------------------------
    // Return what kind of browser is running.  Note that on iOS, everything
    // is really the safari browser, so for chrome in iOS, both "chrome"
    // and "safari" will be true;
    // -------------------------------------------------------------------
    static isBrowser()
    {
        return {
            chrome:     navigator.userAgent.indexOf('Chrome/') > -1,
            ie:         navigator.userAgent.indexOf('MSIE') > -1,
            ie10:       navigator.userAgent.indexOf('MSIE 10') > -1,
            ie11:       navigator.userAgent.indexOf('MSIE 11') > -1,
            firefox:    navigator.userAgent.indexOf('Firefox/') > -1,
            safari:     navigator.userAgent.indexOf('Safari/') > -1,
            opera:      navigator.userAgent.indexOf('Opera') > -1,
            presto:     navigator.userAgent.indexOf('Presto/') > -1,
            edge:       navigator.userAgent.indexOf('Edge/') > -1,
        }
    }

    // -------------------------------------------------------------------
    // vibrate - args are a series of millisecond timings for vibrate
    // and pause alternating
    // -------------------------------------------------------------------
    static vibrate(args: number[])
    {
        if(navigator.vibrate && process.env.REACT_APP_DEVMODE !== "development") {
            navigator.vibrate(args);
        }  
    }
}