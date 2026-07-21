// ==========================================================================================
// The bundled "safe" prompt bank (v1). Two shipped kinds:
//   - "text":  a scenario to act out ("The face you make when ...")
//   - "emoji": a big expressive face to mimic (copyright-free, ships as a character)
// A third kind, "image" (src -> a bundled/hosted picture), is supported by the wire types
// but ships NO files in v1 — celebrity / meme / host-added image packs are a deferred
// cut-line (see DESIGN.md). Add image files under assets/prompts/ and register them here.
// ==========================================================================================

export type PromptKind = "text" | "emoji" | "image";

export interface Prompt {
  id: string;
  kind: PromptKind;
  text?: string; // "text": the scenario; also used as the caption for "emoji"/"image"
  emoji?: string; // "emoji": the face to mimic
  src?: string; // "image": bundled/hosted image URL (none in v1)
}

// Wire-safe subset sent to a contestant's phone and shown on the reveal screen.
export interface PromptInfo {
  kind: PromptKind;
  text?: string;
  emoji?: string;
  src?: string;
}

export function toPromptInfo(p: Prompt): PromptInfo {
  return { kind: p.kind, text: p.text, emoji: p.emoji, src: p.src };
}

// -------------------------------------------------------------------------------------------
// Text scenarios — act out the face the sentence describes.
// -------------------------------------------------------------------------------------------
const TEXT_PROMPTS: Prompt[] = [
  {
    id: "t-cornchip",
    kind: "text",
    text: "The face you make when you bite into a soggy corn chip.",
  },
  { id: "t-surprise-party", kind: "text", text: "You walk in and forty people scream SURPRISE." },
  {
    id: "t-wrong-name",
    kind: "text",
    text: "A stranger just called you by the wrong name — again.",
  },
  {
    id: "t-last-slice",
    kind: "text",
    text: "Someone took the last slice of pizza. You saw it happen.",
  },
  { id: "t-brain-freeze", kind: "text", text: "Mid-slurp brain freeze at full intensity." },
  {
    id: "t-loud-yawn",
    kind: "text",
    text: "Trying to hide the biggest yawn of your life in a meeting.",
  },
  { id: "t-spicy", kind: "text", text: "You said 'it's not that spicy.' It is that spicy." },
  {
    id: "t-tripped",
    kind: "text",
    text: "You tripped in public and are pretending it was on purpose.",
  },
  {
    id: "t-baby-photo",
    kind: "text",
    text: "Looking at a baby you're told looks 'just like you.'",
  },
  {
    id: "t-wifi-down",
    kind: "text",
    text: "The Wi-Fi died one second before the upload finished.",
  },
  { id: "t-smell", kind: "text", text: "You just realized what that smell is." },
  {
    id: "t-plot-twist",
    kind: "text",
    text: "The movie's plot twist you absolutely did not see coming.",
  },
];

// -------------------------------------------------------------------------------------------
// Emoji faces — copy the expression as closely as you can.
// -------------------------------------------------------------------------------------------
const EMOJI_PROMPTS: Prompt[] = [
  { id: "e-scream", kind: "emoji", emoji: "😱", text: "Pure shock" },
  { id: "e-smug", kind: "emoji", emoji: "😏", text: "Absolute smugness" },
  { id: "e-cry-laugh", kind: "emoji", emoji: "😂", text: "Can't stop laughing" },
  { id: "e-wide-eyes", kind: "emoji", emoji: "😳", text: "Caught off guard" },
  { id: "e-suspicious", kind: "emoji", emoji: "🤨", text: "Deeply suspicious" },
  { id: "e-starstruck", kind: "emoji", emoji: "🤩", text: "Totally star-struck" },
  { id: "e-queasy", kind: "emoji", emoji: "🤢", text: "About to be sick" },
  { id: "e-sob", kind: "emoji", emoji: "😭", text: "Dramatic sobbing" },
  { id: "e-rage", kind: "emoji", emoji: "😠", text: "Furious" },
  { id: "e-sleepy", kind: "emoji", emoji: "🥱", text: "Fighting sleep" },
];

export const PROMPTS: Prompt[] = [...TEXT_PROMPTS, ...EMOJI_PROMPTS];

export const PROMPTS_BY_ID: Map<string, Prompt> = new Map(PROMPTS.map((p) => [p.id, p]));

export function getPrompt(id: string): Prompt | undefined {
  return PROMPTS_BY_ID.get(id);
}
