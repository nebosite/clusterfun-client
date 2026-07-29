import Logger from "js-logger";
import { ITelemetryLogger } from "./TelemetryLogger";
import {
  AnalyticsContext,
  AnalyticsEntity,
  AnalyticsEvent,
  AnalyticsParams,
  GameOutcome,
} from "./AnalyticsTypes";

// ==========================================================================================
// GameAnalytics - the one thing game code touches.
//
// It owns the standing dimensions (game, device, entity) and stamps them onto every event,
// so a game author writes only what is interesting about THIS event:
//
//     this.analytics.track("word_played", { length: 7 });
//
// The named methods below are the lifecycle events the base classes fire for every game
// automatically.  A game never has to call those - it gets them for free by extending
// ClusterfunPresenterModel / ClusterfunClientModel.
//
// Nothing in here may throw into game code: analytics failing is never a reason for a party
// game to stop.  Every call is wrapped.
// ==========================================================================================
export class GameAnalytics {
  private readonly logger: ITelemetryLogger;
  private readonly context: AnalyticsContext;

  constructor(logger: ITelemetryLogger, context: AnalyticsContext) {
    this.logger = logger;
    this.context = context;
  }

  get game() {
    return this.context.game;
  }
  get entity(): AnalyticsEntity {
    return this.context.entity;
  }
  get deviceId() {
    return this.context.deviceId;
  }

  // -------------------------------------------------------------------
  // track - send an event.  The three standing dimensions are added here,
  // and cannot be overridden by a caller's params, so a stray `game` key in
  // a game's own event can never corrupt the by-game reports.
  // -------------------------------------------------------------------
  track(event: AnalyticsEvent | string, params: AnalyticsParams = {}) {
    try {
      const payload: AnalyticsParams = {};
      // Drop undefined rather than send it - GA4 records the literal string
      // "undefined" otherwise, which quietly pollutes a dimension.
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) payload[key] = value;
      }
      payload.game = this.context.game;
      payload.device_id = this.context.deviceId;
      payload.entity = this.context.entity;
      this.logger.logAnalyticsEvent(event, payload);
    } catch (err) {
      Logger.warn(`Analytics event '${event}' failed: ${err}`);
    }
  }

  // -------------------------------------------------------------------
  // The standard lifecycle events (fired by the base classes)
  // -------------------------------------------------------------------

  // A game began.  One per game, from the host only.
  gameStarted(playerCount: number, replay: boolean = false) {
    this.track(AnalyticsEvent.GameStarted, { player_count: playerCount, replay });
  }

  // A game finished, however it finished.  `durationSeconds` is wall-clock from
  // gameStarted, so it includes pauses - which is the honest number for "how long does an
  // evening of this game take".
  gameEnded(outcome: GameOutcome, playerCount: number, durationSeconds: number) {
    this.track(AnalyticsEvent.GameEnded, {
      outcome,
      completed: outcome === "completed",
      player_count: playerCount,
      duration_seconds: Math.max(0, Math.round(durationSeconds)),
    });
  }

  // Someone joined for the first time
  playerJoined(playerCount: number) {
    this.track(AnalyticsEvent.PlayerJoined, { player_count: playerCount });
  }

  // Someone who had dropped out came back.  This is the lost-connection signal: the
  // presenter only takes this path for a player it had already lost.
  playerRejoined(playerCount: number, matchedBy: "id" | "name") {
    this.track(AnalyticsEvent.PlayerRejoined, {
      player_count: playerCount,
      matched_by: matchedBy,
    });
  }

  playerQuit(playerCount: number) {
    this.track(AnalyticsEvent.PlayerQuit, { player_count: playerCount });
  }

  joinDenied(reason: string) {
    this.track(AnalyticsEvent.JoinDenied, { reason });
  }

  // -------------------------------------------------------------------
  // A copy of this reporter pointed at a different game, for the lobby -
  // which starts life knowing no game and learns one when you pick it.
  // -------------------------------------------------------------------
  forGame(game: string): GameAnalytics {
    return new GameAnalytics(this.logger, { ...this.context, game });
  }
}
