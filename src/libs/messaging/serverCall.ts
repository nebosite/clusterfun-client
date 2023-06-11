import { ServerHealthInfo } from "games/stressgame/models/HostModel";
import { GameInstanceProperties, GameRole } from "libs/config";

export interface IServerCall<TSeed> {
    /**
     * Returns a value that can be used to perfectly clone this ServerCall,
     * including connecting it to the same room. If the server call cannot be
     * cloned, TSeed will be "never" and this function will throw an error.
     */
    getSeed(): TSeed;
    /**
     * Get server health information, such as number of rooms and processor load
     * @returns A JSON object describing the server's current health at the time of call
     */
    amIHealthy(): PromiseLike<ServerHealthInfo>;
    /**
     * Starts a new game on the server
     * @param gameName The name of the game to start
     * @returns A set of credentials for connecting to the server
     */
    startGame(gameName: string): PromiseLike<GameInstanceProperties>;
    /**
     * Join an existing game
     * @param roomId The room to join
     * @param playerName The desired player name to use. All names in a room must be unique.
     * @param role The role to join as (either client or presenter)
     */
    joinGame(roomId: string, playerName: string, role: GameRole): PromiseLike<GameInstanceProperties>;
    /**
     * Terminate an existing game, booting out all participants except the host
     * @param roomId The room to terminate
     * @param hostSecret The secret credential given by the host - if this is incorrect, nothing happens
     */
    terminateGame(roomId: string, hostSecret: string): PromiseLike<void>;
}

/**
 * A ServerCall that makes its calls to a real origin
 */
export class ServerCallRealOrigin implements IServerCall<string> {
    origin: string;

    constructor(origin: string) {
        this.origin = origin;
    }

    getSeed(): string {
        return this.origin;
    }

    amIHealthy(): PromiseLike<ServerHealthInfo> {
        return this.get("/api/am_i_healthy");
    }


    startGame(gameName: string): PromiseLike<GameInstanceProperties> {
        return this.post("/api/startgame", { gameName });
    }

    joinGame(roomId: string, playerName: string, role: GameRole): PromiseLike<GameInstanceProperties> {
        return this.post("/api/joingame", { roomId, playerName, role });
    }

    terminateGame(roomId: string, hostSecret: string): PromiseLike<void> {
        return this.post("/api/terminategame", {  roomId, hostSecret });
    }

    private async get<T>(url: string): Promise<T> {
        const response = await fetch(origin + url, { method: "GET" });
        if (response.ok) {
            const streamText = await response.text();
            return await JSON.parse(streamText) as T
        } else {
            const responseBody = await response.text();
            throw new Error("Server call failed" + responseBody);
        }
    }

    private async post<T>(url: string, payload: any): Promise<T> {
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
}