// ==========================================================================================
// One AudioContext for the whole page.
//
// Browsers cap how many a page may create (Chrome stops at six and then throws), and every
// live context holds an audio thread.  Anything here that synthesises sound - the poof a
// captured tile makes, the wah-wah speech engine - shares this one.
//
// It is created LAZILY and never before something actually wants a noise: constructing one
// during page load gets it born `suspended` under autoplay policy, and it stays that way.
// ==========================================================================================

let shared: AudioContext | undefined;

/**
 * The page's AudioContext, or undefined where there is no Web Audio at all (old browsers,
 * jsdom).  Callers must handle undefined - sound is never worth breaking a game over.
 */
export function getSharedAudioContext(): AudioContext | undefined {
  if (!shared) {
    const Ctor = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return undefined;
    try {
      shared = new Ctor() as AudioContext;
    } catch {
      return undefined;
    }
  }
  // Autoplay policy hands back a SUSPENDED context, and a suspended context does not
  // advance currentTime - so anything scheduled on it is not late, it simply never plays.
  //
  // Resuming has to happen on the newly-created one too.  It used to only run on the
  // second and later calls, which meant the very first sound of a session was silently
  // dropped: created suspended, scheduled, never started.  That is exactly the sound
  // somebody is listening for when they wonder whether the feature works at all.
  if (shared.state === "suspended") void shared.resume().catch(() => {});
  return shared;
}

/** Testing seam: forget the context so the next call builds a fresh one. */
export function resetSharedAudioContext() {
  shared = undefined;
}
