import Logger from "js-logger";
import { reportError } from "../telemetry/ErrorReporter";

// Browsers give a page somewhere around 5MB.  A single value this big is not yet fatal but
// it is heading that way, and it is far easier to act on a warning that names the key than
// on a quota error three rounds later.  PartyPix is the usual suspect: base64 images.
export const LARGE_VALUE_WARNING_BYTES = 2 * 1024 * 1024;

// -------------------------------------------------------------------
// reportStorageFailure - storage refused to keep something.
//
// Almost always a full quota.  The size is the whole diagnosis, so it is the
// thing that gets reported: "checkpoint was 4.2MB" tells you what to fix,
// where "QuotaExceededError" does not.
// -------------------------------------------------------------------
function reportStorageFailure(key: string, byteLength: number, err: unknown) {
  const kb = Math.round(byteLength / 1024);
  const message = `Could not save "${key}" (${kb}KB) - refresh-resume will not work for it`;
  Logger.error(`${message}: ${err}`);
  reportError("window", err instanceof Error ? err : new Error(String(err)), message);
}

export function getStorage(id: string): IStorage {
  const storageAvailble = typeof SessionStorage !== "undefined";

  Logger.debug(`Creating storage for '${id}' as ${storageAvailble ? "Local" : "Mocked"}`);
  return storageAvailble
    ? new SessionStorage(id, sessionStorage)
    : new SessionStorage(id, new MemoryAccessor());
}

// -------------------------------------------------------------------
// IStorage
// -------------------------------------------------------------------
export interface IStorage {
  set: (name: string, value: string) => void;
  get: (name: string) => string | undefined | null;
  remove: (name: string) => void;
  clear: () => void;
}

// -------------------------------------------------------------------
// IStorageAccessor
// -------------------------------------------------------------------
export interface IStorageAccessor {
  setItem: (name: string, value: string) => void;
  getItem: (name: string) => string | undefined | null;
  removeItem: (name: string) => void;
  length: number;
  key: (index: number) => string | null;
}

// -------------------------------------------------------------------
// MemoryAccessor - for when sessionStorage is not available
// -------------------------------------------------------------------
class MemoryAccessor implements IStorageAccessor {
  private _items = new Map<string, string>();
  setItem = (name: string, value: string) => this._items.set(name, value);
  getItem = (name: string) => this._items.get(name);
  removeItem = (name: string) => this._items.delete(name);
  get length() {
    return this._items.size;
  }
  key = (index: number) => Array.from(this._items.keys())[index];
}

// -------------------------------------------------------------------
// ClientStorage - for cookies n stuff
// -------------------------------------------------------------------
export class ClientStorage implements IStorageAccessor {
  setItem = (name: string, value: string) => localStorage.setItem(name, value);
  getItem = (name: string) => localStorage.getItem(name);
  removeItem = (name: string) => localStorage.removeItem(name);
  get length() {
    return localStorage.length;
  }
  key = (index: number) => localStorage.key(index);
}

// -------------------------------------------------------------------
// SessionStorage - partitioned Persistent storage
// -------------------------------------------------------------------
class SessionStorage implements IStorage {
  private _id: string;
  private _cache = new Map<string, string | undefined | null>();
  private _accessor: IStorageAccessor;

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(id: string, accessor: IStorageAccessor) {
    this._id = `[_${id}_]`;
    this._accessor = accessor;

    // Transfer storage into the cache
    for (let i = 0; i < 1000; i++) {
      const key = accessor.key(i);
      if (!key) break;
      this._cache.set(key, accessor.getItem(key));
    }
  }

  // -------------------------------------------------------------------
  // save
  // -------------------------------------------------------------------
  // -------------------------------------------------------------------
  // set
  //
  // Never throws.  A checkpoint save is called from a setTimeout, so a
  // QuotaExceededError here used to be an uncatchable async throw: the
  // headline "refresh and carry on where you were" feature simply stopped
  // working, silently, with nothing on screen and nothing in the log.
  //
  // The cache is still updated on failure, so the running game sees a
  // consistent view; only the durable copy is missing.
  // -------------------------------------------------------------------
  set(name: string, value: string) {
    const key = this._id + name;
    if (value) {
      this._cache.set(key, value);
      if (value.length > LARGE_VALUE_WARNING_BYTES) {
        Logger.warn(
          `Storing ${Math.round(value.length / 1024)}KB under "${key}". ` +
            `That is most of the browser's quota - consider excluding the big ` +
            `fields from the checkpoint via the type helper's shouldStringify.`,
        );
      }
      try {
        this._accessor.setItem(key, value);
      } catch (err) {
        reportStorageFailure(key, value.length, err);
      }
    } else {
      this._cache.delete(key);
      try {
        this._accessor.removeItem(key);
      } catch (err) {
        reportStorageFailure(key, 0, err);
      }
    }
  }

  // -------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------
  get(name: string) {
    const key = this._id + name;
    return this._cache.get(key);
  }

  // -------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------
  remove(name: string) {
    const key = this._id + name;
    this._cache.delete(key);
    this._accessor.removeItem(key);
  }

  // -------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------
  clear() {
    for (let key of this._cache.keys()) {
      this._cache.delete(key);
      this._accessor.removeItem(key);
    }
    this._cache.clear();
  }
}
