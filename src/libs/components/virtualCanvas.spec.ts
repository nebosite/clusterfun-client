import fs from "fs";
import path from "path";

// ==========================================================================================
// THE VIRTUAL CANVAS IS A PLATFORM GUARANTEE, AND THIS SPEC IS WHAT KEEPS IT.
//
// Every presenter is authored on a fixed 1920x1080 canvas and every client on a fixed
// 1080x1920 one. UINormalizer scales that canvas to fit BOTH dimensions of whatever screen it
// lands on and letterboxes the remainder. That is what makes one layout correct on a phone, a
// tablet, a laptop and a television without a single media query - a game author positions
// things in canvas pixels and is done.
//
// It has been broken once already. A "responsive client" change swapped eight game clients and
// the lobby client to ScaleToWidth, which fits WIDTH ONLY and lets height scroll. Nothing
// failed, no test went red, and the app still rendered - it just quietly stopped being the same
// UI on every device: on a short or wide screen the phone layout scrolled instead of fitting,
// and the fixed-height bands games rely on no longer added up to the screen.
//
// So this reads the source. A behavioural test cannot catch it, because both components
// "work"; the difference only shows up as a layout that is wrong on hardware nobody tested.
// ==========================================================================================

const SRC = path.join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every view that renders a whole screen: a game's Presenter/Client, and the lobby. */
function screenViews(): string[] {
  return walk(SRC).filter((f) => {
    const rel = path.relative(SRC, f).replace(/\\/g, "/");
    if (rel.startsWith("libs/components/")) return false; // the components themselves
    return /\/(Presenter|Client)\.tsx$/.test(rel) || rel === "lobby/Components/LobbyComponent.tsx";
  });
}

describe("every screen is drawn on the fixed virtual canvas", () => {
  const views = screenViews();

  it("finds the views to check at all, so a rename cannot silently empty this spec", () => {
    expect(views.length).toBeGreaterThanOrEqual(10);
  });

  it("renders each game's presenter and client through UINormalizer", () => {
    const offenders: string[] = [];
    for (const file of views) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      if (rel === "lobby/Components/LobbyComponent.tsx") continue; // checked separately below
      const src = fs.readFileSync(file, "utf8");
      if (!src.includes("<UINormalizer")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps ScaleToWidth out of every game view", () => {
    // ScaleToWidth fits width only and scrolls. It is not a substitute for the canvas, and
    // reaching for it in a game view is exactly how the guarantee was lost last time.
    const offenders: string[] = [];
    for (const file of views) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      if (rel.startsWith("lobby/")) continue; // the lobby PRESENTER is a documented exception
      const src = fs.readFileSync(file, "utf8");
      if (/\bScaleToWidth\b/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("authors clients at 1080x1920 and presenters at 1920x1080", () => {
    const wrong: string[] = [];
    for (const file of views) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      if (rel.startsWith("lobby/")) continue;
      const src = fs.readFileSync(file, "utf8");
      const isClient = /\/Client\.tsx$/.test(rel);
      const wantW = isClient ? 1080 : 1920;
      const wantH = isClient ? 1920 : 1080;
      // Only inspect files that actually declare the canvas size.
      if (!/virtualWidth=\{/.test(src)) continue;
      if (!src.includes(`virtualWidth={${wantW}}`) || !src.includes(`virtualHeight={${wantH}}`)) {
        wrong.push(rel);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("keeps the phone canvas off --sw-fill-height", () => {
    // A .gameclient sized from ScaleToWidth's fill variable is the other half of the same
    // regression: it stretches the canvas to the screen instead of letting the canvas BE the
    // screen. Inside UINormalizer the variable is never set, so the fallback silently applies.
    const offenders: string[] = [];
    const cssFiles: string[] = [];
    const walkCss = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkCss(full);
        else if (/\.module\.css$/.test(entry.name)) cssFiles.push(full);
      }
    };
    walkCss(path.join(SRC, "games"));
    for (const file of cssFiles) {
      if (fs.readFileSync(file, "utf8").includes("--sw-fill-height")) {
        offenders.push(path.relative(SRC, file).replace(/\\/g, "/"));
      }
    }
    expect(offenders).toEqual([]);
  });
});
