import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { Vector2 } from "libs/types";

// ==========================================================================================
// This file is the complete wire API between the client (player's phone) and the
// presenter (shared screen).  Every message crossing the relay is defined here as a
// MessageEndpoint<REQUEST, RESPONSE> with named request/response interfaces.
//
// Conventions (follow these for new endpoints):
//   - Name interfaces <Game><Thing>Request / <Game><Thing>Response (or ...Message for
//     fire-and-forget pushes).
//   - Route format: /games/<game>/<category>/<action> where category is one of:
//       lifecycle - join/onboard/round transitions
//       actions   - player inputs that change game state
//       juice     - cosmetic traffic (sounds, ephemeral effects); safe to drop
//   - Give request/response endpoints retry hints (suggestedRetryIntervalMs /
//     suggestedTotalLifetimeMs).  Fire-and-forget endpoints omit them.
//   - Keep payloads SMALL.  Clients may be phones on weak connections.
// ==========================================================================================

// ------------------------------------------------------------------------------------------
// Onboard Client - the client's one-stop request for full game state.  Called on join,
// on rejoin after a refresh, and whenever the presenter broadcasts InvalidateStateEndpoint.
// Put everything a client needs to (re)build its screen into this response.
// ------------------------------------------------------------------------------------------
export interface TemplateOnboardClientMessage {
  roundNumber: number;
  gameState: string;
  customText: string;
}

export const TemplateOnboardClientEndpoint: MessageEndpoint<unknown, TemplateOnboardClientMessage> =
  {
    route: "/games/template/lifecycle/onboard-client",
    suggestedRetryIntervalMs: 10000,
    suggestedTotalLifetimeMs: 60000,
  };

// ------------------------------------------------------------------------------------------
// Color change - example fire-and-forget player action
// ------------------------------------------------------------------------------------------
export interface TemplateColorChangeRequest {
  colorStyle: string;
}

export const TemplateColorChangeActionEndpoint: MessageEndpoint<TemplateColorChangeRequest, void> =
  {
    route: "/games/template/actions/color-change",
  };

// ------------------------------------------------------------------------------------------
// Message - example fire-and-forget player action carrying text
// ------------------------------------------------------------------------------------------
export interface TemplateMessageRequest {
  message: string;
}

export const TemplateMessageActionEndpoint: MessageEndpoint<TemplateMessageRequest, void> = {
  route: "/games/template/actions/message",
};

// ------------------------------------------------------------------------------------------
// Tap - example fire-and-forget player action carrying coordinates
// ------------------------------------------------------------------------------------------
export interface TemplateTapRequest {
  point: Vector2;
}

export const TemplateTapActionEndpoint: MessageEndpoint<TemplateTapRequest, void> = {
  route: "/games/template/actions/tap",
};
