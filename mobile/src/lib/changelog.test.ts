import test from "node:test";
import assert from "node:assert/strict";
import { CHANGELOG } from "./changelog";

const VERSION_RE = /^\d+\.\d+\.\d+\.\d+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set(["Added", "Changed", "Fixed", "Removed", "Other"]);

test("changelog has at least one release", () => {
  assert.ok(CHANGELOG.length > 0, "generated changelog must contain entries");
});

test("entries are newest-first by version", () => {
  const parts = (v: string) => v.split(".").map(Number);
  for (let i = 1; i < CHANGELOG.length; i += 1) {
    const prev = parts(CHANGELOG[i - 1].version);
    const cur = parts(CHANGELOG[i].version);
    const newer =
      prev[0] > cur[0] ||
      (prev[0] === cur[0] && prev[1] > cur[1]) ||
      (prev[0] === cur[0] && prev[1] === cur[1] && prev[2] > cur[2]) ||
      (prev[0] === cur[0] && prev[1] === cur[1] && prev[2] === cur[2] && prev[3] >= cur[3]);
    assert.ok(newer, `${CHANGELOG[i - 1].version} should come before ${CHANGELOG[i].version}`);
  }
});

test("every entry is well-formed", () => {
  for (const entry of CHANGELOG) {
    assert.match(entry.version, VERSION_RE, `version ${entry.version} must be four-part`);
    assert.match(entry.date, ISO_DATE_RE, `date for ${entry.version} must be ISO`);
    assert.equal(
      Number.isNaN(Date.parse(entry.date)),
      false,
      `date for ${entry.version} must parse`,
    );

    const kinds = new Set<string>();
    for (const section of entry.sections) {
      assert.ok(KINDS.has(section.kind), `unknown section kind ${section.kind}`);
      assert.ok(!kinds.has(section.kind), `duplicate section ${section.kind} in ${entry.version}`);
      kinds.add(section.kind);
      assert.ok(section.items.length > 0, `section ${section.kind} in ${entry.version} has items`);
    }
  }
});

test("the current release actually documents something", () => {
  assert.ok(CHANGELOG[0].sections.length > 0, "newest entry should have at least one section");
});

test("item text is single-line and whitespace-collapsed", () => {
  for (const entry of CHANGELOG) {
    for (const section of entry.sections) {
      for (const item of section.items) {
        assert.ok(!item.includes("\n"), `newline in ${entry.version}/${section.kind}: ${item}`);
        assert.ok(
          !item.includes("  "),
          `double space in ${entry.version}/${section.kind}: ${item}`,
        );
        assert.ok(
          item.trim().length === item.length && item.length > 0,
          `untrimmed/empty item in ${entry.version}`,
        );
      }
    }
  }
});
