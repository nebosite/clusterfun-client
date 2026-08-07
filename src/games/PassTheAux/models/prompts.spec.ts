import { PASS_THE_AUX_PROMPTS, parsePromptBlock } from "./prompts";

// prompts.ts stores its bank as a raw-text block parsed on import.  These tests pin that
// parse so an edit to the block (a stray blank line, a comment, pasted JS source) can't
// silently ship a broken prompt list.
//
// Two layers, on purpose:
//  - parsePromptBlock is tested against a synthetic block that actually contains comments,
//    blank lines and padding.  The shipped bank contains none of those, so exercising the
//    rules through it alone would pass no matter what the parser did with them.
//  - the shipped bank is then checked for SHAPE only.  No exact prompt count and no single
//    prompt's text is pinned: the block is meant to be edited freely (see its header
//    comment), so those assertions go red on every content edit without catching a defect.

describe("parsePromptBlock", () => {
  it("takes one prompt per line and drops blank lines", () => {
    expect(parsePromptBlock("\nfirst\n\n\nsecond\n")).toEqual(["first", "second"]);
  });

  it("drops comment lines", () => {
    expect(parsePromptBlock("# a heading\nkeep me\n#another\n")).toEqual(["keep me"]);
  });

  it("trims surrounding whitespace off each prompt", () => {
    expect(parsePromptBlock("   padded   \n\t tabbed\n")).toEqual(["padded", "tabbed"]);
  });

  it("drops whitespace-only lines", () => {
    expect(parsePromptBlock("real\n   \n\t\n")).toEqual(["real"]);
  });

  it("leaves punctuation inside a prompt alone", () => {
    const block = `Don't. I mean it!\n"A quoted prompt."\nTaco Bell - McDonald's, together\n`;
    expect(parsePromptBlock(block)).toEqual([
      "Don't. I mean it!",
      '"A quoted prompt."',
      "Taco Bell - McDonald's, together",
    ]);
  });
});

describe("PASS_THE_AUX_PROMPTS", () => {
  it("parses a full bank out of the raw block", () => {
    // A floor, not an exact count: adding prompts must not turn the suite red.  This still
    // catches the block being emptied, truncated, or failing to parse at all.
    expect(PASS_THE_AUX_PROMPTS.length).toBeGreaterThanOrEqual(40);
  });

  it("has no blank, whitespace-only, or untrimmed entries", () => {
    expect(PASS_THE_AUX_PROMPTS.every((p) => p.length > 0 && p === p.trim())).toBe(true);
  });

  it("carries no leftover source syntax (trailing commas)", () => {
    // A trailing comma is the unambiguous sign that JS array source got pasted into the
    // block.  Surrounding quotes are NOT checked: a prompt may legitimately BE a quoted
    // sentence (the bank has one), so that heuristic yields only false positives.
    expect(PASS_THE_AUX_PROMPTS.filter((p) => p.endsWith(","))).toEqual([]);
  });

  it("preserves apostrophes without escaping", () => {
    // The block is a backtick string, so apostrophes need no escape and must reach the game
    // verbatim - not as HTML entities from a bad copy-paste out of a web page.
    const withApostrophes = PASS_THE_AUX_PROMPTS.filter((p) => p.includes("'"));
    expect(withApostrophes.length).toBeGreaterThan(0);
    expect(PASS_THE_AUX_PROMPTS.filter((p) => /&#0?39;|&apos;|&quot;/.test(p))).toEqual([]);
  });

  it("has no duplicate prompts", () => {
    // A repeat would let the same scenario come up twice in one game's draw-without-repeats.
    expect(new Set(PASS_THE_AUX_PROMPTS).size).toBe(PASS_THE_AUX_PROMPTS.length);
  });
});
