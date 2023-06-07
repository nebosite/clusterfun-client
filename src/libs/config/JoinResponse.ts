import { GameRole } from "./GameRole";

export interface JoinResponse {
    gameName: string;
    role: GameRole;
    isVip: boolean;
    roomId: string;
    presenterId: string;
    personalId: string;
    personalSecret: string;
}