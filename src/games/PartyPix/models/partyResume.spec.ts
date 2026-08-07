import { shouldOfferResume, describePartyAge } from "./partyPixLogic";
import { PARTY_RESUME_WINDOW_MS } from "./GameSettings";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = 1_700_000_000_000; // fixed, so these never depend on when they run

// ==========================================================================================
// The presenter used to reconnect a remembered folder during startup and load its photos,
// which flipped it straight into the previous party's slideshow - the setup screen, the room
// code and the join instructions never appeared. It now always starts at setup, and a party is
// resumed only if the host asks.
//
// Which makes "is there a party worth offering" a real decision, and this is it. Photos in the
// folder are NOT enough on their own: the ordinary case is a new party in a folder that
// already holds last week's pictures.
// ==========================================================================================
describe("offering to continue the last party", () => {
  const offer = (photos: number, ageMs: number) =>
    shouldOfferResume(photos, NOW - ageMs, NOW, PARTY_RESUME_WINDOW_MS);

  it("offers a party that was live minutes ago", () => {
    // The case this exists for: the tab was closed, the browser crashed, the Pi restarted.
    expect(offer(12, 5 * MIN)).toBe(true);
  });

  it("offers a party from earlier the same evening", () => {
    expect(offer(40, 6 * HOUR)).toBe(true);
  });

  it("does NOT offer a party older than the window", () => {
    // Last month's album is not tonight's party.
    expect(offer(40, 25 * HOUR)).toBe(false);
    expect(offer(40, 30 * 24 * HOUR)).toBe(false);
  });

  it("treats the window edge as stale", () => {
    expect(offer(5, PARTY_RESUME_WINDOW_MS - 1)).toBe(true);
    expect(offer(5, PARTY_RESUME_WINDOW_MS)).toBe(false);
  });

  it("does not offer when the folder is empty, however recent the stamp", () => {
    // A party with no photos is nothing to continue.
    expect(offer(0, 1 * MIN)).toBe(false);
  });

  it("does not offer when no party was ever recorded", () => {
    // lastPartyAt === 0 is a fresh install pointed at a folder of holiday snaps, not a party
    // that ended at the epoch.
    expect(shouldOfferResume(200, 0, NOW, PARTY_RESUME_WINDOW_MS)).toBe(false);
  });

  it("survives a clock that has gone backwards", () => {
    // A timezone change or an NTP correction makes `now` earlier than the stamp. Hiding a
    // party the host can see on their own screen would be the worse answer.
    expect(shouldOfferResume(9, NOW + HOUR, NOW, PARTY_RESUME_WINDOW_MS)).toBe(true);
  });
});

describe("describing how old the last party is", () => {
  const age = (ms: number) => describePartyAge(NOW - ms, NOW);

  it("reads naturally across the whole window", () => {
    expect(age(10 * 1000)).toBe("just now");
    expect(age(20 * MIN)).toBe("20 minutes ago");
    expect(age(1 * HOUR)).toBe("an hour ago");
    expect(age(3 * HOUR)).toBe("3 hours ago");
    expect(age(22 * HOUR)).toBe("yesterday");
  });

  it("never reports a negative age from a backwards clock", () => {
    expect(describePartyAge(NOW + HOUR, NOW)).toBe("just now");
  });
});
