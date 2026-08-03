/// <reference types="react-scripts" />
// Game sound effects are AAC (.m4a): the same clips as PCM .wav were 4.7MB of
// the bundle against 0.4MB here, for audio nobody can tell apart through a
// phone speaker at a party.
declare module "*.m4a";
declare module "*.mp3";
declare module "*.png";
