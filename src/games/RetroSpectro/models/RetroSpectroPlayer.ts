export enum RetroSpectroPlayerStatus {
    Waiting = "WaitingForStart",
    Answering = "Answering",
    Answered = "Answered",
    Voting = "Voting",
    Voted = "Voted"
}

export interface RetroSpectroPlayer {
    playerId: string;
    name: string;
    totalScore: number;
    scoreThisRound: number;
    status: RetroSpectroPlayerStatus;
    answer: string;
    votes: number[];
    winner: boolean;
}
