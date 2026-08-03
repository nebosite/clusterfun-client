// -------------------------------------------------------------------
// The server's manifest entry.  The manifest is the ONLY authority on
// which games exist in production and how they are labelled - alpha,
// beta, debug, or release (no tag).  Editing a tag is a server change
// and needs a server deploy.
// -------------------------------------------------------------------
export interface GameManifestItem {
  name: string;
  displayName?: string;
  tags: string[];
}

// -------------------------------------------------------------------
// A game in the client's registry (gamesListRelease / gamesListDebug).
// Deliberately carries NO tags: the client knows how to build a game,
// the server decides how to badge it.
// -------------------------------------------------------------------
export interface GameDescriptor {
  name: string;
  displayName?: string;
  logoName: string;
  importThunk: () => Promise<{ default: React.ComponentType<any> }>;
}

// -------------------------------------------------------------------
// A registry entry after the manifest has been folded in - what the
// lobby actually renders.  Outside production there is no manifest, so
// tags is empty and every known game shows.
// -------------------------------------------------------------------
export interface LobbyGame extends GameDescriptor {
  tags: string[];
}
