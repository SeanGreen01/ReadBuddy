import { describe, expect, it } from "vitest";
import { syllabify, soundOut } from "../lib/syllabify";

describe("syllabify", () => {
  it("keeps short and single-syllable words whole", () => {
    for (const w of ["cat", "the", "dog", "house", "bread", "milk", "gate",
      "waves", "sand", "boat", "sea", "soil", "seed", "shoot", "ground", "bus"]) {
      expect(syllabify(w)).toEqual([w]);
    }
  });

  it("splits common two-syllable words from the passages", () => {
    expect(syllabify("kitten")).toEqual(["kit", "ten"]);
    expect(syllabify("windows")).toEqual(["win", "dows"]);
    expect(syllabify("narrow")).toEqual(["nar", "row"]);
    expect(syllabify("baker")).toEqual(["ba", "ker"]);
    expect(syllabify("empty")).toEqual(["emp", "ty"]);
    expect(syllabify("corner")).toEqual(["cor", "ner"]);
    expect(syllabify("slowly")).toEqual(["slow", "ly"]);
  });

  it("uses the maximal onset principle for consonant clusters", () => {
    expect(syllabify("children")).toEqual(["chil", "dren"]);
    expect(syllabify("table")).toEqual(["ta", "ble"]);
  });

  it("peels a trailing -ing from a real stem but not from short words", () => {
    expect(syllabify("planting")).toEqual(["plant", "ing"]);
    expect(syllabify("reading")).toEqual(["read", "ing"]);
    expect(syllabify("bring")).toEqual(["bring"]);
    expect(syllabify("king")).toEqual(["king"]);
  });

  it("handles known hiatus exceptions", () => {
    expect(syllabify("quiet")).toEqual(["qui", "et"]);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(syllabify("Kitten.")).toEqual(["kit", "ten"]);
    expect(syllabify("HOUSE")).toEqual(["house"]);
  });

  it("sounds out multi-syllable words by syllable", () => {
    expect(soundOut("kitten")).toEqual({
      spoken: "kit ... ten",
      display: "kit·ten",
      mode: "syllables",
    });
  });

  it("spells out single-syllable words letter by letter", () => {
    expect(soundOut("house")).toEqual({
      spoken: "H ... O ... U ... S ... E",
      display: "H-O-U-S-E",
      mode: "letters",
    });
  });
});
