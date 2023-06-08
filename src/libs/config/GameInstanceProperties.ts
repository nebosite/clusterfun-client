import { GameRole } from "./GameRole.js";

export interface GameInstanceProperties {
    gameName: string;
    role: GameRole;
    roomId: string;
    hostId: string;
    personalId: string;
    personalSecret: string;
}