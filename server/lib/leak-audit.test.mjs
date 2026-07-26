// The audit's own guards, mutation-tested.
//
// The order in this file is the order of the argument. The control comes
// first — including what happens when the control itself is broken — because
// every assertion below it is worthless if the scanner cannot demonstrate it
// can see a leak. Then the two vocabularies, each proven to fire AND proven
// not to cry wolf. Then the process contract: the script exits non-zero.
//
// Path fixtures here are ASSEMBLED, never spelled out, exactly as in
// repo-path.test.mjs — and the ESCAPED variants are produced by escaping a
// fixture at runtime rather than typed longhand. This file is tracked, so it
// sits inside the corpus its own audit sweeps: a literal machine root here
// would flag its own test data, turn the audit permanently red, and get the
// audit deleted. (Measured, not theorised: the first draft of this file typed
// one escaped fixture out longhand and the audit went red on line 136 of
// itself.)
//
// To the auditor who got a hit anywhere in this file: every name in it is
// invented — "someone", "not-a-real-person", "host", "share".

import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runAudit,
  shapeFindings,
  parseEolRows,
  indexEolFindings,
  trackedCorpus,
  trackedFiles,
  bundleCorpus,
  describeFindings,
  CONTROL_NAME,
  CONTROL_KINDS,
} from "./leak-audit.mjs";
import { COMMITTED_PATH, MACHINE_PATH } from "./repo-path.mjs";
import { VacuousScanError, CONTROL_TOKEN } from "./identity.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const AUDIT = join(REPO, "server", "lib", "leak-audit.mjs");

// The machine roots, assembled. See the header.
const DRIVE = "C" + ":" + "\\";
const DRIVE_FWD = "D" + ":" + "/";
const USERS = "/" + "Users/";
const HOME = "/" + "home/";
const UNC = "\\" + "\\";

const WIN_PATH = `${DRIVE}Users\\someone\\part.stl`;
const UNC_PATH = `${UNC}host\\share\\part.stl`;

/** One round of backslash-escaping, the way JSON.stringify would do it. */
const esc = (p, times = 1) => {
  let s = p;
  for (let i = 0; i < times; i++) s = s.split("\\").join("\\" + "\\");
  return s;
};

const clean = () => [{ name: "a.md", text: "nothing to see here" }];
const kinds = (findings) => [...new Set(findings.map((f) => f.kind))].sort();

// --- the control -------------------------------------------------------------

test("the control is reported on every kind before any verdict is emitted", () => {
  const v = runAudit(clean());
  assert.deepEqual(kinds(v.control), [...CONTROL_KINDS].sort());
  for (const f of v.control) assert.equal(f.where, CONTROL_NAME);
  // and it does not contaminate the corpus verdict
  assert.deepEqual(v.findings, []);
  assert.equal(v.entries, 1);
});

test("a control that carries no leak refuses to produce a verdict at all", () => {
  // The mutation this whole design exists for: break the control line and the
  // script must not emit a clean verdict. A scanner that has gone blind reads
  // exactly like a clean repo, which is how the previous shell-based audit
  // reported a planted leak as CLEAN.
  assert.throws(
    () => runAudit(clean(), { control: { name: CONTROL_NAME, text: "nothing planted here at all" } }),
    (e) => {
      assert.ok(e instanceof VacuousScanError, `wrong error type: ${e}`);
      for (const k of CONTROL_KINDS) assert.match(e.message, new RegExp(k), `the refusal did not name ${k}`);
      assert.match(e.message, /no verdict is being emitted/);
      return true;
    },
  );
});

test("one dead rule cannot hide behind the other two — the control is per-kind", () => {
  // Measured lesson, inherited from identity.mjs: with a single combined probe
  // a dead rule hides behind a live one that matched the same string. So each
  // kind is dropped from the control in turn and the refusal must name it.
  const parts = {
    bom: "ï»¿",
    path: ` scandir '${WIN_PATH}' `,
    identity: ` run by ${CONTROL_TOKEN} `,
  };
  for (const dropped of CONTROL_KINDS) {
    const text = CONTROL_KINDS.filter((k) => k !== dropped)
      .map((k) => parts[k])
      .join("");
    assert.throws(
      () => runAudit(clean(), { control: { name: CONTROL_NAME, text } }),
      (e) => {
        assert.match(e.message, new RegExp(`NOT reported for: ${dropped}\\b`), `dropping ${dropped} was not noticed`);
        return true;
      },
      `a control missing its ${dropped} probe was accepted`,
    );
  }
});

test("the audit's own source never spells the control out longhand", () => {
  // If it did, the sweep would flag its own scaffolding and the next person to
  // hit that would delete the guard. Same check identity.test.mjs makes.
  const src = trackedCorpus().filter((e) => e.name.startsWith("server/lib/leak-audit"));
  assert.equal(src.length, 2, "the audit and its test must both be tracked to be swept");
  for (const { name, text } of src) {
    assert.ok(!text.includes(CONTROL_TOKEN), `${name} spells out the control token`);
    assert.deepEqual(shapeFindings(name, text), [], `${name} trips its own path/BOM detector`);
  }
});

// --- fail closed --------------------------------------------------------------

test("a sweep of nothing, or of nothing but empty files, refuses to report clean", () => {
  assert.throws(() => runAudit([]), VacuousScanError);
  assert.throws(() => runAudit([{ name: "a", text: "" }, { name: "b", text: null }]), VacuousScanError);
});

test("a corpus entry cannot impersonate the control and hide behind its findings", () => {
  assert.throws(
    () => runAudit([{ name: CONTROL_NAME, text: "x" }]),
    (e) => {
      assert.match(e.message, /shadows the control/);
      return true;
    },
  );
});

// --- the path vocabulary ------------------------------------------------------

test("every machine root the audit claims is caught, escaped or not", () => {
  // The escaped rows are the documented failure mode: a leak that has been
  // stringified into a ledger reason, a manifest warning or a PDF content
  // stream reads clean to a matcher that accepts exactly one separator. The
  // first draft of this vocabulary accepted exactly one, and missed all three
  // escaped rows below.
  const leaks = {
    "drive root": `scandir '${WIN_PATH}'`,
    "drive root, escaped once": `"scandir '${esc(WIN_PATH)}'"`,
    "drive root, escaped twice": `"scandir '${esc(WIN_PATH, 2)}'"`,
    "drive root, forward slashes": `open ${DRIVE_FWD}Users/someone/part.stl`,
    "UNC share": `open '${UNC_PATH}'`,
    "UNC share, escaped once": `"open '${esc(UNC_PATH)}'"`,
    "POSIX home": `open ${HOME}someone/part.stl`,
    "macOS home": `open ${USERS}someone/part.stl`,
    "WSL mount of a Windows home": `open /mnt/c${USERS}someone/part.stl`,
  };
  for (const [label, text] of Object.entries(leaks)) {
    assert.match(text, COMMITTED_PATH, `the exported vocabulary is blind to ${label}`);
    const found = shapeFindings("f.txt", text).filter((f) => f.kind === "path");
    assert.ok(found.length >= 1, `the audit is blind to ${label}: ${text}`);
  }
});

test("a path finding locates the leak without republishing the chain", () => {
  const text = `line one\nline two\nscandir '${DRIVE}Users\\someone-with-a-real-name\\secret-project\\part.stl'`;
  const [f] = shapeFindings("docs/x.md", text).filter((x) => x.kind === "path");
  assert.equal(f.where, "docs/x.md");
  assert.equal(f.line, 3, "the line number is how the auditor finds it");
  const rendered = describeFindings([f]);
  assert.ok(!rendered.includes("someone-with-a-real-name"), `the finding republished the user segment: ${rendered}`);
  assert.ok(!rendered.includes("secret-project"), `the finding republished the chain: ${rendered}`);
  assert.match(rendered, /docs\/x\.md:3/, "the finding must still say where to look");
});

test("the path vocabulary does not cry wolf on what this repo actually contains", () => {
  // Every one of these is a real shape in a tracked file. A detector that fires
  // on them is a detector somebody switches off within a day — which is the
  // whole reason this vocabulary is narrower than MACHINE_PATH.
  for (const ok of [
    "samples/requests/plain-plate.json",
    "<outside-repo>/9f3c.json",
    "no route: GET /api/jobs",
    "fetch failed: https://api.zoo.dev/user/payment",
    "see https://example.com/var/log/notes",
    "server/pipeline/data/packages/6059",
    "the roots are /root/, /tmp/, /var/, /private/, /media/, /opt/, /srv/",
    "a temp dir like /tmp/toolcrib-x/11111111-1111-4111-8111-111111111111.json",
    // The escaped fixture that fills repo-path.test.mjs. The escape run starts
    // mid-token, so it is not a network share, and the drive letter that would
    // make it a drive path is assembled at runtime and never in the file.
    "an escaped fixture: " + esc("Users\\someone\\tmp\\zz\\data\\jobs"),
    "engine build s3://bucket/part.stl",
  ])
    assert.deepEqual(shapeFindings("f.txt", ok), [], `the path vocabulary cried wolf on: ${ok}`);
});

test("the committed-file vocabulary is a documented SUBSET, not a second opinion", () => {
  // Pinned as a test so the narrowing cannot be quietly forgotten: a
  // machine-rooted path that names nobody passes this audit, and is still
  // scrubbed out of any judge-visible message by MACHINE_PATH next door.
  const namesNobody = "open /var/folders/zz/T/scratch.stl";
  assert.match(namesNobody, MACHINE_PATH, "the message-level detector still covers it");
  assert.doesNotMatch(namesNobody, COMMITTED_PATH, "the committed-file audit deliberately does not");
});

// --- the identity vocabulary (called, not reimplemented) ----------------------

test("an account uuid in a corpus entry is a finding, via the one identity scanner", () => {
  const stranger = "7c9f2a41-3b8e-4d55-9a12-6ef0c3b7d284";
  const v = runAudit([{ name: "fixture.json", text: `{"user_id": "${stranger}", "mass": 13.07}` }]);
  const id = v.findings.filter((f) => f.kind === "identity");
  assert.equal(id.length, 1, `expected one identity finding, got ${JSON.stringify(v.findings)}`);
  assert.equal(id[0].where, "fixture.json");
  assert.ok(!describeFindings(id).includes(stranger), "the finding republished the identifier");
  // A job handle is not a person: the audit must not fire on this repo's own ids.
  assert.deepEqual(runAudit([{ name: "j.json", text: `{"request_id": "${stranger}"}` }]).findings, []);
});

// --- BOM ----------------------------------------------------------------------

test("a BOM is a finding only at the head of a file", () => {
  const bom = "ï»¿";
  assert.deepEqual(kinds(shapeFindings("a.json", `${bom}{"a":1}`)), ["bom"]);
  // Mid-file those three bytes are ordinary content — an audit that fired on
  // them would flag every file that merely discusses a BOM, this one included.
  assert.deepEqual(shapeFindings("a.json", `{"note":"a BOM reads as ${bom}"}`), []);
});

// --- committed line endings ---------------------------------------------------

test("the EOL parser survives an attributes column that contains spaces", () => {
  // The regression this parser is written against: once .gitattributes exists,
  // `attr/` reads "text=auto eol=lf", and a whitespace split reads the path as
  // "eol=lf" and pronounces every repo clean forever after.
  const rows = [
    "i/lf    w/crlf  attr/text=auto eol=lf \tserver/lib/zoo.mjs",
    "i/crlf  w/crlf  attr/text=auto eol=lf \tdocs/BAD.md",
    "i/-text w/-text attr/binary           \tsamples/plain-plate/preview.png",
  ].join("\0");
  const { findings, files } = parseEolRows(rows);
  assert.equal(files, 3);
  assert.equal(findings.length, 1, "only the blob that is CRLF IN THE INDEX is a finding");
  assert.equal(findings[0].where, "docs/BAD.md");
  assert.match(findings[0].detail, /CRLF/);
});

test("an unparseable EOL row is refused, never skipped", () => {
  // A skipped row is a file nobody checked, reported as checked.
  assert.throws(() => parseEolRows("i/lf w/lf no-tab-here"), VacuousScanError);
  assert.throws(() => parseEolRows(""), VacuousScanError);
});

test("no committed blob in this repo carries CRLF or mixed line endings", () => {
  const { findings, files } = indexEolFindings();
  assert.deepEqual(findings, [], `committed blobs carry CRLF:\n${describeFindings(findings)}`);
  assert.ok(files >= 200, `expected the whole repo, checked only ${files} blobs`);
});

// --- the sweep, and the process contract --------------------------------------

test("no tracked file in this repo carries a path, an identity or a BOM", () => {
  const files = trackedFiles();
  const v = runAudit(trackedCorpus());
  assert.deepEqual(v.findings, [], `the repo is not clean:\n${describeFindings(v.findings)}`);

  // The corpus has to be shown to be the real one: a sweep over three files
  // reads identical to a sweep over all of them.
  for (const required of [
    "samples/plain-plate/validation.json",
    "server/pipeline/backends.mjs",
    "server/lib/leak-audit.mjs",
    "README.md",
    "package.json",
  ])
    assert.ok(files.includes(required), `the sweep never reached ${required}`);
  assert.equal(v.entries, files.length);
  assert.ok(v.entries >= 200, `expected the whole repo, swept only ${v.entries} files`);
  assert.ok(v.bytes > 1_000_000, `expected the whole repo's bytes, read only ${v.bytes}`);
});

test("the script exits 0 clean and NON-ZERO on a planted bundle leak", () => {
  const run = (args) => spawnSync(process.execPath, [AUDIT, ...args], { encoding: "utf8", cwd: REPO });

  const green = run(["--quiet"]);
  assert.equal(green.status, 0, `the audit is red on a clean tree:\n${green.stdout}${green.stderr}`);

  // A bundle OUTSIDE the repo, so proving the non-zero exit never requires
  // planting a leak in a tracked file. JSON.stringify escapes the separators on
  // the way in, so this also exercises the escaped form end to end.
  const dir = mkdtempSync(join(tmpdir(), "toolcrib-leak-audit-"));
  mkdirSync(join(dir, "logs"));
  writeFileSync(join(dir, "logs", "apiRun.json"), JSON.stringify({ note: `scandir '${WIN_PATH}'` }));
  const red = run([`--bundle=${dir}`, "--quiet"]);
  assert.equal(red.status, 1, `a planted bundle leak did not fail the audit:\n${red.stdout}${red.stderr}`);
  assert.match(red.stderr, /path\s+bundle:logs\/apiRun\.json/, red.stderr);
  assert.ok(!red.stderr.includes("someone"), `the audit printed the user segment: ${red.stderr}`);

  // And the bundle walk is not vacuous: an empty --bundle is a refusal, not a pass.
  const empty = run([`--bundle=${mkdtempSync(join(tmpdir(), "toolcrib-leak-audit-empty-"))}`, "--quiet"]);
  assert.equal(empty.status, 2, `an empty bundle was treated as clean:\n${empty.stdout}${empty.stderr}`);
});

test("a bundle corpus is named so a finding says which bundle file it is in", () => {
  const dir = mkdtempSync(join(tmpdir(), "toolcrib-leak-audit-names-"));
  mkdirSync(join(dir, "cad"));
  writeFileSync(join(dir, "cad", "part.kcl"), "// clean\n");
  writeFileSync(join(dir, "manifest.json"), '{"files":[]}\n');
  const names = bundleCorpus(dir)
    .map((e) => e.name)
    .sort();
  assert.deepEqual(names, ["bundle:cad/part.kcl", "bundle:manifest.json"]);
});
