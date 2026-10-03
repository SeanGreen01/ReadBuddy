export interface Passage {
  id: string;
  title: string;
  text: string;
}

// Short, plain-language passages. Kept simple and concrete so a demo reader
// can get through one in under a minute. Sentences are deliberately short.
export const PASSAGES: Passage[] = [
  {
    id: "house-on-the-hill",
    title: "The House on the Hill",
    text:
      "The old house stood at the top of the hill. " +
      "Its windows were dark and its door was shut. " +
      "A narrow path led up through the long grass. " +
      "Nobody had lived there for many years.",
  },
  {
    id: "morning-walk",
    title: "A Morning Walk",
    text:
      "The sun came up slowly over the quiet town. " +
      "Birds began to sing in the tall trees. " +
      "A small dog ran across the empty street. " +
      "The baker opened her shop and the smell of bread filled the air.",
  },
];

export function getPassage(id: string): Passage | undefined {
  return PASSAGES.find((p) => p.id === id);
}
