import MessageEndpoint from "libs/messaging/MessageEndpoint";

// -------------------------------------------------------------------
// The typed request/response API between PartyPix clients and presenter.
// Photos travel as base64 data-URL JPEG strings (downscaled on the phone).
// -------------------------------------------------------------------

// What a phone needs to render the "now showing" strip. The full-resolution
// image never leaves the presenter; phones only receive the small `thumb`.
export interface PartyPixSlideInfo {
  photoId: string;
  thumb: string; // small base64 JPEG data URL
  authorId: string;
  authorName: string;
  up: number;
  down: number;
  index: number; // 1-based position for display
  count: number; // total photos in the show
  youAuthored: boolean; // is the recipient the author?
}

export interface PartyPixOnboardResponse {
  state: string;
  credits: number;
  totalUp: number;
  untilNextCredit: number;
  slide: PartyPixSlideInfo | null;
}

// Client -> presenter: pull full state on join / reconnect / invalidate.
export const PartyPixOnboardEndpoint: MessageEndpoint<unknown, PartyPixOnboardResponse> = {
  route: "/games/partypix/lifecycle/onboard",
  suggestedRetryIntervalMs: 5000,
  suggestedTotalLifetimeMs: 30000,
};

// Client -> presenter: upload a photo (spends a credit). Echoes the
// authoritative remaining credit count back to the uploader.
export const PartyPixUploadEndpoint: MessageEndpoint<
  { full: string; thumb: string },
  { success: boolean; credits: number; error?: string }
> = {
  route: "/games/partypix/actions/upload",
  suggestedRetryIntervalMs: 4000,
  suggestedTotalLifetimeMs: 20000,
};

// Client -> presenter: vote on / flag a photo. Returns the updated tally.
export const PartyPixVoteEndpoint: MessageEndpoint<
  { photoId: string; kind: "up" | "down" | "delete" },
  { ok: boolean; up: number; down: number }
> = {
  route: "/games/partypix/actions/vote",
  suggestedRetryIntervalMs: 3000,
  suggestedTotalLifetimeMs: 12000,
};

// Presenter -> clients: the current slide changed (rotation / new photo /
// deletion / vote tally). `youAuthored` is filled per-recipient.
export const PartyPixSlidePushEndpoint: MessageEndpoint<{ slide: PartyPixSlideInfo | null }, void> =
  {
    route: "/games/partypix/push/slide",
  };

// Presenter -> clients: a player's credit standing changed (earned a credit,
// or their progress toward the next one moved).
export const PartyPixCreditsPushEndpoint: MessageEndpoint<
  { credits: number; totalUp: number; untilNextCredit: number },
  void
> = {
  route: "/games/partypix/push/credits",
};
