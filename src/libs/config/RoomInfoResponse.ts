import { GameRole } from "./GameRole";

export interface RoomInfoResponse {
    game: string,
    userCount: number,
    presenterId?: string,
    vipId?: string,
    lastMessageTime?: number,
    users?: ({ id: string, name: string, role: GameRole })[]
}