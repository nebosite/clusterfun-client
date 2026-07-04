import {
  sharedSignificantPhrase,
  pickGroupNameFromSharedWords,
  isAutoGroupName,
  normalizeToWords,
} from "./groupNaming";
import { RetroSpectroAnswer, RetroSpectroAnswerCollection } from "./PresenterModel";
import { AnswerType } from "./ClientModel";

// The auto-naming rule: when ideas are dragged together during sorting, an
// auto-named group ("" or "Group X") adopts the meaningful words its ideas
// share. Once a group has a real name, further drops leave it unchanged.

describe("normalizeToWords", () => {
  it("lowercases, splits, and strips punctuation", () => {
    expect(normalizeToWords("Fix the Soda-Fountain!")).toEqual(["fix", "the", "soda", "fountain"]);
  });
  it("returns an empty array for punctuation-only text", () => {
    expect(normalizeToWords("!!! ---")).toEqual([]);
  });
});

describe("sharedSignificantPhrase", () => {
  it("finds a multi-word contiguous overlap", () => {
    expect(sharedSignificantPhrase("Buggy soda fountain", "Fix the soda fountain")).toBe(
      "soda fountain",
    );
  });

  it("is case- and punctuation-insensitive", () => {
    expect(sharedSignificantPhrase("Coffee Machine", "coffee, maker")).toBe("coffee");
    expect(sharedSignificantPhrase("soda-fountain!", "the soda fountain")).toBe("soda fountain");
  });

  it("matches a single meaningful shared word", () => {
    expect(sharedSignificantPhrase("red apple", "green apple")).toBe("apple");
  });

  it("trims leading and trailing utility words", () => {
    expect(sharedSignificantPhrase("the soda", "the soda machine")).toBe("soda");
  });

  it("returns null when there is no overlap", () => {
    expect(sharedSignificantPhrase("incorrect drinks", "Buggy soda fountain")).toBeNull();
  });

  it("returns null when the only overlap is utility words", () => {
    expect(sharedSignificantPhrase("a of the", "the of a")).toBeNull();
  });
});

describe("pickGroupNameFromSharedWords", () => {
  it("names from the idea the newcomer overlaps with, ignoring the rest", () => {
    expect(
      pickGroupNameFromSharedWords(
        ["Fix the soda fountain"],
        ["Buggy soda fountain", "incorrect drinks"],
      ),
    ).toBe("soda fountain");
  });

  it("prefers the longest shared phrase", () => {
    expect(
      pickGroupNameFromSharedWords(["big red soda fountain"], ["red car", "soda fountain now"]),
    ).toBe("soda fountain");
  });

  it("returns null when nothing meaningful is shared", () => {
    expect(pickGroupNameFromSharedWords(["apples"], ["oranges", "bananas"])).toBeNull();
  });
});

describe("isAutoGroupName", () => {
  it("treats empty and 'Group X' names as auto", () => {
    expect(isAutoGroupName("")).toBe(true);
    expect(isAutoGroupName(undefined)).toBe(true);
    expect(isAutoGroupName("Group A")).toBe(true);
  });
  it("treats a real name as not auto", () => {
    expect(isAutoGroupName("soda fountain")).toBe(false);
  });
});

// -------------------------------------------------------------------
// Integration: the exact scenario from the feature request, driven
// through RetroSpectroAnswerCollection.handleDrop.
// -------------------------------------------------------------------
function answer(text: string): RetroSpectroAnswer {
  return new RetroSpectroAnswer(undefined, text, AnswerType.Negative);
}

describe("RetroSpectroAnswerCollection auto-naming on drop", () => {
  it("renames an auto-named group to the shared words, then leaves it alone", () => {
    const group = new RetroSpectroAnswerCollection();
    group.addAnswer(answer("Buggy soda fountain"));

    // Second unrelated idea forms the group with an auto "Group X" name.
    group.handleDrop(answer("incorrect drinks"));
    expect(isAutoGroupName(group.name)).toBe(true);

    // Third idea shares "soda fountain" with an existing idea -> rename.
    group.handleDrop(answer("Fix the soda fountain"));
    expect(group.name).toBe("soda fountain");

    // Fourth idea also shares the words, but the group already has a real
    // name, so nothing changes.
    group.handleDrop(answer("I like the soda fountain"));
    expect(group.name).toBe("soda fountain");
  });

  it("leaves an auto name when the newcomer shares nothing meaningful", () => {
    const group = new RetroSpectroAnswerCollection();
    group.addAnswer(answer("coffee machine"));
    group.handleDrop(answer("parking spaces"));
    expect(isAutoGroupName(group.name)).toBe(true);
    expect(group.name).not.toBe("");
  });
});
