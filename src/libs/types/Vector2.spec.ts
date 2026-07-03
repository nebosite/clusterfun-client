import { Vector2 } from "./Vector2";

// Vector2 is used for positions/taps sent between client and presenter.

describe("Vector2", () => {
  it("adds two vectors without mutating either operand", () => {
    const a = new Vector2(1, 2);
    const b = new Vector2(3, 4);
    const sum = a.add(b);
    expect(sum.x).toBe(4);
    expect(sum.y).toBe(6);
    // originals unchanged
    expect(a.x).toBe(1);
    expect(b.x).toBe(3);
  });

  it("subtracts two vectors", () => {
    const result = new Vector2(5, 7).subtract(new Vector2(2, 3));
    expect(result.x).toBe(3);
    expect(result.y).toBe(4);
  });

  it("formats as (x,y)", () => {
    expect(new Vector2(3, -4).toString()).toBe("(3,-4)");
  });

  it("length() returns the magnitude of the vector itself", () => {
    // NOTE: length() takes a parameter but ignores it - it always returns
    // the magnitude of `this`, not the distance to the argument.
    expect(new Vector2(3, 4).length(new Vector2(0, 0))).toBe(5);
    expect(new Vector2(3, 4).length(new Vector2(99, 99))).toBe(5);
  });
});
