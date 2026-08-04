import fs from "fs";
import path from "path";

// ==========================================================================================
// The engines must stay behind DYNAMIC imports.
//
// This is the one property of the speech system that no behavioural test can see and that a
// well-meaning tidy-up would silently destroy: turning
//
//     await import("./KokoroSpeechEngine")        into        import { KokoroSpeechEngine }
//
// still passes every other test in this repo, and still plays every word correctly.  What it
// costs is that webpack folds the module into the main bundle, so a host who chose "wahwah"
// now downloads and parses Kokoro's module on page load - and the whole reason the choice
// exists is that some rooms cannot afford that.
//
// Reading the source is crude, and it is the only place the guarantee actually lives.
// ==========================================================================================

const HERE = path.join(__dirname);
const ENGINE_MODULES = ["BrowserSpeechEngine", "WahwahSpeechEngine"];

const read = (file: string) => fs.readFileSync(path.join(HERE, file), "utf8");

/** Static `import ... from "x"` / `export ... from "x"` lines, ignoring `await import(...)`. */
function staticImportTargets(source: string): string[] {
  const targets: string[] = [];
  const pattern = /^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) targets.push(match[1]);
  return targets;
}

describe("engines are only reachable by dynamic import", () => {
  it("the registry does not statically import any engine", () => {
    const targets = staticImportTargets(read("SpeechEngines.ts"));
    for (const engine of ENGINE_MODULES) {
      expect(targets.some((t) => t.includes(engine))).toBe(false);
    }
  });

  it("the registry does reach every engine, by dynamic import", () => {
    const source = read("SpeechEngines.ts");
    for (const engine of ENGINE_MODULES) {
      expect(source).toContain(`await import("./${engine}")`);
    }
  });

  it("the barrel does not re-export an engine, which would pull them all in", () => {
    // `export * from "./KokoroSpeechEngine"` in index.ts would bundle it for every importer
    // of "libs", which is everyone.
    const targets = staticImportTargets(read("index.ts"));
    for (const engine of ENGINE_MODULES) {
      expect(targets.some((t) => t.includes(engine))).toBe(false);
    }
  });

  it("SpeechHelper does not import an engine either", () => {
    const targets = staticImportTargets(
      fs.readFileSync(path.join(HERE, "..", "SpeechHelper.ts"), "utf8"),
    );
    for (const engine of ENGINE_MODULES) {
      expect(targets.some((t) => t.includes(engine))).toBe(false);
    }
  });

  it("no shared module names a CDN url or a model to fetch", () => {
    // Nothing here downloads anything today - Kokoro and KittenTTS were removed.  The guard
    // stays because the interface exists precisely so another one can be added, and the
    // failure it catches is a fetch that happens for a host who declined it.
    const COSTS = ["cdn.jsdelivr.net", "esm.sh", "huggingface.co", "from_pretrained"];
    for (const file of ["SpeechEngines.ts", "index.ts", "ISpeechEngine.ts"]) {
      const code = stripComments(read(file));
      for (const cost of COSTS) expect(code).not.toContain(cost);
    }
  });

  it("neither surviving engine fetches anything at all", () => {
    for (const engine of ENGINE_MODULES) {
      const code = stripComments(read(`${engine}.ts`));
      expect(code).not.toContain("import(");
      expect(code).not.toContain("fetch(");
    }
  });
});

/** Crude but sufficient: block comments and line comments out of a TS source. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
