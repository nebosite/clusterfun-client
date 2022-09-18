declare module "@streamparser/json" {
    export class JsonParser {
        onValue: (value: any, _key: string, _parent: object, stack: object[]) => void;
        write: (input: Iterable<Number> | string) => void;
    }
}