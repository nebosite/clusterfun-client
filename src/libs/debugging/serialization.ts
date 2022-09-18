export function thingString(thing: any){
    const output = new Array<string>();
    for(const property in thing)
    {
        if(property.indexOf("dispatch") !== -1) continue;
        if(property.indexOf("uctor") !== -1) continue;
        const value = `${property}:${thing[property]}`;
        if(value.indexOf(":function ") !== -1) continue;
        output.push(value)
    }
    return `{${output.join(",")}}`;
}
