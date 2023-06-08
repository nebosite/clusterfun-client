/**
 * Interface for controlling lifecycle events on a remote host model,
 * such as starting, pausing, and exiting the game.
 * 
 * This interface should contain the public methods that are called
 * by the Presenter view to control the host thread (e.g. starting the next
 * round). It is intended to be accessible on the UI thread of the
 * device that the host is running on (be it a client or presenter).
 * 
 * Note that this interface, or its derivations, should NOT contain
 * methods or callbacks for conveying information to be displayed
 * on the presenter. That information should be pushed using the
 * messaging system to the presenter user.
 */
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