import {
  makeVoteSets,
  canUpload,
  applyVote,
  applyDeleteRequest,
  deleteThreshold,
  shouldAutoDelete,
  creditsForUpvoteCount,
  grantCredits,
  upvotesUntilNextCredit,
  nextSlideIndex,
  clampIndex,
  VoteSets,
} from "./partyPixLogic";
import {
  START_CREDITS,
  UPLOAD_COST,
  UPVOTES_PER_CREDIT,
  CREDIT_CAP,
  BASE_DELETE_THRESHOLD,
  DELETE_PLAYER_FRACTION,
} from "./GameSettings";

// -------------------------------------------------------------------
// These are the pure, framework-free economy + slideshow rules that the
// presenter model delegates every decision to. They are the highest-value
// test target: a bug here becomes a mis-priced credit or a broken slideshow
// mid-party. Each rule from the design is asserted below, edge cases included.
// -------------------------------------------------------------------

// Guard the tuning constants so a stray edit to GameSettings can't silently
// shift the economy the rest of these tests assume.
describe("GameSettings constants", () => {
  it("holds the documented economy/moderation values", () => {
    expect(START_CREDITS).toBe(3);
    expect(UPLOAD_COST).toBe(1);
    expect(UPVOTES_PER_CREDIT).toBe(3);
    expect(CREDIT_CAP).toBe(9);
    expect(BASE_DELETE_THRESHOLD).toBe(3);
    expect(DELETE_PLAYER_FRACTION).toBeCloseTo(0.4);
  });
});

describe("makeVoteSets", () => {
  it("creates three independent empty sets", () => {
    const s = makeVoteSets();
    expect(s.upVoters.size).toBe(0);
    expect(s.downVoters.size).toBe(0);
    expect(s.deleteVoters.size).toBe(0);
    s.upVoters.add("x");
    expect(s.downVoters.has("x")).toBe(false);
    expect(s.deleteVoters.has("x")).toBe(false);
  });
});

describe("canUpload", () => {
  it("requires at least UPLOAD_COST credits", () => {
    expect(canUpload(0)).toBe(false);
    expect(canUpload(UPLOAD_COST)).toBe(true);
    expect(canUpload(1)).toBe(true);
    expect(canUpload(9)).toBe(true);
  });
  it("rejects negative credit balances", () => {
    expect(canUpload(-1)).toBe(false);
  });
});

describe("applyVote", () => {
  let sets: VoteSets;
  beforeEach(() => {
    sets = makeVoteSets();
  });

  it("rejects a self-vote (voter is the author)", () => {
    const r = applyVote(sets, "alice", "alice", "up");
    expect(r.ok).toBe(false);
    expect(r.upvoteAdded).toBe(false);
    expect(sets.upVoters.size).toBe(0);
  });

  it("records a brand-new upvote and flags upvoteAdded", () => {
    const r = applyVote(sets, "bob", "alice", "up");
    expect(r.ok).toBe(true);
    expect(r.upvoteAdded).toBe(true);
    expect(sets.upVoters.has("bob")).toBe(true);
    expect(sets.downVoters.has("bob")).toBe(false);
  });

  it("records a downvote without flagging upvoteAdded", () => {
    const r = applyVote(sets, "bob", "alice", "down");
    expect(r.ok).toBe(true);
    expect(r.upvoteAdded).toBe(false);
    expect(sets.downVoters.has("bob")).toBe(true);
    expect(sets.upVoters.has("bob")).toBe(false);
  });

  it("toggles an upvote OFF when the same direction is tapped again", () => {
    applyVote(sets, "bob", "alice", "up");
    const r = applyVote(sets, "bob", "alice", "up");
    expect(r.ok).toBe(true);
    expect(r.upvoteAdded).toBe(false);
    expect(sets.upVoters.has("bob")).toBe(false);
  });

  it("toggles a downvote OFF when the same direction is tapped again", () => {
    applyVote(sets, "bob", "alice", "down");
    const r = applyVote(sets, "bob", "alice", "down");
    expect(r.ok).toBe(true);
    expect(sets.downVoters.has("bob")).toBe(false);
  });

  it("switches up -> down: upvoteAdded is false and the up count drops", () => {
    applyVote(sets, "bob", "alice", "up");
    expect(sets.upVoters.size).toBe(1);
    const r = applyVote(sets, "bob", "alice", "down");
    expect(r.ok).toBe(true);
    expect(r.upvoteAdded).toBe(false);
    expect(sets.upVoters.has("bob")).toBe(false); // up count dropped
    expect(sets.downVoters.has("bob")).toBe(true);
  });

  it("switches down -> up: upvoteAdded becomes true (a new upvote)", () => {
    applyVote(sets, "bob", "alice", "down");
    const r = applyVote(sets, "bob", "alice", "up");
    expect(r.ok).toBe(true);
    expect(r.upvoteAdded).toBe(true);
    expect(sets.downVoters.has("bob")).toBe(false);
    expect(sets.upVoters.has("bob")).toBe(true);
  });

  it("enforces one vote per player (up/down mutually exclusive)", () => {
    applyVote(sets, "bob", "alice", "up");
    applyVote(sets, "carol", "alice", "up");
    applyVote(sets, "carol", "alice", "down"); // carol switches
    expect(sets.upVoters.size).toBe(1); // only bob remains up
    expect(sets.downVoters.size).toBe(1); // carol
    // A voter is never simultaneously in both sets.
    expect(sets.upVoters.has("carol") && sets.downVoters.has("carol")).toBe(false);
  });
});

describe("applyDeleteRequest", () => {
  it("adds a first flag and reports it as newly added", () => {
    const sets = makeVoteSets();
    const r = applyDeleteRequest(sets, "bob");
    expect(r.ok).toBe(true);
    expect(r.added).toBe(true);
    expect(sets.deleteVoters.has("bob")).toBe(true);
  });

  it("is idempotent: a repeat flag from the same player is not re-added", () => {
    const sets = makeVoteSets();
    applyDeleteRequest(sets, "bob");
    const r = applyDeleteRequest(sets, "bob");
    expect(r.ok).toBe(true);
    expect(r.added).toBe(false);
    expect(sets.deleteVoters.size).toBe(1);
  });

  it("counts distinct flaggers", () => {
    const sets = makeVoteSets();
    applyDeleteRequest(sets, "bob");
    applyDeleteRequest(sets, "carol");
    expect(sets.deleteVoters.size).toBe(2);
  });
});

describe("deleteThreshold", () => {
  // max(BASE=3, ceil(players * 0.4))
  it("floors at BASE_DELETE_THRESHOLD for small crowds", () => {
    expect(deleteThreshold(0)).toBe(3);
    expect(deleteThreshold(1)).toBe(3);
    expect(deleteThreshold(2)).toBe(3);
    expect(deleteThreshold(5)).toBe(3); // ceil(2.0)=2 -> floored to 3
    expect(deleteThreshold(7)).toBe(3); // ceil(2.8)=3
  });
  it("scales with the crowd once the fraction exceeds the base", () => {
    expect(deleteThreshold(8)).toBe(4); // ceil(3.2)=4
    expect(deleteThreshold(10)).toBe(4); // ceil(4.0)=4
    expect(deleteThreshold(20)).toBe(8); // ceil(8.0)=8
    expect(deleteThreshold(50)).toBe(20); // ceil(20)=20
  });
});

describe("shouldAutoDelete", () => {
  it("removes only once flags reach the threshold", () => {
    expect(shouldAutoDelete(2, 1)).toBe(false); // threshold 3
    expect(shouldAutoDelete(3, 1)).toBe(true);
    expect(shouldAutoDelete(4, 1)).toBe(true);
  });
  it("uses the scaled threshold for a big crowd", () => {
    expect(shouldAutoDelete(7, 20)).toBe(false); // threshold 8
    expect(shouldAutoDelete(8, 20)).toBe(true);
  });
});

describe("creditsForUpvoteCount", () => {
  it("grants nothing until a multiple of 3 is crossed", () => {
    expect(creditsForUpvoteCount(0, 1)).toBe(0);
    expect(creditsForUpvoteCount(0, 2)).toBe(0);
    expect(creditsForUpvoteCount(1, 2)).toBe(0);
  });
  it("grants exactly one credit as each multiple of 3 is crossed", () => {
    expect(creditsForUpvoteCount(2, 3)).toBe(1); // crosses 3
    expect(creditsForUpvoteCount(5, 6)).toBe(1); // crosses 6
    expect(creditsForUpvoteCount(8, 9)).toBe(1); // crosses 9
  });
  it("grants multiple credits when several boundaries are crossed at once", () => {
    expect(creditsForUpvoteCount(0, 3)).toBe(1);
    expect(creditsForUpvoteCount(0, 6)).toBe(2);
    expect(creditsForUpvoteCount(0, 9)).toBe(3);
    expect(creditsForUpvoteCount(1, 7)).toBe(2); // 3 and 6 crossed
  });
  it("never returns a negative credit (count is monotonic)", () => {
    expect(creditsForUpvoteCount(6, 3)).toBe(0);
    expect(creditsForUpvoteCount(9, 0)).toBe(0);
  });
  it("returns 0 for an unchanged count", () => {
    expect(creditsForUpvoteCount(3, 3)).toBe(0);
  });
});

describe("grantCredits", () => {
  it("adds earned credits", () => {
    expect(grantCredits(2, 1)).toBe(3);
    expect(grantCredits(0, 0)).toBe(0);
  });
  it("caps the total at CREDIT_CAP (9)", () => {
    expect(grantCredits(8, 1)).toBe(9);
    expect(grantCredits(9, 1)).toBe(9);
    expect(grantCredits(8, 5)).toBe(9);
    expect(grantCredits(9, 0)).toBe(9);
  });
});

describe("upvotesUntilNextCredit", () => {
  // "3 more" right after a boundary; counts down to 1 just before the next.
  it("returns the countdown for totalUp 0..6", () => {
    expect(upvotesUntilNextCredit(0)).toBe(3);
    expect(upvotesUntilNextCredit(1)).toBe(2);
    expect(upvotesUntilNextCredit(2)).toBe(1);
    expect(upvotesUntilNextCredit(3)).toBe(3);
    expect(upvotesUntilNextCredit(4)).toBe(2);
    expect(upvotesUntilNextCredit(5)).toBe(1);
    expect(upvotesUntilNextCredit(6)).toBe(3);
  });
});

describe("nextSlideIndex", () => {
  it("returns 0 for an empty slideshow", () => {
    expect(nextSlideIndex(0, 0)).toBe(0);
    expect(nextSlideIndex(5, 0)).toBe(0);
    expect(nextSlideIndex(0, -1)).toBe(0);
  });
  it("advances by one within bounds", () => {
    expect(nextSlideIndex(0, 3)).toBe(1);
    expect(nextSlideIndex(1, 3)).toBe(2);
  });
  it("wraps around at the end", () => {
    expect(nextSlideIndex(2, 3)).toBe(0);
    expect(nextSlideIndex(0, 1)).toBe(0); // single photo loops to itself
  });
});

describe("clampIndex", () => {
  it("returns 0 for an empty set", () => {
    expect(clampIndex(0, 0)).toBe(0);
    expect(clampIndex(5, 0)).toBe(0);
    expect(clampIndex(-3, 0)).toBe(0);
  });
  it("clamps a negative index up to 0", () => {
    expect(clampIndex(-1, 4)).toBe(0);
    expect(clampIndex(-100, 4)).toBe(0);
  });
  it("clamps an out-of-range index down to the last valid index", () => {
    expect(clampIndex(4, 4)).toBe(3);
    expect(clampIndex(99, 4)).toBe(3);
  });
  it("leaves a valid index untouched", () => {
    expect(clampIndex(0, 4)).toBe(0);
    expect(clampIndex(2, 4)).toBe(2);
    expect(clampIndex(3, 4)).toBe(3);
  });
});

describe("applyVote — credit accounting (countsForCredit)", () => {
  let sets: VoteSets;
  beforeEach(() => {
    sets = makeVoteSets();
  });

  it("counts a voter's first upvote toward the author's credit", () => {
    const r = applyVote(sets, "bob", "alice", "up");
    expect(r.countsForCredit).toBe(true);
    expect(sets.creditedVoters.has("bob")).toBe(true);
  });

  it("does not count a downvote toward credit", () => {
    expect(applyVote(sets, "bob", "alice", "down").countsForCredit).toBe(false);
    expect(sets.creditedVoters.size).toBe(0);
  });

  it("counts each distinct upvoter exactly once", () => {
    expect(applyVote(sets, "b", "a", "up").countsForCredit).toBe(true);
    expect(applyVote(sets, "c", "a", "up").countsForCredit).toBe(true);
    expect(sets.creditedVoters.size).toBe(2);
  });

  it("blocks credit farming: one voter toggling an upvote never counts twice", () => {
    expect(applyVote(sets, "bob", "alice", "up").countsForCredit).toBe(true); // first up
    expect(applyVote(sets, "bob", "alice", "up").countsForCredit).toBe(false); // toggle off
    expect(applyVote(sets, "bob", "alice", "up").countsForCredit).toBe(false); // re-up
    expect(applyVote(sets, "bob", "alice", "down").countsForCredit).toBe(false); // switch
    expect(applyVote(sets, "bob", "alice", "up").countsForCredit).toBe(false); // re-up again
    expect(sets.creditedVoters.size).toBe(1);
  });

  it("still reports upvoteAdded on a re-up even though it no longer counts for credit", () => {
    applyVote(sets, "bob", "alice", "up");
    applyVote(sets, "bob", "alice", "up"); // off
    const r = applyVote(sets, "bob", "alice", "up"); // re-up
    expect(r.upvoteAdded).toBe(true);
    expect(r.countsForCredit).toBe(false);
  });
});
