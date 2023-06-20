// A worker that maintains a room and provides MessagePorts

// NOTE: This is currently a separate worker as an artifact of a previous
// attempt to make this room a SharedWorker, though it does have the current
// benefit of causing room routing (and room-to-host communication) to be
// handled away from the Web Worker.

import { IMessageThingReceiver, MessagePortMessageThingReceiver } from "libs";
import { ILocalRoomManager } from "./ILocalRoomManager";
import * as Comlink from "comlink";

class Room {
    roomInhabitants: Map<string, IMessageThingReceiver>

    constructor() {
        this.roomInhabitants = new Map();
    }
}

class LocalRoomManager implements ILocalRoomManager {
    room: Room = new Room()
    connectToRoom(personalId: string, port: MessagePort): void {
        new MessagePortMessageThingReceiver(port, this.room.roomInhabitants, personalId);
    }
}

const manager = new LocalRoomManager();
Comlink.expose(manager);