import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { ZonePoint } from "./collageBoardLogic";

// ==========================================================================================
// The complete wire API between CollageBoard clients (phones) and the presenter.
// Outlines are polygons in normalized 0..1 board coordinates.  Images travel as
// base64 JPEG data URLs, downscaled on the phone (patch = the zone's bounding box)
// or on the presenter (the small composite preview phones navigate over).
// ==========================================================================================

// An active claim, as clients see it: who owns it, their color, and the outline.
export interface CollageZoneInfo {
  zoneId: string;
  playerId: string;
  playerName: string;
  color: string;
  points: ZonePoint[];
}

// ------------------------------------------------------------------------------------------
// Onboard - the client's one-stop request for full game state.  Called on join,
// on rejoin after a refresh, and whenever the presenter broadcasts InvalidateState.
// ------------------------------------------------------------------------------------------
export interface CollageBoardOnboardResponse {
  state: string;
  playerColor: string;
  preview: string | null; // small composite JPEG of the current collage
  zones: CollageZoneInfo[];
}

export const CollageBoardOnboardEndpoint: MessageEndpoint<unknown, CollageBoardOnboardResponse> = {
  route: "/games/collageboard/lifecycle/onboard",
  suggestedRetryIntervalMs: 5000,
  suggestedTotalLifetimeMs: 30000,
};

// ------------------------------------------------------------------------------------------
// Claim zone - ask to select an outline.  Claims are advisory (they never block
// other players), but the presenter validates geometry and replaces any prior
// claim by the same player.
// ------------------------------------------------------------------------------------------
export interface CollageBoardClaimZoneRequest {
  points: ZonePoint[];
}

export interface CollageBoardClaimZoneResponse {
  granted: boolean;
  zoneId?: string;
  reason?: string;
}

export const CollageBoardClaimZoneEndpoint: MessageEndpoint<
  CollageBoardClaimZoneRequest,
  CollageBoardClaimZoneResponse
> = {
  route: "/games/collageboard/actions/claim-zone",
  suggestedRetryIntervalMs: 3000,
  suggestedTotalLifetimeMs: 12000,
};

// ------------------------------------------------------------------------------------------
// Release zone - the player backed out of the camera without committing.
// ------------------------------------------------------------------------------------------
export interface CollageBoardReleaseZoneRequest {
  zoneId: string;
}

export const CollageBoardReleaseZoneEndpoint: MessageEndpoint<
  CollageBoardReleaseZoneRequest,
  void
> = {
  route: "/games/collageboard/actions/release-zone",
};

// ------------------------------------------------------------------------------------------
// Commit photo - the captured image for a claimed zone.  `image` is a JPEG data
// URL of the zone's bounding box; the presenter clips it to the outline when
// painting.  The response confirms the paint so the phone can free the zone.
// ------------------------------------------------------------------------------------------
export interface CollageBoardCommitPhotoRequest {
  zoneId: string;
  image: string;
}

export interface CollageBoardCommitPhotoResponse {
  ok: boolean;
  reason?: string;
}

export const CollageBoardCommitPhotoEndpoint: MessageEndpoint<
  CollageBoardCommitPhotoRequest,
  CollageBoardCommitPhotoResponse
> = {
  route: "/games/collageboard/actions/commit-photo",
  suggestedRetryIntervalMs: 5000,
  suggestedTotalLifetimeMs: 25000,
};

// ------------------------------------------------------------------------------------------
// Zones push - the set of active claims changed (claim / release / commit /
// expiry).  Sent to everyone so phones can show what's being edited.
// ------------------------------------------------------------------------------------------
export interface CollageBoardZonesPushMessage {
  zones: CollageZoneInfo[];
}

export const CollageBoardZonesPushEndpoint: MessageEndpoint<CollageBoardZonesPushMessage, void> = {
  route: "/games/collageboard/push/zones",
};

// ------------------------------------------------------------------------------------------
// Preview push - the collage changed; here is a fresh navigation preview.
// Throttled on the presenter so bursts of commits don't flood phones.
// ------------------------------------------------------------------------------------------
export interface CollageBoardPreviewPushMessage {
  preview: string;
}

export const CollageBoardPreviewPushEndpoint: MessageEndpoint<
  CollageBoardPreviewPushMessage,
  void
> = {
  route: "/games/collageboard/push/preview",
};
