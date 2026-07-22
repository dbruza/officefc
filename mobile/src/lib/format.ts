/** Format helpers ported from the prototype. */

/** "Alex Morgan" → "Alex". */
export function firstName(name: string): string {
  return name.split(" ")[0];
}

/** "1 meeting", "3 meetings" — count with a naive-pluralized noun. */
export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}
