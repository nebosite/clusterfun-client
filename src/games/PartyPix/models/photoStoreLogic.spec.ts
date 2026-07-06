import {
  INDEX_FILE_NAME,
  MANAGED_PREFIX,
  PhotoIndex,
  makeIndex,
  normalizeIndex,
  isImageName,
  photoFileName,
  indexAddPhoto,
  indexForget,
  selectVisible,
} from "./photoStoreLogic";

// -------------------------------------------------------------------
// Pure rules for the on-disk photo folder. The critical one is SAFETY:
// PartyPix must only ever delete files it created; a pre-existing folder image
// is hidden, never destroyed. These functions are the single source of that
// decision, so they are exhaustively pinned down here.
// -------------------------------------------------------------------

describe("makeIndex", () => {
  it("returns a fresh, empty, versioned index", () => {
    const i = makeIndex();
    expect(i).toEqual({ version: 1, photos: {}, hidden: [] });
  });
  it("returns independent instances", () => {
    const a = makeIndex();
    const b = makeIndex();
    a.photos["x.jpg"] = { author: "A", createdAt: 1 };
    a.hidden.push("y.png");
    expect(b.photos).toEqual({});
    expect(b.hidden).toEqual([]);
  });
});

describe("isImageName", () => {
  it("accepts common image extensions, case-insensitively", () => {
    for (const n of [
      "a.jpg",
      "a.jpeg",
      "A.JPG",
      "b.PNG",
      "c.gif",
      "d.webp",
      "e.bmp",
      "photo.final.JPEG",
      "partypix-123-1.jpg",
    ]) {
      expect(isImageName(n)).toBe(true);
    }
  });
  it("rejects non-images and the sidecar index", () => {
    for (const n of [
      "notes.txt",
      "movie.mp4",
      "archive.zip",
      "partypix-index.json",
      "jpg",
      "a.jpgx",
      "noext",
      "",
    ]) {
      expect(isImageName(n)).toBe(false);
    }
  });
});

describe("photoFileName", () => {
  it("uses the managed prefix, the timestamp, the counter, and .jpg", () => {
    expect(photoFileName(1700000000000, 1)).toBe(`${MANAGED_PREFIX}1700000000000-1.jpg`);
    expect(photoFileName(42, 7)).toBe("partypix-42-7.jpg");
  });
  it("is recognized as an image and as a managed (prefixed) name", () => {
    const name = photoFileName(1, 2);
    expect(isImageName(name)).toBe(true);
    expect(name.startsWith(MANAGED_PREFIX)).toBe(true);
  });
  it("produces distinct names for distinct counters at the same instant", () => {
    expect(photoFileName(1000, 1)).not.toBe(photoFileName(1000, 2));
  });
});

describe("normalizeIndex — robustness", () => {
  it("turns null / undefined / non-objects into a valid empty index", () => {
    for (const raw of [null, undefined, 5, "nope", true, NaN]) {
      expect(normalizeIndex(raw as any)).toEqual(makeIndex());
    }
  });
  it("does not throw on malformed JSON-shaped input and drops junk entries", () => {
    const raw = {
      version: "banana",
      photos: {
        "good.jpg": { author: "Alice", createdAt: 10 },
        "bad-meta.jpg": 42, // not an object -> skipped
        "partial.jpg": { author: 5, createdAt: "x" }, // coerced to defaults
        "nullmeta.jpg": null, // skipped
      },
      hidden: ["ok.png", 7, null, "ok2.jpg"], // non-strings filtered out
    };
    const i = normalizeIndex(raw);
    expect(i.version).toBe(1);
    expect(i.photos["good.jpg"]).toEqual({ author: "Alice", createdAt: 10 });
    expect(i.photos["partial.jpg"]).toEqual({ author: "", createdAt: 0 });
    expect(i.photos["bad-meta.jpg"]).toBeUndefined();
    expect(i.photos["nullmeta.jpg"]).toBeUndefined();
    expect(i.hidden).toEqual(["ok.png", "ok2.jpg"]);
  });
  it("handles photos/hidden being the wrong type", () => {
    expect(normalizeIndex({ photos: "nope", hidden: "nope" })).toEqual(makeIndex());
    expect(normalizeIndex({ photos: [1, 2], hidden: {} }).photos).toEqual({});
  });
});

describe("indexAddPhoto", () => {
  it("records an uploaded photo's author + createdAt", () => {
    const i = makeIndex();
    indexAddPhoto(i, "partypix-1-1.jpg", "Bob", 123);
    expect(i.photos["partypix-1-1.jpg"]).toEqual({ author: "Bob", createdAt: 123 });
  });
  it("un-hides a name that was previously hidden", () => {
    const i = makeIndex();
    i.hidden.push("partypix-1-1.jpg");
    indexAddPhoto(i, "partypix-1-1.jpg", "Bob", 123);
    expect(i.hidden).not.toContain("partypix-1-1.jpg");
    expect(i.photos["partypix-1-1.jpg"]).toBeDefined();
  });
});

describe("indexForget — the safety invariant", () => {
  it("DELETES only files PartyPix created (in index.photos)", () => {
    const i = makeIndex();
    indexAddPhoto(i, "partypix-1-1.jpg", "Bob", 1);
    const res = indexForget(i, "partypix-1-1.jpg");
    expect(res.deleteFile).toBe(true); // ours -> safe to delete
    expect(i.photos["partypix-1-1.jpg"]).toBeUndefined(); // dropped from index
    expect(i.hidden).not.toContain("partypix-1-1.jpg");
  });

  it("NEVER deletes a pre-existing file — it hides it instead", () => {
    const i = makeIndex();
    const res = indexForget(i, "grandma.jpg"); // a file we did NOT create
    expect(res.deleteFile).toBe(false); // must not delete a user's own photo
    expect(i.hidden).toContain("grandma.jpg");
    expect(i.photos["grandma.jpg"]).toBeUndefined();
  });

  it("does not duplicate a hidden entry when a pre-existing file is flagged twice", () => {
    const i = makeIndex();
    indexForget(i, "grandma.jpg");
    const res = indexForget(i, "grandma.jpg");
    expect(res.deleteFile).toBe(false);
    expect(i.hidden.filter((n) => n === "grandma.jpg")).toHaveLength(1);
  });

  it("a re-added-then-forgotten managed file deletes (still ours), not hides", () => {
    const i = makeIndex();
    indexAddPhoto(i, "partypix-9-9.jpg", "Bob", 5);
    indexForget(i, "partypix-9-9.jpg"); // deleteFile true, removed from photos
    indexAddPhoto(i, "partypix-9-9.jpg", "Bob", 6); // uploaded again
    const res = indexForget(i, "partypix-9-9.jpg");
    expect(res.deleteFile).toBe(true);
  });
});

describe("selectVisible", () => {
  function entries(...names: [string, number][]) {
    return names.map(([name, lastModified]) => ({ name, lastModified }));
  }

  it("always includes managed files with author/time from the index", () => {
    const i = makeIndex();
    indexAddPhoto(i, "partypix-1-1.jpg", "Alice", 100);
    const out = selectVisible(entries(["partypix-1-1.jpg", 999]), i, false);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      fileName: "partypix-1-1.jpg",
      author: "Alice",
      createdAt: 100, // index time, NOT the file's lastModified
      managed: true,
    });
  });

  it("excludes pre-existing images unless includeExisting is on", () => {
    const i = makeIndex();
    const es = entries(["grandma.jpg", 50]);
    expect(selectVisible(es, i, false)).toHaveLength(0);
    const withExisting = selectVisible(es, i, true);
    expect(withExisting).toHaveLength(1);
    expect(withExisting[0]).toEqual({
      fileName: "grandma.jpg",
      author: "", // pre-existing -> no author
      createdAt: 50, // uses lastModified
      managed: false,
    });
  });

  it("excludes hidden files (managed or not) and the index file and non-images", () => {
    const i = makeIndex();
    indexAddPhoto(i, "partypix-1-1.jpg", "Alice", 100);
    i.hidden.push("partypix-1-1.jpg"); // hidden even though managed
    i.hidden.push("grandma.jpg");
    const out = selectVisible(
      entries(
        ["partypix-1-1.jpg", 100],
        ["grandma.jpg", 50],
        [INDEX_FILE_NAME, 200],
        ["notes.txt", 10],
        ["visible.png", 30],
      ),
      i,
      true,
    );
    expect(out.map((p) => p.fileName)).toEqual(["visible.png"]);
  });

  it("sorts the result by createdAt ascending (managed by index time, existing by lastModified)", () => {
    const i = makeIndex();
    indexAddPhoto(i, "partypix-a.jpg", "A", 300);
    indexAddPhoto(i, "partypix-b.jpg", "B", 100);
    const out = selectVisible(
      entries(
        ["partypix-a.jpg", 1],
        ["partypix-b.jpg", 1],
        ["old.png", 50], // pre-existing, lastModified 50
        ["new.png", 200], // pre-existing, lastModified 200
      ),
      i,
      true,
    );
    expect(out.map((p) => p.createdAt)).toEqual([50, 100, 200, 300]);
    expect(out.map((p) => p.fileName)).toEqual([
      "old.png",
      "partypix-b.jpg",
      "new.png",
      "partypix-a.jpg",
    ]);
  });

  it("returns an empty list for an empty folder", () => {
    expect(selectVisible([], makeIndex(), true)).toEqual([]);
  });
});
