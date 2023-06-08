export interface IClusterfunHostLifecycleController {
    /**
     * Starts the game from the lobby
     */
    startGame(): void;
    /**
     * Pauses the current game
     */
    pauseGame(): void;
    /**
     * Resumes the current game
     */
    resumeGame(): void;
    /**
     * Ends the current game, kicking all users
     */
    endGame(): void;
}