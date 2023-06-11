export interface ILocalRoomManager {
    /**
     * Create a new room and return its room ID
     */
    createRoom(): string;
    /**
     * Connect a user to a room using the given MessagePort
     * @param roomId The room ID to use
     * @param personalId The personal ID of the user
     * @param port The MessagePort to use
     */
    connectToRoom(roomId: string, personalId: string, port: MessagePort): void;
    /**
     * List all currently active rooms
     */
    listRooms(): string[];
}