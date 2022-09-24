export interface SequenceItem {
    id: string;
    delay_s: number;
    action: (controller: BaseAnimationController) => void;
}
export interface IAnimationStateControls {
    getAnimationSpeed: () => number;
    getAnimationPause: () => boolean;
}
interface Animation {
    startTime?: number;
    duration_ms: number;
    action: (fraction: number) => void;
    onFinish: () => void;
}
export declare class BaseAnimationController {
    sequence: SequenceItem[];
    animations: Animation[];
    private _nextStartTime;
    private _firstRun;
    get sequenceFinished(): boolean;
    get animationsFinished(): boolean;
    private _onFinish;
    constructor(onFinish?: () => void);
    advanceToNextItemInSequence(currentTime_ms: number): void;
    handleFrame(currentTime_ms: number): void;
    run(sequence: SequenceItem[]): void;
    push(addMe: SequenceItem | SequenceItem[]): void;
    slide(duration_seconds: number, action: (fraction: number) => void, onFinish?: () => void): void;
}
export {};
