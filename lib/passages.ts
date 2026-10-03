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
  {
    id: "lost-kitten",
    title: "The Lost Kitten",
    text:
      "A small kitten sat alone by the gate. " +
      "It gave a soft cry and looked up and down the road. " +
      "A kind girl stopped and knelt beside it. " +
      "She carried the kitten home and gave it warm milk.",
  },
  {
    id: "at-the-beach",
    title: "At the Beach",
    text:
      "The waves rolled onto the warm sand. " +
      "Children built a tall castle near the water. " +
      "A white boat moved slowly across the sea. " +
      "Later the sun went down and the sky turned pink.",
  },
  {
    id: "the-red-bus",
    title: "The Big Red Bus",
    text:
      "The big red bus came round the corner. " +
      "It stopped and the doors opened with a hiss. " +
      "A man with a brown bag climbed on board. " +
      "The bus drove off toward the busy town.",
  },
  {
    id: "planting-seeds",
    title: "Planting Seeds",
    text:
      "Tom dug a small hole in the dark soil. " +
      "He dropped a tiny seed inside and covered it. " +
      "Every day he gave the seed some water. " +
      "After a week a green shoot pushed through the ground.",
  },
];

export function getPassage(id: string): Passage | undefined {
  return PASSAGES.find((p) => p.id === id);
}
