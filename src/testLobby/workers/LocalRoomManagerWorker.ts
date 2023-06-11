// A shared worker that maintains a room and provides MessagePorts

import { IMessageThingReceiver, MessagePortMessageThingReceiver } from "libs";
import { ILocalRoomManager } from "./ILocalRoomManager";
import * as Comlink from "comlink";

class Room {
    roomId: string;
    roomInhabitants: Map<string, IMessageThingReceiver>

    constructor(roomId: string) {
        this.roomId = roomId;
        this.roomInhabitants = new Map();
    }
}

function generateRoomCode(): string {
    // Generate a random, 4-character room code,
    // ensuring it's all caps and avoiding vowels
    // Forbidden characters: 0, 1, 
    const randBuffer = new Uint32Array(1);
    global.crypto.getRandomValues(randBuffer);
    const scaled = Math.floor(randBuffer[0] / (2 ** 32) * (31 ** 4));
    return scaled.toString(31)
        .padStart(4, "0")
        .replace("a", "v")
        .replace("e", "w")
        .replace("i", "x")
        .replace("o", "y")
        .replace("u", "z")
        .replace("0", "k")
        .replace("1", "m")
        .replace("l", "q")
        .replace("u", "z")
        .toUpperCase();
}

class LocalRoomManager implements ILocalRoomManager {
    rooms: Map<string, Room> = new Map();
    createRoom(): string {
        let roomId: string;
        do {
            roomId = generateRoomCode();
        } while (this.rooms.has(roomId));
        this.rooms.set(roomId, new Room(roomId));
        return roomId;
    }
    connectToRoom(roomId: string, personalId: string, port: MessagePort): void {
        if (!this.rooms.has(roomId)) {
            throw new Error("Room ID does not exist: " + roomId);
        }
        new MessagePortMessageThingReceiver(port, this.rooms.get(roomId)!.roomInhabitants, personalId);
    }
    listRooms(): string[] {
        return Array.from(this.rooms.keys());
    }
}

const manager = new LocalRoomManager();

global.addEventListener("connect", (raw_event) => {
    const event = raw_event as unknown as MessageEvent;
    const port = event.ports[0];
    return Comlink.expose(manager, port);
})