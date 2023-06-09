import { ClusterFunPlayer } from "libs";
import { observable } from "mobx";

export enum TestatoPlayerStatus {
    Unknown = "Unknown",
    WaitingForStart = "WaitingForStart",
}

export class TestatoPlayer extends ClusterFunPlayer {
    @observable totalScore = 0;
    @observable status = TestatoPlayerStatus.Unknown;
    @observable message = "";
    @observable colorStyle= "#ffffff";
    @observable x = 0;
    @observable y = 0;
}

// -------------------------------------------------------------------
// The Game state  
// -------------------------------------------------------------------
export enum TestatoGameState {
    Playing = "Playing",
    EndOfRound = "EndOfRound",
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum TestatoGameEvent {
    ResponseReceived = "ResponseReceived",
}