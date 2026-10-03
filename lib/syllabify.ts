// Lightweight, offline English syllable splitter for the "sound it out" help.
//
// This is a heuristic, not a linguistic authority — it uses the maximal-onset
// principle with silent-e handling and a small exceptions list. It is good
// enough to segment common words for a reader to sound out, runs instantly in
// the browser, and needs no model call. Like the rest of this prototype it is
// a reading aid, not a phonics assessment.

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

// Consonant clusters that can legally begin an English syllable. Used to decide
// how many consonants between two vowels belong to the following syllable.
const ONSET_CLUSTERS = new Set([
  "bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "pl", "pr", "sc", "sk",
  "sl", "sm", "sn", "sp", "st", "sw", "tr", "tw", "th", "sh", "ch", "ph", "wh",
  "gh", "qu", "wr", "kn", "thr", "shr", "spl", "spr", "str", "scr", "squ", "sch",
]);

// Words where the vowel-group heuristic mishandles hiatus vs diphthong.
const EXCEPTIONS: Record<string, string[]> = {
  quiet: ["qui", "et"],
  being: ["be", "ing"],
  poem: ["po", "em"],
  lion: ["li", "on"],
};

function isVowel(ch: string, index: number): boolean {
  if (VOWELS.has(ch)) return true;
  return ch === "y" && index > 0; // 'y' is a vowel except word-initially
}

/**
 * Split a word into syllable-sized chunks for sounding out. Returns the lower-
 * cased chunks; a single-syllable (or very short) word comes back as one chunk.
 */
export function syllabify(raw: string): string[] {
  const word = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return [raw];
  if (EXCEPTIONS[word]) return EXCEPTIONS[word];
  if (word.length <= 3) return [word];

  // Peel a trailing "-ing" when the stem is a real, pronounceable chunk.
  if (word.endsWith("ing") && word.length > 4) {
    const stem = word.slice(0, -3);
    if (stem.length >= 3 && /[aeiouy]/.test(stem) && !VOWELS.has(stem.at(-1)!)) {
      return [...syllabify(stem), "ing"];
    }
  }

  const chars = [...word];
  const vowel = chars.map((c, i) => isVowel(c, i));

  // Silent final 'e' (optionally before a plural 's'): "gate", "waves" — the
  // 'e' is not its own nucleus. Excludes the consonant+"le" ending ("castle"),
  // where the 'e' does carry a syllable.
  const endsConsonantLE = /[^aeiou]le$/.test(word);
  if (!endsConsonantLE) {
    const m = word.match(/[^aeiou]e(s?)$/);
    if (m) {
      const eIndex = word.endsWith("s") ? chars.length - 2 : chars.length - 1;
      if (vowel.slice(0, eIndex).some(Boolean)) vowel[eIndex] = false;
    }
  }

  // Maximal vowel runs become nuclei.
  const nuclei: { start: number; end: number }[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (!vowel[i]) continue;
    const start = i;
    while (i + 1 < chars.length && vowel[i + 1]) i++;
    nuclei.push({ start, end: i });
  }
  if (nuclei.length <= 1) return [word];

  // For each gap between nuclei, give the following syllable the largest legal
  // onset; the rest of the consonants stay with the preceding syllable.
  const splits: number[] = [];
  for (let n = 0; n < nuclei.length - 1; n++) {
    const gapStart = nuclei[n].end + 1;
    const gapEnd = nuclei[n + 1].start;
    const cluster = chars.slice(gapStart, gapEnd).join("");
    const c = cluster.length;

    let onsetLen: number;
    if (c === 0) onsetLen = 0; // hiatus: V|V
    else if (c === 1) onsetLen = 1; // open syllable: V|CV
    else {
      onsetLen = 1; // the final consonant is always a valid single onset
      for (let k = 2; k <= Math.min(3, c); k++) {
        if (ONSET_CLUSTERS.has(cluster.slice(c - k))) onsetLen = k;
      }
    }
    splits.push(gapEnd - onsetLen);
  }

  const points = [0, ...splits, chars.length];
  const parts: string[] = [];
  for (let p = 0; p < points.length - 1; p++) {
    parts.push(chars.slice(points[p], points[p + 1]).join(""));
  }
  return parts.filter(Boolean);
}

export interface SoundOut {
  /** For the speech engine. Parts are separated by ellipses, which ElevenLabs
   * reads as clear pauses, so each part is pronounced distinctly. */
  spoken: string;
  /** For on-screen text, e.g. "kit·ten" or "H-O-U-S-E". */
  display: string;
  mode: "syllables" | "letters";
}

/**
 * How to sound a word out: by syllables when it has more than one, otherwise
 * spelled letter by letter (so single-syllable words like "house" are spelled,
 * not just repeated).
 */
export function soundOut(word: string): SoundOut {
  const chunks = syllabify(word);
  if (chunks.length > 1) {
    return {
      spoken: chunks.join(" ... "),
      display: chunks.join("·"),
      mode: "syllables",
    };
  }
  const letters = word.toUpperCase().replace(/[^A-Z]/g, "").split("");
  return {
    spoken: letters.join(" ... "),
    display: letters.join("-"),
    mode: "letters",
  };
}
