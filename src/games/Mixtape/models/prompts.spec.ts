import { MIXTAPE_PROMPTS } from "./prompts";

// prompts.ts stores its bank as a raw-text block parsed on import.  These tests pin that
// parse so an edit to the block (a stray blank line, a comment, an accidental quote) can't
// silently ship a broken prompt list.

describe("MIXTAPE_PROMPTS", () => {
  it("parses one prompt per non-blank line", () => {
    expect(MIXTAPE_PROMPTS.length).toBe(40);
  });

  it("has no blank or whitespace-only entries", () => {
    expect(MIXTAPE_PROMPTS.every((p) => p.length > 0)).toBe(true);
  });

  it("carries no leftover source syntax (surrounding quotes / trailing commas)", () => {
    const dirty = MIXTAPE_PROMPTS.filter(
      (p) => p.startsWith('"') || p.endsWith('"') || p.endsWith(","),
    );
    expect(dirty).toEqual([]);
  });

  it("ignores comment lines", () => {
    expect(MIXTAPE_PROMPTS.some((p) => p.startsWith("#"))).toBe(false);
  });

  it("preserves apostrophes without escaping", () => {
    expect(MIXTAPE_PROMPTS).toContain("Best song for a New Year's Eve countdown");
  });
});
