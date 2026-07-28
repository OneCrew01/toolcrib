// node --test "server/revision/*.test.mjs"
//
// The demonstration is a claim-making artifact: it prints "IDENTICAL",
// "DIFFERS", a rule id, an arithmetic chain and a headline sentence about which
// part moved. This file is what stops any of that from rotting into a story the
// numbers no longer support.
//
// It asserts against the DATA runAmendmentDemo() returns, not against the
// prose, with two deliberate exceptions noted at the bottom — the two
// disclosures that would be a real loss if they silently disappeared from the
// output.

import { test } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { STATE, MACHINE } from "../state/states.mjs";
import { flushMountFit } from "../reference/tables/flush-mount-fit.mjs";
import { generateFlushMountPair } from "../generators/flushmount.mjs";
import { PENDING_OPERATOR, ruleValue } from "../reference/schema.mjs";
import { DRAFT_WATERMARK } from "../reference/lookup.mjs";
import {
  runAmendmentDemo,
  renderAmendmentDemo,
  compareKcl,
  demoParent,
  demoMeasurement,
  refuseArgs,
} from "./demo-amend.mjs";

const demo = runAmendmentDemo();
const part = (name) => demo.parts.find((p) => p.name === name);
const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");

// --- the demonstration is deterministic and self-consistent ------------------

test("two runs produce the same data — no clock, no randomness, no accumulated state", () => {
  const a = runAmendmentDemo();
  const b = runAmendmentDemo();
  assert.deepStrictEqual(a.parts, b.parts);
  assert.deepStrictEqual(a.proposal, b.proposal);
  assert.strictEqual(renderAmendmentDemo(a), renderAmendmentDemo(b));
});

test("the hashes are sha256 of the generator's real output, recomputed here independently", () => {
  const before = generateFlushMountPair(demoParent().structuredIntent.flushMount);
  const after = generateFlushMountPair(demo.proposal.amendedRequest.structuredIntent.flushMount);

  assert.strictEqual(part("panel").parentSha256, sha256(before.panelKcl));
  assert.strictEqual(part("panel").amendedSha256, sha256(after.panelKcl));
  assert.strictEqual(part("insert").parentSha256, sha256(before.insertKcl));
  assert.strictEqual(part("insert").amendedSha256, sha256(after.insertKcl));
  for (const p of demo.parts) {
    assert.match(p.parentSha256, /^[0-9a-f]{64}$/);
    assert.match(p.amendedSha256, /^[0-9a-f]{64}$/);
  }
});

// --- the money shot ---------------------------------------------------------

test("panel: IDENTICAL — the parent and amended programs are the same bytes", () => {
  const panel = part("panel");
  assert.strictEqual(panel.identical, true);
  assert.strictEqual(panel.parentSha256, panel.amendedSha256);
  assert.deepStrictEqual(panel.comparison.changes, [], "the panel program moved");
});

test("insert: DIFFERS — and the edit is exactly the declared clearance constant", () => {
  const insert = part("insert");
  assert.strictEqual(insert.identical, false);
  assert.notStrictEqual(insert.parentSha256, insert.amendedSha256);

  const edits = insert.comparison.changes.filter((c) => c.kind === "parameter");
  assert.strictEqual(edits.length, 1, "exactly one declared-clearance line may change");
  assert.strictEqual(edits[0].parent, "clearancePerSide = 0.15mm");
  assert.strictEqual(edits[0].amended, "clearancePerSide = 0.2mm");
});

test("every other changed insert line is downstream of that one parameter", () => {
  const insert = part("insert");
  const downstream = insert.comparison.changes.filter((c) => c.kind !== "parameter");
  assert.ok(downstream.length > 0, "a clearance change moves the insert profile; none moved");
  for (const c of downstream) {
    assert.ok(
      c.kind === "comment" || c.kind === "geometry",
      `line ${c.lineNo} classified as ${c.kind}, which the output has no sentence for`,
    );
    assert.strictEqual(typeof c.parent, "string");
    assert.strictEqual(typeof c.amended, "string");
  }
  assert.strictEqual(insert.comparison.alignedByLineCount, true, "the two programs no longer line up by position");
});

test("the headline claim, tested directly: clearance does not enter the panel program", () => {
  // Not a re-check of the fixture — the property itself. Two clearances that
  // differ by a lot, everything else held, and the panel comes out the same
  // bytes. This is what makes "the amendment touched exactly the part it should"
  // a measurement rather than a coincidence of the demo's numbers.
  const base = demoParent().structuredIntent.flushMount;
  const tight = generateFlushMountPair({ ...base, clearancePerSideMm: 0.1 });
  const loose = generateFlushMountPair({ ...base, clearancePerSideMm: 0.25 });
  assert.strictEqual(tight.panelKcl, loose.panelKcl, "the panel program reads the clearance after all");
  assert.notStrictEqual(tight.insertKcl, loose.insertKcl, "the insert program ignores the clearance");
});

test("the amended request is the parent with only the three fit fields changed", () => {
  assert.strictEqual(demo.onlyFitFieldsChanged, true);
  const before = demoParent().structuredIntent.flushMount;
  const after = demo.proposal.amendedRequest.structuredIntent.flushMount;
  assert.deepStrictEqual(after.panel, before.panel);
  assert.deepStrictEqual(after.opening, before.opening);
  assert.deepStrictEqual(after.insert, before.insert);
  assert.deepStrictEqual(after.colors, before.colors);
});

// --- the numbers the output prints ------------------------------------------

test("cited: the band's number is what its own row holds, and the id names that row", () => {
  const { band } = demo.proposal;
  assert.strictEqual(band.basis, "cited");
  const rule = flushMountFit.byId[band.ruleId];
  assert.ok(rule, `${band.ruleId} is not a row of ${flushMountFit.name}`);
  assert.strictEqual(ruleValue(rule), band.valueMm, "the printed band and the cited row disagree");
  assert.ok(band.citation.length > 0);
});

test("computed: delta and amended clearance are labelled ours, and the arithmetic adds up", () => {
  const { processDeltaMm: delta, amendedClearanceMm: amended, band } = demo.proposal;
  assert.strictEqual(delta.basis, "computed");
  assert.strictEqual(amended.basis, "computed");

  // The property, not an incidental equality: the amended clearance is the sum
  // of the two numbers printed above it, quantized the way the module states.
  const m = demoMeasurement();
  assert.strictEqual(delta.valueMm, Math.round(((m.nominalMm - m.measuredMm) / 2) * 1000) / 1000);
  assert.strictEqual(amended.valueMm, Math.round((band.valueMm + delta.valueMm) * 1000) / 1000);

  // And the demonstration's own story: 0.15 band + 0.05 delta = 0.2 per side.
  assert.strictEqual(band.valueMm, 0.15);
  assert.strictEqual(delta.valueMm, 0.05);
  assert.strictEqual(amended.valueMm, 0.2);
  assert.strictEqual(amended.withinCitedBand, false, "the story is a compensation that leaves the band");

  for (const node of [delta, amended]) {
    assert.ok(node.arithmetic.length > 0, "a computed number with no shown work");
  }
});

test("the demonstration runs on unsigned rows and says so, rather than quietly opting out", () => {
  assert.strictEqual(demo.proposal.verification.status, PENDING_OPERATOR);
  assert.strictEqual(demo.proposal.watermark, DRAFT_WATERMARK);
  assert.ok(demo.proposal.warnings.length >= 2);
});

// --- the output prints what the data holds ----------------------------------

test("every warning reaches the output verbatim — none is summarised away", () => {
  const text = renderAmendmentDemo(demo);
  for (const w of demo.proposal.warnings) {
    assert.ok(text.includes(w), `a warning never reached the output: ${w.slice(0, 40)}...`);
  }
  assert.ok(text.includes(demo.proposal.watermark));
});

test("the output carries both verdicts, both hashes per part, and the basis labels", () => {
  const text = renderAmendmentDemo(demo);
  assert.ok(text.includes("IDENTICAL"), "no IDENTICAL verdict printed");
  assert.ok(text.includes("DIFFERS"), "no DIFFERS verdict printed");
  for (const p of demo.parts) {
    assert.ok(text.includes(p.parentSha256), `${p.name} parent hash not printed`);
    assert.ok(text.includes(p.amendedSha256), `${p.name} amended hash not printed`);
  }
  assert.ok(text.includes("CITED"), "the cited label is not in the output");
  assert.ok(text.includes("COMPUTED"), "the computed label is not in the output");
  assert.ok(text.includes(demo.proposal.band.ruleId), "the band's rule id is not in the output");
  assert.ok(text.includes(demo.proposal.band.citation), "the band's citation string is not in the output");
  assert.ok(text.includes(demo.proposal.processDeltaMm.arithmetic), "the delta's arithmetic is not shown");
  assert.ok(text.includes(demo.proposal.amendedClearanceMm.arithmetic), "the amendment's arithmetic is not shown");
});

test("the diff is printed, both sides of it", () => {
  const text = renderAmendmentDemo(demo);
  for (const c of part("insert").comparison.changes) {
    assert.ok(text.includes(c.parent), `changed line ${c.lineNo} missing its "before"`);
    assert.ok(text.includes(c.amended), `changed line ${c.lineNo} missing its "after"`);
  }
});

// --- the honesty the output owes a reader -----------------------------------
//
// The two prose pins in this file. Both are DISCLOSURES: a reader who runs the
// demonstration and is not told what it does not do has been misled by
// omission, and no data field can carry that for them.

test("the output discloses that the revision edge is not driven", () => {
  const text = renderAmendmentDemo(demo);
  assert.ok(text.includes("REVISION_REQUESTED -> DRAFT"), "the un-driven edge is not named");
  assert.ok(text.includes("pure module"), "the output does not say the module is unwired");
});

test("the output discloses that the caliper reading is a scenario, not a measurement", () => {
  // The geometry is real and the arithmetic is real; the reading is made up.
  // Printing "the measurement" without saying which half is which would be this
  // repo's own worst failure mode — a number that reads as measured and is not.
  const text = renderAmendmentDemo(demo);
  assert.ok(text.includes("WORKED EXAMPLE"), "the output does not say it is a worked example");
  assert.ok(
    text.includes("nobody printed this pair and measured it"),
    "the output does not say the caliper reading is a scenario",
  );
});

test("and that disclosure is true of the state map it points at", () => {
  // The claim in the output is precise: the EDGE EXISTS, nothing walks it. The
  // first half is checkable right here, so it is checked rather than trusted.
  assert.ok(
    MACHINE[STATE.REVISION_REQUESTED].next.includes(STATE.DRAFT),
    "the output says the state map carries this edge, and it does not",
  );
});

// Hash-shaped: 8-64 hex characters carrying at least one digit AND at least one
// a-f letter, so ordinary prose and bare numbers are not mistaken for one.
const hashesIn = (s) =>
  (String(s).match(/\b[0-9a-f]{8,64}\b/g) ?? []).filter((t) => /[0-9]/.test(t) && /[a-f]/.test(t));

/** The README's `npm run amend` section, as lines. */
function readmeAmendSection() {
  const lines = readFileSync(new URL("../../README.md", import.meta.url), "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("## ") && l.includes("npm run amend"));
  assert.ok(start >= 0, "the README no longer has a section headed with `npm run amend`");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

test("the README attributes each quoted hash to the part it belongs to, with that part's verdict", () => {
  // ATTRIBUTION, not membership — and the difference is the whole point of this
  // test. An earlier version checked only that every hash-shaped token in the
  // section was a prefix of one of the four live values. Measured: transposing
  // the two rows of the block, so the README said the PANEL program changed and
  // the INSERT program did not — the exact inverse of this repo's headline
  // claim — left that version 19/19 green. Every hash was still "one of the
  // four". So each row is now parsed on its own and matched against its own
  // part's hashes and its own verdict.
  const section = readmeAmendSection();

  for (const p of demo.parts) {
    const row = section.find((l) => new RegExp(`^\\s*${p.name}\\b`).test(l) && hashesIn(l).length > 0);
    assert.ok(row, `the README's hash block no longer has a ${p.name} row quoting hashes`);

    const iParent = row.indexOf("parent");
    const iAmended = row.indexOf("amended");
    assert.ok(
      iParent >= 0 && iAmended > iParent,
      `the ${p.name} row no longer labels its hashes "parent" then "amended", so neither can be ` +
        `attributed to a side: ${row.trim()}`,
    );

    const [quotedParent] = hashesIn(row.slice(iParent, iAmended));
    const [quotedAmended] = hashesIn(row.slice(iAmended));
    assert.ok(quotedParent, `the ${p.name} row quotes no hash after "parent": ${row.trim()}`);
    assert.ok(quotedAmended, `the ${p.name} row quotes no hash after "amended": ${row.trim()}`);
    assert.ok(
      p.parentSha256.startsWith(quotedParent),
      `the README calls ${quotedParent} the ${p.name} PARENT hash; this demonstration prints ` +
        `${p.parentSha256.slice(0, quotedParent.length)}`,
    );
    assert.ok(
      p.amendedSha256.startsWith(quotedAmended),
      `the README calls ${quotedAmended} the ${p.name} AMENDED hash; this demonstration prints ` +
        `${p.amendedSha256.slice(0, quotedAmended.length)}`,
    );

    const right = p.identical ? "IDENTICAL" : "DIFFERS";
    const wrong = p.identical ? "DIFFERS" : "IDENTICAL";
    assert.ok(row.includes(right), `the README's ${p.name} row should read ${right}: ${row.trim()}`);
    assert.ok(
      !row.includes(wrong),
      `the README's ${p.name} row reads ${wrong}; this demonstration measures ${right}`,
    );
  }
});

test("and no hash quoted anywhere else in that README section has gone stale", () => {
  // The freshness half, kept: a quoted hash is the one kind of doc claim that
  // can go silently false — change the generator's whitespace and the README is
  // wrong with nothing to say so. Removing the hashes from the README is
  // allowed; keeping stale ones is not.
  const live = demo.parts.flatMap((p) => [p.parentSha256, p.amendedSha256]);
  const quoted = hashesIn(readmeAmendSection().join("\n"));
  assert.ok(quoted.length > 0, "the README section quotes no hashes — if that was deliberate, delete this assertion");
  for (const q of quoted) {
    assert.ok(
      live.some((h) => h.startsWith(q)),
      `the README quotes ${q}, which is not a prefix of any hash this demonstration prints`,
    );
  }
});

// --- the small surfaces -----------------------------------------------------

test("compareKcl reports a position mismatch instead of printing a shifted diff", () => {
  const same = compareKcl("a\nb\nc\n", "a\nB\nc\n");
  assert.strictEqual(same.alignedByLineCount, true);
  assert.strictEqual(same.changes.length, 1);
  assert.strictEqual(same.changes[0].lineNo, 2);

  const shifted = compareKcl("a\nb\n", "a\nb\nc\n");
  assert.strictEqual(shifted.alignedByLineCount, false);
  assert.strictEqual(shifted.parentLines, 3);
  assert.strictEqual(shifted.amendedLines, 4);
});

test("an argument is a refusal, not a shrug", () => {
  assert.strictEqual(refuseArgs([]), null);
  const refusal = refuseArgs(["--json"]);
  assert.ok(typeof refusal === "string" && refusal.includes("--json"), "the refusal does not quote the argument");
});
