import { ClusterFunPlayer } from "libs";
import { observable } from "mobx";

export enum LexiblePlayerStatus {
    Unknown = "Unknown",
    WaitingForStart = "WaitingForStart",
}

export class LexiblePlayer extends ClusterFunPlayer {
    @observable totalScore = 0;
    @observable status = LexiblePlayerStatus.Unknown;
    @observable message = "";
    @observable colorStyle= "#ffffff";
    @observable x = 0;
    @observable y = 0;
    @observable teamName = "X";
    @observable longestWord = "";
    @observable captures = 0;
}

// -------------------------------------------------------------------
// The Game state  
// -------------------------------------------------------------------
export enum LexibleGameState {
    EndOfRound = "EndOfRound",
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum LexibleGameEvent {
    ResponseReceived = "ResponseReceived",
    WordAccepted = "WordAccepted",
    TeamWon = "TeamWon"
}

//--------------------------------------------------------------------------------------
// 
//--------------------------------------------------------------------------------------
export enum MapSize {
    Small = "Small",
    Medium = "Medium", 
    Large = "Large"
}

export interface LexibleSettings {
    mapSize: MapSize,
    startFromTeamArea: boolean
}