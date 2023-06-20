export interface ILocalRoomManager {
    /**
     * Connect a user to the room using the given MessagePort
     * @param roomId The room ID to use
     * @param personalId The personal ID of the user
     * @param port The MessagePort to use
     */
    connectToRoom(personalId: string, port: MessagePort): void;
}