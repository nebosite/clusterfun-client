// ==========================================================================================
// What it means to be a speech engine.
//
// Reading a word out to a room is one job, but there is more than one way to do it: the
// browser's own synthesiser, free and instant and a little different on every machine; or no
// words at all, just a noise with the right shape and rhythm.  Which of those a party wants
// depends on the room, so the choice belongs to the host at the start screen.
//
// Two neural engines (Kokoro and KittenTTS) were built behind this interface and then removed.
// They sounded better than either of these and were not worth what they cost: tens of
// megabytes fetched from a CDN, and - without a GPU - a two-second freeze of the shared screen
// every time anybody scored.  The interface is what made adding and dropping them cheap, and
// is worth keeping for the next one.
//
// Everything engine-specific lives behind this interface, INCLUDING getting ready.  That is
// the point of `initialize`: a heavyweight engine downloads a model and warms a runtime, and
// none of that may happen for an engine nobody picked.  The engines are loaded by dynamic
// import (see SpeechEngines.ts), so an unchosen engine's module is never even parsed - no
// library fetched, no weights downloaded, nothing put in the browser's cache.
// ==========================================================================================

/** The engines a host may pick between. */
export type SpeechEngineId = "browser" | "wahwah";

/**
 * Which of an engine's two contrasting voices to use.  Deliberately not a voice NAME: the
 * caller wants "the other team's voice", and every engine spells its voices differently.
 */
export type SpeechVoice = "first" | "second";

export interface SpeechVoiceOptions {
  /** Which of the two voices. Lexible uses one per team, so the room can follow along. */
  voice?: SpeechVoice;
  /** 0.5 - 2.0. Below 1 is slower. Engines that cannot vary rate ignore it. */
  speed?: number;
}

export interface ISpeechEngine {
  readonly id: SpeechEngineId;

  /**
   * Get ready to speak.  Called at most once, and awaited before any `speak`.
   *
   * THROW if this engine cannot run in this browser - a caller treats that as "use the
   * fallback noises from now on", which is always better than a game that waits.
   */
  initialize(): Promise<void>;

  /**
   * Say it, resolving only when the sound has FINISHED.
   *
   * Resolving early would let the next word start on top of this one, and two voices at once
   * is not two words - it is neither.  The queue that calls this relies on the promise being
   * honest about when the room has stopped hearing something.
   */
  speak(text: string, options: SpeechVoiceOptions): Promise<void>;

  /** Stop anything in flight and let go of whatever was allocated. */
  dispose(): void;
}

/** What a picker needs to show, without loading the engine to find out. */
export interface SpeechEngineInfo {
  id: SpeechEngineId;
  /** Short name for a button. */
  label: string;
  /** One line on the trade-off, for the host deciding. */
  description: string;
  /** True if using this engine fetches anything over the network. */
  downloads: boolean;
}
