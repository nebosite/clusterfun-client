// -------------------------------------------------------------------
// PhotoStore
//
// Browser glue for persisting PartyPix photos to a folder the presenter picks,
// via the File System Access API. The directory handle is remembered in
// IndexedDB so a refresh (same session) reuses it silently and a new session
// only needs a one-click permission re-grant — never a re-pick. Chromium-only;
// callers check isSupported() and fall back to in-memory when absent.
//
// All the "which files / what names / what to delete" decisions live in the
// pure photoStoreLogic module; this file only does the actual I/O + thumbnails.
// -------------------------------------------------------------------
import { scaleImageToJpeg } from "../views/imageUtil";
import { THUMB_IMAGE_EDGE, JPEG_QUALITY } from "./GameSettings";
import {
  INDEX_FILE_NAME,
  PhotoIndex,
  makeIndex,
  normalizeIndex,
  indexAddPhoto,
  indexForget,
  selectVisible,
  photoFileName,
} from "./photoStoreLogic";

const IDB_NAME = "partypix";
const IDB_STORE = "handles";
const IDB_KEY = "folder";

export type FolderPermission = "granted" | "prompt" | "denied" | "none" | "unsupported";

export interface LoadedPhoto {
  fileName: string;
  full: string;
  thumb: string;
  author: string;
  createdAt: number;
  managed: boolean;
}

export class PhotoStore {
  // `any` for the FS handle: the File System Access types aren't in this
  // project's TS lib, and the surface we touch is small.
  private _dir: any = null;
  private _includeExisting = false;
  private _counter = 0;

  isSupported(): boolean {
    return typeof window !== "undefined" && "showDirectoryPicker" in window;
  }

  hasFolder(): boolean {
    return !!this._dir;
  }

  get includeExisting(): boolean {
    return this._includeExisting;
  }

  get folderName(): string {
    return this._dir?.name ?? "";
  }

  // -------------------------------------------------------------------
  //  Restore the remembered folder without prompting. Returns the current
  //  permission state so the caller can either load silently ("granted") or
  //  surface a one-click reconnect ("prompt"/"denied").
  // -------------------------------------------------------------------
  async restore(): Promise<FolderPermission> {
    if (!this.isSupported()) return "unsupported";
    try {
      const rec = await this.idbGet();
      if (!rec || !rec.handle) return "none";
      this._dir = rec.handle;
      this._includeExisting = !!rec.includeExisting;
      const perm = await this._dir.queryPermission({ mode: "readwrite" });
      return perm as FolderPermission;
    } catch {
      return "none";
    }
  }

  // Requires a user gesture. Re-grants access to the remembered folder.
  async requestPermission(): Promise<boolean> {
    if (!this._dir) return false;
    try {
      const perm = await this._dir.requestPermission({ mode: "readwrite" });
      return perm === "granted";
    } catch {
      return false;
    }
  }

  // Requires a user gesture. Prompts the user to choose a folder and remembers it.
  async pickFolder(includeExisting: boolean): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      const dir = await (window as any).showDirectoryPicker({ mode: "readwrite", id: "partypix" });
      this._dir = dir;
      this._includeExisting = includeExisting;
      await this.idbSet(dir, includeExisting);
      return true;
    } catch {
      // User cancelled the picker, or it failed.
      return false;
    }
  }

  // -------------------------------------------------------------------
  //  Photos
  // -------------------------------------------------------------------
  async listPhotos(): Promise<LoadedPhoto[]> {
    if (!this._dir) return [];
    const index = await this.readIndex();

    const entries: { name: string; lastModified: number }[] = [];
    try {
      for await (const [name, handle] of this._dir.entries()) {
        if (handle.kind !== "file") continue;
        try {
          const file = await handle.getFile();
          entries.push({ name, lastModified: file.lastModified });
        } catch {
          /* skip unreadable entry */
        }
      }
    } catch {
      return [];
    }

    const visible = selectVisible(entries, index, this._includeExisting);
    const out: LoadedPhoto[] = [];
    for (const v of visible) {
      try {
        const fh = await this._dir.getFileHandle(v.fileName);
        const file = await fh.getFile();
        const full = await blobToDataUrl(file);
        const thumb = await this.makeThumb(full);
        out.push({ ...v, full, thumb });
      } catch {
        /* skip a file we can't read/decode */
      }
    }
    return out;
  }

  // Write an uploaded photo to disk and index it. Returns the file name (used
  // later to delete it) or null on failure.
  async savePhoto(full: string, author: string, createdAt: number): Promise<string | null> {
    if (!this._dir) return null;
    const fileName = photoFileName(createdAt, ++this._counter);
    try {
      const blob = await dataUrlToBlob(full);
      const fh = await this._dir.getFileHandle(fileName, { create: true });
      const writable = await fh.createWritable();
      await writable.write(blob);
      await writable.close();

      const index = await this.readIndex();
      indexAddPhoto(index, fileName, author, createdAt);
      await this.writeIndex(index);
      return fileName;
    } catch {
      return null;
    }
  }

  // Remove a photo from the show. Deletes the file only if PartyPix created it;
  // a pre-existing file is merely hidden (its own file is never destroyed).
  async forget(fileName: string): Promise<void> {
    if (!this._dir) return;
    try {
      const index = await this.readIndex();
      const { deleteFile } = indexForget(index, fileName);
      await this.writeIndex(index);
      if (deleteFile) {
        try {
          await this._dir.removeEntry(fileName);
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* best-effort */
    }
  }

  // -------------------------------------------------------------------
  //  Internals
  // -------------------------------------------------------------------
  private async readIndex(): Promise<PhotoIndex> {
    if (!this._dir) return makeIndex();
    try {
      const fh = await this._dir.getFileHandle(INDEX_FILE_NAME, { create: false });
      const file = await fh.getFile();
      const text = await file.text();
      return normalizeIndex(JSON.parse(text));
    } catch {
      return makeIndex();
    }
  }

  private async writeIndex(index: PhotoIndex): Promise<void> {
    if (!this._dir) return;
    const fh = await this._dir.getFileHandle(INDEX_FILE_NAME, { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(index));
    await writable.close();
  }

  private async makeThumb(fullDataUrl: string): Promise<string> {
    const img = await loadImage(fullDataUrl);
    return scaleImageToJpeg(img, THUMB_IMAGE_EDGE, JPEG_QUALITY);
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async idbGet(): Promise<{ handle: any; includeExisting: boolean } | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  private async idbSet(handle: any, includeExisting: boolean): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ handle, includeExisting }, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// --- small browser helpers ---
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}
