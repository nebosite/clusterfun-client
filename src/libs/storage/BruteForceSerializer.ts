export const objectDump = (thing: any, depth: number = 0) => {
    if(thing === undefined) { return "[undefined]" } 
    if(thing === null) { return "[null]" } 
    if(thing.toLowerCase) { return `'${thing}'` } 
    if(Number.isFinite(thing)) { return `${thing}` } 
    if(thing === false || thing === true) { return `${thing}` } 

    const prefix = " ".repeat(depth * 4)
    let output = "";
    if(Array.isArray(thing))  {
        output += "[\n"
        for(let i = 0; i < thing.length; i++)
        {
            output += `${prefix}    ${objectDump(thing[i], depth+ 1)}\n`
        }
        output += `${prefix}]`     
        return output;    
    }

    output  = `{\n`
    for(let property in thing) {
        output += `${prefix}    ${property}: ${objectDump(thing[property], depth+ 1)}\n`
    }
    output += `${prefix}}`
    return output;
}

export class BruteForceSerializer
{
    private _objectCount = 0;
    typeHelper: ITypeHelper;

    maxObjects: number

    //-------------------------------------------------------------------------------
    // ctor
    //-------------------------------------------------------------------------------
    constructor(typeHelper: ITypeHelper, maxOjects: number = 20000)
    {
        this.typeHelper = typeHelper;
        this.maxObjects = maxOjects;
    }

    //-------------------------------------------------------------------------------
    // Turn object into a JSON string 
    //-------------------------------------------------------------------------------
    stringify(serializeMe: any, compact: boolean = false)
    {
        const serializable = this.normalize(serializeMe,"OBJ"); 
        if(compact) return JSON.stringify(serializable);
        else return JSON.stringify(serializable,null,2);
    }

    //-------------------------------------------------------------------------------
    // Turn any piece of data into something we can serialize with the built in 
    // JSON serializer.  We do this by accounting for references and removing type
    // specific junk. 
    //-------------------------------------------------------------------------------
    private normalize(normalizeMe: any, path: string, lookup: Map<object, number> | undefined = undefined)
    {
        if(normalizeMe === null) return null;
        if(lookup && lookup.size > this.maxObjects) {
            throw Error(`BruteForceSerializer.normalize: Max objects reached on ${path}`)
        }

        const myType = typeof normalizeMe;
        switch(myType)
        {
            case "boolean":
            case "number":
            case "string":
            case "bigint":
            case "symbol":      return normalizeMe;
            case "object":      break;
            case "undefined":   return null;
            default:            return `Unhandled object type: ${myType}`
        }
        
        if(Array.isArray(normalizeMe))
        {
            const arrayOut:any[] = []
            for(let i = 0; i < normalizeMe.length; i++)
            {
                arrayOut.push(this.normalize(normalizeMe[i],`${path}[${i}]`,lookup))
            }
            return arrayOut;
        }

        if(!lookup) lookup = new Map<object, number>();

        // If we have seen the object already, then we return
        // a token to indicate the reference id
        if(lookup.has(normalizeMe)) return `~~${lookup.get(normalizeMe)}`

        // Each new object has an id and a type name
        const output:any = {
            __i: this._objectCount++,
            __t: this.typeHelper.getTypeName(normalizeMe)
        };

        // Remember that we have seen this object
        lookup.set(normalizeMe,output.__i);

        // Maps are special = output kvp's as an array
        if(normalizeMe instanceof Map) 
        {
            output.__kv = [];

            Array.from(normalizeMe.keys()).forEach(k => 
                output.__kv.push( [this.normalize(k,`${path}.key:`,lookup), this.normalize(normalizeMe.get(k),`${path}.value`,lookup)])
            );
            return output;
        }

        if (normalizeMe instanceof Set) {
            output.__kv = Array.from(normalizeMe.values()).map(v => this.normalize(v, `${path}.value:`, lookup));
            return output;
        }

        // It's an object to handle the properties
        for(const propertyName in normalizeMe)
        {
            if(!this.typeHelper.shouldStringify(output.__t, propertyName, normalizeMe))
            {
                continue;
            } 

            const value = normalizeMe[propertyName]
            // Don't serialize class code
            if(propertyName === "__proto__") continue;
            if (typeof value === 'function') continue;

            // Don't serialize if the value isn't there
            const normalized = this.normalize(value,`${path}.${propertyName}`, lookup);
            if(normalized !== null) output[propertyName] = normalized;
        }
        return output;
    }

    //-------------------------------------------------------------------------------
    // Reconstruct our special json output into real objects
    //-------------------------------------------------------------------------------
    parse<T>(jsonText: string) {

        const stagedData = JSON.parse(jsonText);
        const lookup = new Map<number, object>();

        const parseData = (node: any) => {
            // Quick return on simple types
            switch(typeof node)
            {
                case "string":
                    // Strings that start with ~~ point to objects
                    if((node as string).match(/^~~/)) {
                        return lookup.get(parseInt((node as string).substr(2)))  
                    }
                    return node;
                case "number":
                case "boolean":
                case "bigint":
                case "undefined":
                    return node;
            }

            let nodeObject:any = null;

            // If this is an object, then construct it.
            if(node.__i !== undefined)
            {
                switch(node.__t)
                {
                    // MapTypes are special
                    case "Map": 
                        const outputMap = new Map();
                        for(let i = 0; i < node.__kv.length; i++)
                        {
                            const key = parseData(node.__kv[i][0])
                            const value = parseData(node.__kv[i][1])
                            outputMap.set(key,value)
                        }
                        return outputMap;
                    case "Set":
                        const outputSet = new Set(node.__kv.map(parseData));
                        return outputSet;
                    case "Object":
                        nodeObject = {};
                        break;
                    default:
                        nodeObject = this.typeHelper.constructType(node.__t) as any;
                        break;
                }
                lookup.set(node.__i, nodeObject); 
            }

            // Arrays are special
            if(Array.isArray(node))
            {
                const arrayOut:any[] = []
                for(let i = 0; i < node.length; i++)
                {
                    arrayOut.push(parseData(node[i]))
                }
                return arrayOut;
            }
    
            // Now we are a regular object, so handle properties
            for(const propertyName in node)
            {
                // ignore utility properties
                switch(propertyName)
                {
                    case "__i":
                    case "__t":
                    case "__kv":
                                continue;
                }
                const data = parseData(node[propertyName]);
                nodeObject[propertyName] = this.typeHelper.reconstitute( node.__t, propertyName, data );
            }
            return nodeObject;
        }

        return parseData(stagedData) as T;
    }
}

//-------------------------------------------------------------------------------
// Implement this interface to construct types for the parser
//-------------------------------------------------------------------------------
export interface ITypeHelper{
    // Gives the name for the root model type that will be used to instantiate the game
    rootTypeName: string;

    // Return the type name to use for the given object
    getTypeName(o: object): string | undefined;

    // This return a clean construction for the specified type
    constructType(typeName: string): object;

    // Use this to exclude data from serialization
    shouldStringify(typeName: string, propertyName: string, object: any): boolean;
    
    // Use this to override how some data is reconstituted.  e.g.: turn a regular
    // array into an observable array.  Return the rehydrated object if there
    // is nothing to do. 
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any): any;
}

