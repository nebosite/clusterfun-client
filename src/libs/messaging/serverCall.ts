export type ServerCall = <T>(url: string, payload: any) => PromiseLike<T>;

export function createServerCallFromOrigin(origin: string): ServerCall {
    const result = (async function serverCall<T>(url: string, payload: any | undefined) {
        if(payload) {
            console.log("Attempting POST", url, payload);
            const response = await fetch(origin + url, {
                method: "POST",
                headers: [
                    ['Content-Type', 'application/json']
                ],
                body: JSON.stringify(payload)
            });
            if (response.ok) {
                console.log("Network resource fetched successfully");
                return await response.json() as T
            } else {
                console.log("Network resource failed to fetch");
                const responseBody = await response.text();
                throw new Error("Failed to connect to game: " + responseBody);
            }        
        }
        else {
            const response = await fetch(origin + url, { method: "GET" });
            if (response.ok) {
                const streamText = await response.text();
                return await JSON.parse(streamText) as T
            } else {
                const responseBody = await response.text();
                throw new Error("Server call failed" + responseBody);
            }        
        }
    })
    return result;
}