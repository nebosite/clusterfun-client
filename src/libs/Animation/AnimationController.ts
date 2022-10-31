

// -------------------------------------------------------------------
// AnimationItem

import Logger from "js-logger";

// -------------------------------------------------------------------
export interface SequenceItem {
    id: string;
    delay_s: number;
    action: (controller: BaseAnimationController) => void;
}
export interface IAnimationStateControls
{
    getAnimationSpeed: ()=>number;
    getAnimationPause: ()=>boolean;
}

interface Animation {
    startTime?: number;
    duration_ms: number;
    action: (fraction: number) => void;
    onFinish: () => void;
}

// -------------------------------------------------------------------
// Provides general purpose animation functionality
// -------------------------------------------------------------------
export class BaseAnimationController
{
    sequence = new Array<SequenceItem>();
    animations = new Array<Animation>();
    
    private _nextStartTime = 0;
    private _firstRun = false;

    get sequenceFinished() {return this.sequence.length === 0}
    get animationsFinished() {return this.animations.length === 0}
    private _onFinish: ()=>void;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(onFinish: ()=>void = ()=>{}){
        this._onFinish = onFinish;
    }

    // -------------------------------------------------------------------
    // finish the current item and move to the next one
    // -------------------------------------------------------------------
    advanceToNextItemInSequence(currentTime_ms: number)
    {
        if(this.sequence.length === 0)
        {
            this._onFinish();
            return;
        }
        
        const hack = this.sequence.splice(0,1)[0]; 
        if(!hack) Logger.warn("WEIRD: nothing removed")

        if(!this.sequenceFinished)
        {
            this._nextStartTime = currentTime_ms + this.sequence[0].delay_s * 1000;   
        }
    }

    // -------------------------------------------------------------------
    // handleFrame - execute a single frame of animation at the specified time
    // -------------------------------------------------------------------
    handleFrame(currentTime_ms: number)
    {
        if(this._firstRun && !this.sequenceFinished)
        {
            this._firstRun = false;
            this._nextStartTime = currentTime_ms + this.sequence[0].delay_s * 1000;   
        }
        
        if(this._nextStartTime <= currentTime_ms && !this.sequenceFinished)
        {
            this.sequence[0].action(this);  
            this.advanceToNextItemInSequence(currentTime_ms);
        }

        const animationsToRemove = new Array<Animation>();
        const animate = (animation: Animation) =>
        {
            if(!animation.startTime || animation.startTime === -1) animation.startTime = currentTime_ms;
            let fraction = (currentTime_ms - animation.startTime)/animation.duration_ms;
            if(fraction < 0) fraction = 0;
            if(fraction > 1.0) fraction = 1.0;
            animation.action(fraction);
            if(fraction >= 1.0) {
                animationsToRemove.push(animation);
                if(animation.onFinish) animation.onFinish();
            }          
        }

        this.animations.forEach(a => animate(a))
        animationsToRemove.forEach(a =>
            {
                const index = this.animations.indexOf(a);
                if(index > -1) this.animations.splice(index,1);
            });

    }

    // -------------------------------------------------------------------
    // run - start executing a set of sequential animations
    // -------------------------------------------------------------------
    run(sequence: SequenceItem[]) {
        if(this.sequence.length === 0)
        {
            this._firstRun = true;
        }
        this.push(sequence);
    }

    // -------------------------------------------------------------------
    // push - add an animation or animations to the front of the queue
    // -------------------------------------------------------------------
    push(addMe: SequenceItem | SequenceItem[]) {
        if(addMe instanceof Array) this.sequence = ([] as SequenceItem[]).concat(addMe, this.sequence)
        else this.sequence.push(addMe);
    }

    // -------------------------------------------------------------------
    // start a sliding animation - runs about 30 fps
    // -------------------------------------------------------------------
    slide(duration_seconds: number, 
        action: (fraction: number) => void,
        onFinish: ()=> void = ()=>{}) {
        this.animations.push({
            startTime: -1,
            duration_ms: duration_seconds * 1000,
            action,
            onFinish        
        })
    }

}
