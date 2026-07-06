// -------------------------------------------------------------------
// photoStoreLogic
//
// Pure, framework-free rules for the on-disk photo folder: which files are
// photos, how PartyPix names the files it creates, and the bookkeeping of the
// sidecar index (author names + which files are ours vs. pre-existing). The
// browser glue (File System Access API, IndexedDB, canvas thumbnails) lives in
// PhotoStore.ts and delegates every decision here so it can be unit-tested.
//
// Safety rule encoded here: PartyPix only ever DELETES files it created. A
// flag/removal of a pre-existing folder image just HIDES it (recorded in the
// sidecar's `hidden` list) so we never destroy a user's own photos.
// -------------------------------------------------------------------

export const INDEX_FILE_NAME = "partypix-index.json";
export const MANAGED_PREFIX = "partypix-";

// The sidecar index written into the chosen folder.
export interface PhotoIndex {
  version: number;
  // Files PartyPix created (uploaded photos), keyed by file name.
  photos: Record<string, { author: string; createdAt: number }>;
  // Pre-existing files a player flagged away — hidden from the show, not deleted.
  hidden: string[];
}

export function makeIndex(): PhotoIndex {
  return { version: 1, photos: {}, hidden: [] };
}

// Defensively coerce whatever was parsed from disk into a valid index.
export function normalizeIndex(raw: any): PhotoIndex {
  const index = makeIndex();
  if (raw && typeof raw === "object") {
    if (raw.photos && typeof raw.photos === "object") {
      for (const [name, meta] of Object.entries<any>(raw.photos)) {
        if (meta && typeof meta === "object") {
          index.photos[name] = {
            author: typeof meta.author === "string" ? meta.author : "",
            createdAt: typeof meta.createdAt === "number" ? meta.createdAt : 0,
          };
        }
      }
    }
    if (Array.isArray(raw.hidden)) {
      index.hidden = raw.hidden.filter((n: any) => typeof n === "string");
    }
  }
  return index;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;

export function isImageName(name: string): boolean {
  return IMAGE_EXT.test(name);
}

// File name for a photo PartyPix creates. The prefix lets us recognize our own
// files (so "don't include existing" can filter to just ours, and deletion only
// ever touches ours). The createdAt + counter keep names unique within a run.
export function photoFileName(createdAt: number, counter: number): string {
  return `${MANAGED_PREFIX}${createdAt}-${counter}.jpg`;
}

// Record a newly-saved uploaded photo. Un-hides the name if it was hidden.
export function indexAddPhoto(
  index: PhotoIndex,
  fileName: string,
  author: string,
  createdAt: number,
): PhotoIndex {
  index.photos[fileName] = { author, createdAt };
  index.hidden = index.hidden.filter((n) => n !== fileName);
  return index;
}

// Forget a photo. If it's one of ours, drop it from the index and report that
// the caller should delete the file. If it's pre-existing, just hide it (never
// delete someone's own file).
export function indexForget(index: PhotoIndex, fileName: string): { deleteFile: boolean } {
  if (index.photos[fileName]) {
    delete index.photos[fileName];
    return { deleteFile: true };
  }
  if (!index.hidden.includes(fileName)) index.hidden.push(fileName);
  return { deleteFile: false };
}

export interface VisiblePhoto {
  fileName: string;
  author: string;
  createdAt: number;
  managed: boolean; // did PartyPix create this file?
}

// Decide which of the folder's files appear in the slideshow, in order.
// - our uploaded files always appear (author/time from the index);
// - pre-existing images appear only when `includeExisting` is on (no author);
// - hidden files, the index file itself, and non-images never appear.
export function selectVisible(
  entries: { name: string; lastModified: number }[],
  index: PhotoIndex,
  includeExisting: boolean,
): VisiblePhoto[] {
  const hidden = new Set(index.hidden);
  const out: VisiblePhoto[] = [];
  for (const entry of entries) {
    if (entry.name === INDEX_FILE_NAME) continue;
    if (!isImageName(entry.name)) continue;
    if (hidden.has(entry.name)) continue;

    const managedMeta = index.photos[entry.name];
    if (managedMeta) {
      out.push({
        fileName: entry.name,
        author: managedMeta.author,
        createdAt: managedMeta.createdAt,
        managed: true,
      });
    } else if (includeExisting) {
      out.push({ fileName: entry.name, author: "", createdAt: entry.lastModified, managed: false });
    }
  }
  out.sort((a, b) => a.createdAt - b.createdAt);
  return out;
}
