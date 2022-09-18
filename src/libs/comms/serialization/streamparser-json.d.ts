declare module "@streamparser/json" {
    export class JSONParser {
        constructor(params: { 
            stringBufferSize?: number | undefined,
            numberBufferSize?: number | undefined,
            separator?: string,
            paths?: string[] 
        });
        onValue: (value: any, _key: string, _parent: object, stack: object[]) => void;
        write: (input: Iterable<Number> | string) => void;
    }
}