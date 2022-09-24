import { isMobile } from 'react-device-detect';
const packageInfo = require("../package.json");

export class GLOBALS {
    static Version = packageInfo.version;
    static Title = `ClusterFun.tv ${(process.env.REACT_APP_DEVMODE === "development") ? "DEV": "" } ${GLOBALS.Version}`;
    static IsMobile = isMobile;
}