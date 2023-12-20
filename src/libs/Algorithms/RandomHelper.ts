
//--------------------------------------------------------------------------------------
// Fast, seedable random coolness
//--------------------------------------------------------------------------------------
export class RandomHelper {
    private _rand = () => 0;

    //--------------------------------------------------------------------------------------
    // Call with no args for auto-seeding from current data
    //--------------------------------------------------------------------------------------
    constructor(
        seed1: number| undefined = undefined, 
        seed2: number = 1, 
        seed3: number = 2, 
        seed4: number = 3, 
    ) {
        if(seed1 === undefined) {
            seed1 =  Date.now() ^ 0xffffffff;
            seed2 =  (Date.now() >> 32) ^ 0xffffffff;
        }
        this._rand = this._sfc32(seed1, seed2, seed3, seed4);
    }

    //--------------------------------------------------------------------------------------
    // Random integer
    //--------------------------------------------------------------------------------------
    int(maxInt: number = 0x100000000) {
        return Math.floor(this._rand() * maxInt);
    }

    //--------------------------------------------------------------------------------------
    // Random floating point
    //--------------------------------------------------------------------------------------
    float(maxValue: number = 1.0) {
        return this._rand() * maxValue;
    }

    //--------------------------------------------------------------------------------------
    // Pick a random item from an array
    //--------------------------------------------------------------------------------------
    pick<T>(input: T[]) {
        return input[this.int(input.length)];
    }

    //--------------------------------------------------------------------------------------
    // Randomly pick N items from an array
    //--------------------------------------------------------------------------------------
    pickN<T>(input: T[], count: number) {
        const copy = [...input];
        this.shuffleInPlace(copy);
        return copy.slice(0, count);
    }

    //--------------------------------------------------------------------------------------
    // Shuffle an array
    //--------------------------------------------------------------------------------------
    shuffleInPlace<T>(input: T[]) {
        for(let i = input.length - 1; i > 0; i-- ) {
            const temp = input[i];
            const swapSpot = this.int(i);
            input[i] = input[swapSpot];
            input[swapSpot] = temp;
        }
    }

    //--------------------------------------------------------------------------------------
    // sfc32 is part of the PractRand random number testing suite. 
    // sfc32 has a 128-bit state and is very fast in JS.
    // see: https://github.com/bryc/code/blob/master/jshash/PRNGs.md
    //--------------------------------------------------------------------------------------
    private _sfc32(a:number, b:number, c:number, d:number) {
        return function() {
          a |= 0; b |= 0; c |= 0; d |= 0; 
          var t = (a + b | 0) + d | 0;
          d = d + 1 | 0;
          a = b ^ b >>> 9;
          b = c + (c << 3) | 0;
          c = (c << 21 | c >>> 11);
          c = c + t | 0;
          return (t >>> 0) / 4294967296;
        }
    }
}