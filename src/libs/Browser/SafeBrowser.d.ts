export declare class SafeBrowser {
    static isBrowser(): {
        chrome: boolean;
        ie: boolean;
        ie10: boolean;
        ie11: boolean;
        firefox: boolean;
        safari: boolean;
        opera: boolean;
        presto: boolean;
        edge: boolean;
    };
    static vibrate(args: number[]): void;
}
