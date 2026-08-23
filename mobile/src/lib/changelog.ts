/**
 * Changelog data contract. `CHANGELOG` itself is generated at build time by
 * scripts/generate-changelog.mjs into ./changelogData (committed to git), which
 * imports these types back via a relative path.
 */

export interface ChangelogEntry {
  /** Full four-part version string, e.g. "1.6.0.0". */
  version: string;
  /** ISO date "2026-08-24". */
  date: string;
  sections: Array<{
    /** Recognized headings plus "Other" for unrecognized ones (parser pass-through). */
    kind: "Added" | "Changed" | "Fixed" | "Removed" | "Other";
    items: string[];
  }>;
}

export { CHANGELOG } from "./changelogData";
