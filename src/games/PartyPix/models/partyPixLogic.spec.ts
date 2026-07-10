import {
  makeVoteSets,
  canUpload,
  applyVote,
  applyDeleteRequest,
  flagThreshold,
  shouldPullFromRotation,
  creditsForUpvoteCount,
  grantCredits,
  upvotesUntilNextCredit,
  imageHash,
  nextSlideIndex,
  clampIndex,
  VoteSets,
} from "./partyPixLogic";
import {
  START_CREDITS,
  UPLOAD_COST,
  CREDIT_UPVOTE_MILESTONES,
  CREDIT_CAP,
  FLAG_THRESHOLD_DEFAULT,
  FLAG_THRESHOLD_APPROVED,
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
    expect(CREDIT_UPVOTE_MILESTONES).toEqual([2, 5, 20]);
    expect(CREDIT_CAP).toBe(9);
    expect(FLAG_THRESHOLD_DEFAULT).toBe(1);
    expect(FLAG_THRESHOLD_APPROVED).toBe(3);
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

describe("flagThreshold", () => {
  it("is 1 by default and 3 once approved", () => {
    expect(flagThreshold(false)).toBe(1);
    expect(flagThreshold(true)).toBe(3);
  });
});

describe("shouldPullFromRotation", () => {
  it("pulls a normal photo on the first flag", () => {
    expect(shouldPullFromRotation(0, false)).toBe(false);
    expect(shouldPullFromRotation(1, false)).toBe(true);
    expect(shouldPullFromRotation(2, false)).toBe(true);
  });
  it("pulls an approved photo only at 3 flags", () => {
    expect(shouldPullFromRotation(1, true)).toBe(false);
    expect(shouldPullFromRotation(2, true)).toBe(false);
    expect(shouldPullFromRotation(3, true)).toBe(true);
    expect(shouldPullFromRotation(4, true)).toBe(true);
  });
});

describe("creditsForUpvoteCount", () => {
  // Milestones [2, 5, 20]: a bonus credit as cumulative upvotes cross each.
  it("grants nothing before the first milestone", () => {
    expect(creditsForUpvoteCount(0, 1)).toBe(0);
    expect(creditsForUpvoteCount(1, 1)).toBe(0);
  });
  it("grants exactly one credit as each milestone is crossed", () => {
    expect(creditsForUpvoteCount(1, 2)).toBe(1); // crosses 2
    expect(creditsForUpvoteCount(4, 5)).toBe(1); // crosses 5
    expect(creditsForUpvoteCount(19, 20)).toBe(1); // crosses 20
  });
  it("grants nothing between or after milestones", () => {
    expect(creditsForUpvoteCount(2, 4)).toBe(0); // between 2 and 5
    expect(creditsForUpvoteCount(5, 19)).toBe(0); // between 5 and 20
    expect(creditsForUpvoteCount(20, 100)).toBe(0); // past the last milestone
  });
  it("grants multiple credits when several milestones are crossed at once", () => {
    expect(creditsForUpvoteCount(0, 5)).toBe(2); // 2 and 5
    expect(creditsForUpvoteCount(0, 20)).toBe(3); // 2, 5, 20
    expect(creditsForUpvoteCount(3, 20)).toBe(2); // 5 and 20
  });
  it("never returns a negative credit (count is monotonic)", () => {
    expect(creditsForUpvoteCount(20, 5)).toBe(0);
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
  // Distance to the next milestone in [2, 5, 20]; 0 once all are reached.
  it("counts down toward the next milestone", () => {
    expect(upvotesUntilNextCredit(0)).toBe(2); // next is 2
    expect(upvotesUntilNextCredit(1)).toBe(1);
    expect(upvotesUntilNextCredit(2)).toBe(3); // next is 5
    expect(upvotesUntilNextCredit(4)).toBe(1);
    expect(upvotesUntilNextCredit(5)).toBe(15); // next is 20
    expect(upvotesUntilNextCredit(19)).toBe(1);
  });
  it("returns 0 once every milestone is reached", () => {
    expect(upvotesUntilNextCredit(20)).toBe(0);
    expect(upvotesUntilNextCredit(50)).toBe(0);
  });
});

describe("imageHash", () => {
  it("is stable for identical content", () => {
    expect(imageHash("data:image/jpeg;base64,AAAA")).toBe(imageHash("data:image/jpeg;base64,AAAA"));
  });
  it("differs for different content", () => {
    expect(imageHash("aaaa")).not.toBe(imageHash("aaab"));
    expect(imageHash("aa")).not.toBe(imageHash("aaaa")); // length is folded in
  });
  it("handles the empty string", () => {
    expect(typeof imageHash("")).toBe("string");
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
