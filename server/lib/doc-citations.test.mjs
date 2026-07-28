// node --test "server/lib/*.test.mjs"
//
// The judgements about doc-citations.mjs. The machinery is there; what is here
// is the standard it is held to.
//
// A quoted hash is one kind of doc claim that can go silently false, and it is
// already pinned (revision/demo-amend.test.mjs). A `file:line` citation is
// the other, and this is what pins it: every citation in the documents a reader
// is pointed at — plus the demonstration's printed output, which a judge reads
// as evidence — must name a line that still holds the text it was cited for.

import { test } from "node:test";
import assert from "node:assert";

import {
  PINS,
  CITATION,
  bareContinuationsIn,
  checkCitations,
  citationsIn,
  docSources,
  resolveCited,
} from "./doc-citations.mjs";

const SOURCES = await docSources();

test("every file:line citation in the docs and the demo output names the line it claims", () => {
  const { findings, citations } = checkCitations(SOURCES);
  assert.ok(citations > 0, "no citations found at all — the extractor has stopped working");
  assert.deepStrictEqual(findings, [], `\n  ${findings.join("\n  ")}\n`);
});

test("the checker resolves all three ways the docs write a path, and refuses an unknown one", () => {
  // The extractor is the load-bearing half: if it silently stops matching, the
  // check above passes by finding nothing. These are its own unit checks.
  assert.strictEqual(resolveCited("server/state/store.mjs", "docs").path, "server/state/store.mjs");
  assert.strictEqual(resolveCited("state/store.mjs", "docs").path, "server/state/store.mjs");
  assert.strictEqual(resolveCited("store.mjs", "docs").path, "server/state/store.mjs");
  assert.strictEqual(resolveCited("../state/store.mjs", "server/revision").path, "server/state/store.mjs");
  assert.ok(resolveCited("no-such-file.mjs", "docs").error, "an unknown path resolved to something");

  const hits = citationsIn("see state/store.mjs:171 and pdf.mjs:35-40 here");
  assert.strictEqual(hits.length, 2, "the citation extractor no longer matches both forms");
  assert.deepStrictEqual([hits[0].raw, hits[0].first, hits[0].last], ["state/store.mjs", 171, null]);
  assert.deepStrictEqual([hits[1].raw, hits[1].first, hits[1].last], ["pdf.mjs", 35, 40]);
  assert.strictEqual(CITATION.global, true, "the citation regex must be global to match more than once");
});

test("a bare `:N` continuation is a failure, because nothing can resolve its filename", () => {
  // The form this repo actually writes: "(flush-mount-fit.mjs:129-133, :202)".
  // A reader gets the filename from the sentence. An extractor cannot, without
  // guessing — so the ":202" half used to be invisible: not resolved, not
  // pinned, not checked, and silently so.
  const [bare] = bareContinuationsIn("resolved through FIT_CLASS_RULES (flush-mount-fit.mjs:129-133, :202), so");
  assert.ok(bare, "a bare continuation citation went unnoticed");
  assert.strictEqual(bare.token, ":202");
  assert.strictEqual(bare.after, "flush-mount-fit.mjs:129");

  // It survives one wrapped line of prose, which is how the docs wrap.
  assert.strictEqual(
    bareContinuationsIn("the two branches (state/store.mjs:190 on the invalid\nbranch, :198 on the valid one)").length,
    1,
    "a continuation that wrapped onto the next line went unnoticed",
  );

  // And a colon-number that no citation introduces is nobody's continuation:
  // the README tells a reader to run the API `on :8787`.
  assert.deepStrictEqual(bareContinuationsIn("npm start   # API on :8787"), []);
  assert.deepStrictEqual(
    bareContinuationsIn(`cited at store.mjs:171.\n${"filler prose. ".repeat(20)}\nthe console on :5173`),
    [],
    "a port number far from any citation was read as a continuation",
  );
});

test("a range pin has to name both of its ends", () => {
  // A range pin that matched anywhere inside its range would tolerate drift up
  // to the width of the range — measured: shifting flush-mount-fit.mjs by two
  // lines left `:129-133` pinned to "FIT_CLASS_RULES" green, after the shift had
  // already made the citation wrong. So the boundaries are what is pinned.
  const src = [{ label: "probe", dir: "docs", text: "see state/store.mjs:43-51 here" }];

  const bothEnds = checkCitations(src, { "server/state/store.mjs:43-51": [" * StateStore interface", " */"] });
  assert.deepStrictEqual(bothEnds.findings, []);

  const insideOnly = checkCitations(src, { "server/state/store.mjs:43-51": "StateStore" });
  assert.strictEqual(insideOnly.findings.length, 1);
  assert.match(insideOnly.findings[0], /must be exactly \[firstLineText, lastLineText\]/);

  // and a pair is required to BE a pair — three entries is a table nobody reads
  const lopsided = checkCitations(src, { "server/state/store.mjs:43-51": [" * StateStore interface", " */", "extra"] });
  assert.strictEqual(lopsided.findings.length, 1);

  const wrongEnd = checkCitations(src, { "server/state/store.mjs:43-51": [" * StateStore interface", "no-such-text"] });
  assert.strictEqual(wrongEnd.findings.length, 1);
  assert.match(wrongEnd.findings[0], /line 51 is pinned to/);
});

test("an unpinned citation fails, and a pin nothing cites fails too", () => {
  // Both directions, because a table that only fails one way rots the other.
  const unpinned = checkCitations([{ label: "probe", dir: "docs", text: "see state/store.mjs:171" }], {});
  assert.strictEqual(unpinned.findings.length, 1);
  assert.match(unpinned.findings[0], /server\/state\/store\.mjs:171, which is not pinned/);

  const orphaned = checkCitations([], { "server/state/store.mjs:171": "REVISION_REQUESTED" });
  assert.strictEqual(orphaned.findings.length, 1);
  assert.match(orphaned.findings[0], /nothing in scope cites any more/);
});

test("the pin table is not quietly empty, and every key is a path this repo has", () => {
  // A pin table that stopped being loaded would make the first test vacuous.
  assert.ok(Object.keys(PINS).length >= 20, "the pin table has shrunk unexpectedly");
  for (const key of Object.keys(PINS)) {
    const cut = key.lastIndexOf(":");
    assert.strictEqual(
      resolveCited(key.slice(0, cut), "docs").path,
      key.slice(0, cut),
      `the pin ${key} is not keyed on a repo-relative path`,
    );
  }
});
