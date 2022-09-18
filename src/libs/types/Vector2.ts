
export class Vector2 {
    x: number
    y: number

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    add(addThis: Vector2) {
        return new Vector2(addThis.x + this.x, addThis.y + this.y)
    }

    subtract(subtractMe: Vector2) {
        return new Vector2(this.x - subtractMe.x, this.y - subtractMe.y)
    }

    length(addMe: Vector2) {
        return Math.sqrt(this.x * this.x + this.y * this.y)
    }

    toString(): string{
        return `(${this.x},${this.y})`
    }
}