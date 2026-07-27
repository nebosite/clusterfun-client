// Game-wide tuning constants.  Board/rule constants live in eittrisLogic.ts.
export const EittrisVersion = "0.1.0";

// Gesture classification on the phone (see Client.tsx)
export const FLICK_MAX_DURATION_MS = 300; // faster than this + far enough = a flick
export const FLICK_MIN_DISTANCE_PX = 40; // shorter than this is a drag/tap, not a flick
export const DRAG_ACTIVATION_PX = 12; // movement needed before drag commands start
export const TAP_MAX_DURATION_MS = 250; // down->up faster than this ...
export const TAP_MAX_DISTANCE_PX = 10; // ... with less movement than this = tap (rotate)
// After a flick fires, this many pointer-move events must land on the board
// before another flick is allowed.  A real second flick easily clears it;
// a phantom repeat (e.g. a flick that ended off-screen) never does.
export const FLICK_REARM_MOVES = 3;

// Presenter simulation
export const THUMBNAIL_INTERVAL_MS = 1000; // how often changed boards broadcast thumbnails
