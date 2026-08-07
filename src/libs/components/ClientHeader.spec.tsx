import { fitTitleFontSize, TITLE_BASE_PX, TITLE_MIN_PX } from "./ClientHeader";

// ==========================================================================================
// The title region is a fixed 360px, and the stylesheet's 52px was picked against ONE font -
// its own comment says so. The header deliberately does not set a font-family, so whatever
// face the game uses applies, and a wide one overflows: "PASS THE AUX" in that game's Verdana
// measured 425px inside a 350px slot and was cut mid-word on every phone.
// ==========================================================================================
describe("fitting a text title into the brand region", () => {
  it("leaves a title that already fits completely alone", () => {
    expect(fitTitleFontSize(TITLE_BASE_PX, 300, 350, TITLE_MIN_PX)).toBe(TITLE_BASE_PX);
  });

  it("leaves a title that exactly fills the slot alone", () => {
    // Equal is not overflow - shrinking here would waste space on every well-behaved game.
    expect(fitTitleFontSize(TITLE_BASE_PX, 350, 350, TITLE_MIN_PX)).toBe(TITLE_BASE_PX);
  });

  it("shrinks in proportion to the overflow", () => {
    // The real case: 425 wanted, 350 available -> 52 * 350/425 = 42.8, floored.
    expect(fitTitleFontSize(52, 425, 350, 24)).toBe(42);
  });

  it("rounds DOWN, so the result never overflows by a fraction", () => {
    expect(fitTitleFontSize(52, 400, 350, 24)).toBe(45); // 45.5 exact
  });

  it("stops at the floor rather than shrinking a long name to nothing", () => {
    // Past this a title is unreadable anyway; better clipped than a smudge.
    expect(fitTitleFontSize(52, 5000, 350, 24)).toBe(24);
  });

  it("returns the base size when the slot has not been laid out yet", () => {
    // First paint can measure zero; dividing by it would give Infinity or NaN.
    expect(fitTitleFontSize(52, 425, 0, 24)).toBe(52);
    expect(fitTitleFontSize(52, 0, 0, 24)).toBe(52);
  });
});
