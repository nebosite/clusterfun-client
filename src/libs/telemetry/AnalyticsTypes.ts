// ==========================================================================================
// The shape of ClusterFun analytics.
//
// Everything funnels through ONE GA4 property.  A game is a parameter on the event, not a
// separate property - that is what makes "which games get played the most" a single report
// instead of one report per game.
//
// Three dimensions ride on EVERY event, stamped by GameAnalytics so no caller can forget:
//   game    - which game the event came from ("Lobby" outside a game)
//   device  - a random per-browser id, so player counts and rejoins can be told apart
//   entity  - who sent it: the shared screen (host), a phone (client), or the lobby
// ==========================================================================================

// Who is reporting.  "host" is the shared screen running the game; "client" is a player's
// phone; "lobby" is the pre-game chooser, which belongs to no game yet.
export type AnalyticsEntity = "host" | "client" | "lobby";

// GA4 only accepts flat, scalar parameters
export type AnalyticsParams = Record<string, string | number | boolean | undefined>;

export interface AnalyticsContext {
  game: string;
  deviceId: string;
  entity: AnalyticsEntity;
}

// ------------------------------------------------------------------------------------------
// The standard events.  Games are free to send their own names through `track`, but these
// are the ones the base classes fire on their own, and the ones the questions we actually
// want answered are built from:
//
//   Which games get played the most?  -> count GameStarted, grouped by `game`
//   How many players participate?     -> player_count on GameStarted / GameEnded
//   How long does a game last?        -> duration_seconds on GameEnded
//   How often is it played to the end?-> outcome on GameEnded (completed vs abandoned)
//   How often is a game rejoined?     -> count PlayerRejoined, against PlayerJoined
// ------------------------------------------------------------------------------------------
export enum AnalyticsEvent {
  GameStarted = "cf_game_started",
  GameEnded = "cf_game_ended",
  PlayerJoined = "cf_player_joined",
  PlayerRejoined = "cf_player_rejoined",
  PlayerQuit = "cf_player_quit",
  JoinDenied = "cf_join_denied",
}

// How a game finished.  "completed" means it reached its own game-over; "abandoned" means
// the host closed or destroyed it while it was still playing.  Anything that simply stops
// being heard from is neither - it is never reported at all, which is worth remembering when
// reading completion rates.
export type GameOutcome = "completed" | "abandoned";
