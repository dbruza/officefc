/** Format helpers ported from the prototype. */

/** "Alex Morgan" → "Alex". */
export function firstName(name: string): string {
  return name.split(" ")[0];
}
