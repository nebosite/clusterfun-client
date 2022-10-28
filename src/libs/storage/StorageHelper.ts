

export function getStorage(id: string) : IStorage
{
    const storageAvailble = typeof(SessionStorage) !== "undefined";

    //console.log(`Creating storage for '${id}' as ${storageAvailble ? "Local" : "Mocked" }`)
    return (storageAvailble)
        ? new SessionStorage(id, sessionStorage)
        : new SessionStorage(id, new MemoryAccessor());
}

// -------------------------------------------------------------------
// IStorage
// -------------------------------------------------------------------
export interface IStorage {

    set: (name: string, value: string) => void
    get: (name: string) => string | undefined | null;
    remove: (name: string) => void;
    clear: () => void
}

// -------------------------------------------------------------------
// IStorageAccessor
// -------------------------------------------------------------------
export interface IStorageAccessor
{
    setItem: (name: string, value: string) => void;
    getItem: (name: string) => string | undefined | null;
    removeItem: (name: string) => void;
    length: number;
    key: (index: number) => string | null;
}

// -------------------------------------------------------------------
// MemoryAccessor - for when sessionStorage is not available
// -------------------------------------------------------------------
class MemoryAccessor implements IStorageAccessor
{
    private _items = new Map<string, string>();
    setItem= (name: string, value: string) => this._items.set(name, value);
    getItem= (name: string)  => this._items.get(name);
    removeItem= (name: string) => this._items.delete(name);
    get length() { return this._items.size};
    key= (index: number) => Array.from(this._items.keys())[index];
}

// -------------------------------------------------------------------
// ClientStorage - for cookies n stuff
// -------------------------------------------------------------------
export class ClientStorage implements IStorageAccessor
{
    setItem= (name: string, value: string) => localStorage.setItem(name, value);
    getItem= (name: string)  => localStorage.getItem(name);
    removeItem= (name: string) => localStorage.removeItem(name);
    get length() { return localStorage.length};
    key= (index: number) => localStorage.key(index);
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
    constructor(id: string, accessor: IStorageAccessor) 
    {
        this._id = `[_${id}_]`;
        this._accessor = accessor;

        // Transfer storage into the cache
        for(let i = 0; i < 1000; i++)
        {
            const key = accessor.key(i);
            if(!key) break;
            this._cache.set(key, accessor.getItem(key));
        }
    }

    // -------------------------------------------------------------------
    // save
    // -------------------------------------------------------------------
    set(name: string, value: string) 
    {
        const key = this._id + name;
        if(value) {
            this._cache.set(key, value);
            this._accessor.setItem(key, value);
        }
        else{
            this._cache.delete(key);
            this._accessor.removeItem(key);
        }
    }

    // -------------------------------------------------------------------
    // get
    // -------------------------------------------------------------------
    get(name: string) 
    {
        const key = this._id + name;
        return this._cache.get(key);
    }

    // -------------------------------------------------------------------
    // remove
    // -------------------------------------------------------------------
    remove(name: string)
    {
        const key = this._id + name;
        this._cache.delete(key);
        this._accessor.removeItem(key);
    }

    // -------------------------------------------------------------------
    // clear
    // -------------------------------------------------------------------
    clear()
    {
        for(let key of this._cache.keys())
        {
            this._cache.delete(key);
            this._accessor.removeItem(key);
        }
        this._cache.clear();
    } 
}
