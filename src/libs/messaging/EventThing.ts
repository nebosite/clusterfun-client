// ---------------------------------------------------------------------------------
// Simple event handling
// ---------------------------------------------------------------------------------
export class EventThing<T>
{
    private subscribers = new Map<string, (...args: T[]) => void>();
    name: string;

    constructor(name: string)
    {
        this.name = name;
    }

    subscribe(name: string, callMe: (arg: T) => void)
    {
        this.subscribers.set(name, callMe);
    }

    unsubscribe(name: string)
    {
        this.subscribers.delete(name);
    }

    invoke(...args: T[])
    {
        for(let callMe of this.subscribers.values())
        {
            console.debug(`invoke: ${this.name}: ${callMe}` )
            callMe(...args);
        }
    }
}