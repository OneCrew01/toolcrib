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
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runAudit,
  main,
  parseArgs,
  shapeFindings,
  parseEolRows,
  gitEolRows,
  trackedCorpus,
  trackedFiles,
  bundleCorpus,
  describeFindings,
  CONTROL,
  CONTROL_NAME,
  controlKinds,
  declaredKinds,
  unprovenKinds,
} from "./leak-audit.mjs";
import { COMMITTED_PATH, MACHINE_PATH } from "./repo-path.mjs";
import { VacuousScanError, CONTROL_TOKEN } from "./identity.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const AUDIT = join(REPO, "server", "lib", "leak-audit.mjs");
/** The audit's path as git spells it, so a scratch copy lands where its imports expect. */
const posix = (p) => p.split(sep).join("/");
const AUDIT_REL = posix(relative(REPO, AUDIT));

/** Every relative specifier one source imports — static `from "./x"` and `import("./x")` alike. */
const relativeImports = (src) => [
  ...new Set([...String(src).matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.[^"']*)["']/g)].map((m) => m[1])),
];

/**
 * Every local module reachable from the audit, transitively, repo-relative —
 * DERIVED from the imports rather than typed beside them.
 *
 * Two tests need this list and they must never disagree: one PINS it (a new
 * import is how a detector in another module gets wired in, and such a detector
 * is a kind the source scan cannot see), and one COPIES it into a scratch repo.
 *
 * The copy list used to be the hand-typed `["identity.mjs", "repo-path.mjs"]`,
 * and that was a trap. Measured, with a third module added and imported: the
 * copied audit died at ESM resolution before it could refuse, and the assertion
 * that fired said "a broken kind scan did not exit as a refusal" — 31 tests, 30
 * pass, 1 fail, the one failure blaming the kind scan when the actual cause was
 * a file nobody copied. A guard firing for the wrong reason reads exactly like a
 * guard that works.
 */
function auditModuleClosure() {
  const seen = new Map();
  const visit = (abs) => {
    for (const spec of relativeImports(readFileSync(abs, "utf8"))) {
      const dep = resolve(dirname(abs), spec);
      const rel = posix(relative(REPO, dep));
      if (seen.has(rel)) continue;
      seen.set(rel, dep);
      visit(dep);
    }
  };
  visit(AUDIT);
  return [...seen.keys()];
}

/**
 * A scratch git repo holding a COPY of the audit and every module it imports,
 * with the audit's source mutated on the way in and any extra files planted.
 *
 * A copy rather than the real tree, because both callers need an audit that is
 * WRONG — one whose own kind scan comes back short, one wired to a fifth
 * detector in a sibling module — and mutating a tracked file to prove a test
 * would leave the repo dirty for the duration of the run.
 */
function scratchAudit(mutate, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "toolcrib-leak-audit-copy-"));
  const put = (rel, text) => {
    // A dependency resolving OUTSIDE the repo would give a "../" here and write
    // into the parent of a scratch directory. Not reachable today — the import
    // pin allows two modules, both in server/lib — but a test that writes where
    // it was not asked to is a worse bug than the one it was checking for.
    assert.ok(!rel.startsWith(".."), `refusing to write outside the scratch repo: ${rel}`);
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  for (const rel of auditModuleClosure()) put(rel, readFileSync(join(REPO, rel), "utf8"));
  for (const [rel, text] of Object.entries(extra)) put(rel, text);

  const original = readFileSync(AUDIT, "utf8");
  const mutated = mutate(original);
  assert.notEqual(mutated, original, "the mutation did not apply — this test proves nothing");
  put(AUDIT_REL, mutated);

  for (const args of [["init", "-q", "."], ["add", "-A"]])
    assert.equal(spawnSync("git", args, { cwd: dir, encoding: "utf8" }).status, 0, `git ${args[0]} failed`);
  return { dir, audit: join(dir, AUDIT_REL) };
}

/**
 * A fifth detector in a module of its own, spelling its kind as ordinarily as
 * any detector in the audit does. `fires` is a literal "true" or "false": the
 * silent one is the case that shipped unproven, the loud one is the case the
 * verdict's second check catches.
 */
const siblingDetector = (fires) => `// A fifth detector, in a module of its own — where "one scanner, not two" says
// a detector's matching belongs. Its kind is spelled here, not at the push.
export const scanProbe = (entries) =>
  entries
    .filter(() => ${fires})
    .map((e) => ({ kind: "secret", where: e.name, line: 1, detail: "a planted secret" }));
`;

/** Where that module lands. Deliberately a name no real detector would take, so a genuine
 *  fifth detector added one day collides with nothing here and gets ONE red test, not two. */
const PROBE_MODULE = "server/lib/probe-detector.mjs";

/** Run a scratch copy of the audit as a program, the way a judge would run the real one. */
function runCopy({ dir, audit }, args = ["--quiet"]) {
  const r = spawnSync(process.execPath, [audit, ...args], { encoding: "utf8", cwd: dir });
  const said = `${r.stdout}${r.stderr}`;

  // DID IT EVEN START? Every path through main() prints the "leak audit" prefix
  // except a --quiet clean run, which prints nothing at all; a copy that died on
  // the way in prints a raw Node stack and neither. Without this check, an
  // uncopied module or a mutation that will not compile arrives at whichever
  // assertion comes next and is reported as ITS subject failing.
  //
  // Both halves measured, both while the verdict was in perfect health: a
  // hand-typed copy list that missed a module gave "a broken kind scan did not
  // exit as a refusal: ERR_MODULE_NOT_FOUND", and a mutation applied twice gave
  // "the silent fifth detector changed the verdict: SyntaxError: Identifier
  // 'scanProbe' has already been declared". A guard firing for the wrong reason
  // reads exactly like a guard that works.
  if (!said.includes("leak audit"))
    assert.doesNotMatch(
      said,
      /\n\s+at /,
      `the scratch copy never reached the audit — it died on the way in, so nothing below is a statement ` +
        `about the verdict. Fix the harness (auditModuleClosure, or the mutation this test applies), not ` +
        `the assertions after it:\n${said}`,
    );
  return { ...r, said };
}

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

/** `git ls-files --eol -z` rows for a repo whose blobs are all LF. */
const LF_ROWS = ["i/lf    w/lf    attr/                 \ta.md", "i/lf    w/lf    attr/text=auto eol=lf \tb.json"].join(
  "\0",
);

/**
 * A scratch git repo OUTSIDE this one, whose index we control byte for byte.
 *
 * This repo deliberately contains no CRLF blob and no untracked leak, so the
 * only honest way to prove what the audit does when it meets one is to build a
 * repo that has one and point the whole program at it — argv, corpus, git,
 * verdict, exit code. Planting either defect in the real tree to prove a test
 * would dirty a tracked file for the duration of the run.
 */
function scratchRepo({ crlf = false, untracked = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "toolcrib-leak-audit-repo-"));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git("init", "-q", ".");
  writeFileSync(join(dir, "a.md"), "clean text\n");
  // -c core.autocrlf=false so the CRLF written here is the CRLF git records:
  // this machine's global core.autocrlf is true and would normalise it away,
  // which would make the test pass for the wrong reason (no finding, no repo).
  if (crlf) writeFileSync(join(dir, "bad.md"), "bad\r\nline\r\n");
  git("-c", "core.autocrlf=false", "add", "-A");
  // Written AFTER the add, so it is genuinely untracked.
  if (untracked) writeFileSync(join(dir, untracked.name), untracked.text);
  return dir;
}

/** Run the whole program against a repo, capturing what it said. */
function runMain(argv, repoRoot) {
  const out = [];
  const errs = [];
  const code = main(
    argv,
    (s) => out.push(s),
    (s) => errs.push(s),
    repoRoot,
  );
  return { code, out: out.join("\n"), err: errs.join("\n") };
}

// --- the control -------------------------------------------------------------

test("the control is reported on every kind before any verdict is emitted", () => {
  const v = runAudit(clean(), LF_ROWS);
  assert.deepEqual(kinds(v.control), [...controlKinds()].sort());
  for (const f of v.control) assert.equal(f.where, CONTROL_NAME);
  // and it does not contaminate the corpus verdict
  assert.deepEqual(v.findings, []);
  assert.equal(v.entries, 1);
  assert.equal(v.blobs, 2, "the control's own row must not be counted as a committed blob");
});

test("the kind list is read out of the audit's own source, not typed beside it", () => {
  // What this replaces, and why: the previous version of this test built its
  // expected set BY HAND — two literal probe strings plus a hardcoded
  // "identity" — and asserted it equal to a hand-typed list. Two hand-written
  // lists agreeing with each other proves only that one person wrote both, so
  // it could fail in one direction (a kind REMOVED) and never in the one the
  // header promised. Measured on that version: a fifth detector was added to
  // shapeFindings, the list was left alone, and this file stayed at 27 pass /
  // 0 fail while the CLI printed its four-kind control line and then CLEAN at
  // exit 0.
  assert.deepEqual(controlKinds(), declaredKinds(readFileSync(AUDIT, "utf8")), "the kind list is not derived");

  // EXACT, not a floor — read this before "fixing" it. It fires in BOTH
  // directions on purpose, and the addition direction is the one worth
  // explaining, because whoever trips it will be doing something right:
  //
  //   a documented detector deleted or renamed   -> red, obviously wanted
  //   a legitimate FIFTH detector added          -> red, also wanted
  //
  // The second is not a false alarm. The audit itself is satisfied the moment
  // the fifth kind gets a probe in the control, and nothing after that would
  // make a human re-read the four names the header spells out in prose. This
  // line is the only thing that does. IF YOU ARE HERE HAVING ADDED A FIFTH
  // DETECTOR: plant its probe in the control, add its name and its one-line
  // description to the header list in leak-audit.mjs, then add it here. All
  // three, or the audit and its documentation drift apart again.
  assert.deepEqual([...controlKinds()].sort(), ["bom", "eol", "identity", "path"]);

  // And it is a derivation rather than a coincidence: hand the scan a fifth
  // detector written the way the other four are, and five come back. That is
  // the link the old test was missing — the list GROWS, the control has no
  // probe for the new kind, and runAudit's blind check refuses. That refusal is
  // proven per-kind by "one dead rule cannot hide behind the other three" below.
  const fifth = declaredKinds(`${readFileSync(AUDIT, "utf8")}\nout.push({ kind: "secret", where: name, line: 1 });\n`);
  assert.deepEqual(fifth, [...controlKinds(), "secret"]);
});

test("a fifth detector is found however its kind is written — no spelling switches this off", () => {
  // This test is a graveyard, and every row in it is a real falsification of
  // the header rather than an imagined one. TWICE the scan was fixed by
  // widening a character class, and twice the next reader found a spelling one
  // character outside the new class:
  //
  //   v1  double quotes only        'secret' in single quotes -> derived four,
  //                                 suite 29 pass / 0 fail, CLI CLEAN, exit 0
  //   v2  any quote, but the name   apiKey  -> derived four, suite 31 pass /
  //       had to match [a-z][a-z-]*           0 fail, CLI CLEAN, exit 0
  //                                 sha1, secret_leak -> same
  //
  // So the pattern no longer has a class on the name, and the rows below are
  // what stops one being reintroduced: capitals, digits, a leading digit, a
  // leading underscore, a dot, a space and a non-ASCII letter all have to come
  // back seen. Narrowing KIND_LITERAL turns this red, which is the point —
  // v2 was written by someone reasonable who thought a-z was enough.
  const src = readFileSync(AUDIT, "utf8");
  const spellings = [
    ["double quotes", 'out.push({ kind: "secret", where: name, line: 1 });', "secret"],
    ["single quotes", "out.push({ kind: 'secret', where: name, line: 1 });", "secret"],
    ["backticks", "out.push({ kind: `secret`, where: name, line: 1 });", "secret"],
    ["a quoted key", 'out.push({ "kind": "secret", where: name, line: 1 });', "secret"],
    ["no spaces at all", 'out.push({kind:"secret"});', "secret"],
    ["a capital letter", 'out.push({ kind: "apiKey", where: name });', "apiKey"],
    ["a trailing digit", 'out.push({ kind: "sha1", where: name });', "sha1"],
    ["an underscore", 'out.push({ kind: "secret_leak", where: name });', "secret_leak"],
    ["a leading digit", 'out.push({ kind: "3d-print", where: name });', "3d-print"],
    ["a leading underscore", 'out.push({ kind: "_private", where: name });', "_private"],
    ["a dot", 'out.push({ kind: "zoo.token", where: name });', "zoo.token"],
    ["a space", 'out.push({ kind: "api key", where: name });', "api key"],
    ["a non-ASCII letter", 'out.push({ kind: "clé", where: name });', "clé"],
  ];
  for (const [label, line, expected] of spellings)
    assert.deepEqual(
      declaredKinds(`${src}\n${line}\n`),
      [...controlKinds(), expected],
      `a fifth detector whose kind is written with ${label} was invisible to the scan`,
    );

  // The other direction, so this is a matcher and not a wildcard, and so the
  // residual the header admits to is pinned rather than assumed: a value that
  // is not a quoted literal where the value goes — a variable, a call — stays
  // invisible. That is the case unprovenKinds covers on the way out instead,
  // when the detector first fires. Note what is NOT in this list: no spelling
  // of a literal belongs here, because the scan reads all of them.
  for (const line of ["out.push({ kind: whateverItIs, where: name });", "out.push({ kind: kindFor(m), where: name });"])
    assert.deepEqual(declaredKinds(`${src}\n${line}\n`), controlKinds(), `this should not have been visible: ${line}`);
});

test("a fifth detector in a SIBLING module is invisible until it fires — the residual, measured", () => {
  // The FOURTH falsification of the header, pinned so there is not a fifth. The
  // first three were spellings; this one is location. declaredKinds reads
  // readFileSync(SOURCE) and SOURCE is leak-audit.mjs, so a kind spelled as a
  // perfectly ordinary literal in another module is not in the derived list —
  // which the header's old wording ("being a literal is the whole condition")
  // denied. Measured then: a scanSecrets() in server/lib/secrets.mjs, imported
  // and joined the way scanIdentity is -> derived FOUR, CLI CLEAN at exit 0.
  //
  // Direction one needs no mutation, because this repo already contains the
  // case: identity.mjs uses that same key for its own internal hit vocabulary.
  const src = readFileSync(AUDIT, "utf8");
  const sibling = readFileSync(join(REPO, "server", "lib", "identity.mjs"), "utf8");
  const theirs = declaredKinds(`${src}\n${sibling}`).filter((k) => !controlKinds().includes(k));
  assert.ok(theirs.length >= 1, "identity.mjs no longer keeps a vocabulary of its own — find another live example");
  assert.deepEqual(declaredKinds(src), controlKinds(), "the real derivation must read this file and nothing else");

  // Which is also the measured reason the derivation is NOT simply widened to
  // cover the imports: a sibling's private vocabulary is not something the
  // control can plant a probe for, so widening it turns a CLEAN tree red.
  // (Measured end to end on a clone: derived six, CLI refused at exit 2.)
  assert.throws(
    () => runAudit(clean(), LF_ROWS, { kinds: [...controlKinds(), ...theirs] }),
    (e) => {
      assert.match(e.message, /the control was NOT reported for: /);
      for (const k of theirs) assert.match(e.message, new RegExp(k), `the refusal did not name ${k}`);
      return true;
    },
    "deriving kinds from the imported modules would have to be refused, not accepted",
  );

  // Direction two, the whole program, against a copy wired to a real fifth
  // detector in a module of its own — the join placed with the other pushes
  // into `findings`, which is what the identity join is.
  const wire = (s) =>
    s
      .replace('from "./identity.mjs";', `from "./identity.mjs";\nimport { scanProbe } from "./probe-detector.mjs";`)
      .replace(
        "  const controlFindings = findings.filter(",
        "  findings.push(...scanProbe(all));\n\n  const controlFindings = findings.filter(",
      );

  // (a) Fires on nothing: the audit prints CLEAN at exit 0 and its control line
  //     still says four. THIS IS THE RESIDUAL — asserted rather than described,
  //     so nobody has to take the header's word for it, and so that the day it
  //     stops being true this test says so. It is bounded by (b) and guarded by
  //     the import pin below; what it is not is invisible.
  const quiet = runCopy(scratchAudit(wire, { [PROBE_MODULE]: siblingDetector("false") }), []);
  assert.equal(quiet.status, 0, `the silent fifth detector changed the verdict:\n${quiet.said}`);
  assert.match(quiet.said, /control: 4 finding\(s\)/, quiet.said);
  assert.doesNotMatch(quiet.said, /secret/, "the derivation read a sibling module after all");

  // (b) The moment it fires, the second check refuses. So no verdict is ever
  //     PRINTED that leans on a detector the control never proved.
  const loud = runCopy(scratchAudit(wire, { [PROBE_MODULE]: siblingDetector("true") }), []);
  assert.equal(loud.status, 2, `a firing unproven detector was not refused:\n${loud.said}`);
  assert.match(loud.said, /never proved alive: secret/, loud.said);
});

test("a detector MODULE cannot be wired in quietly — the audit's import surface is pinned", () => {
  // The structural half of that fix. A detector living in another module must
  // be IMPORTED into leak-audit.mjs before anything it returns can be joined,
  // and the kind scan cannot see the name it spells. So the imports are pinned:
  // wiring one in is a deliberate act with a red test and a to-do list attached
  // instead of a silent fifth detector shipping unproven.
  //
  // Deliberately EXACT and deliberately hand-typed. A pin derived from the
  // thing it pins agrees with anything, which is the defect that started all of
  // this — see the first corpse in the audit's header.
  assert.deepEqual(
    relativeImports(readFileSync(AUDIT, "utf8")).sort(),
    ["./identity.mjs", "./repo-path.mjs"],
    "leak-audit.mjs imports a local module this pin does not know about. IF IT IS A NEW DETECTOR: the kind " +
      "scan reads leak-audit.mjs alone, so a name spelled in your module is invisible to it. (1) Write the " +
      "literal at the push site in runAudit, the way the identity join does; (2) plant a probe for it in the " +
      "control; (3) add its name and one-line description to the header list. Then add the module here. If it " +
      "is not a detector, add it here and carry on.",
  );

  // The scratch copies are built from the same walk, so the pin and the copy
  // list cannot drift apart — the drift that made a missing file read as a
  // broken kind scan.
  assert.deepEqual(auditModuleClosure().sort(), ["server/lib/identity.mjs", "server/lib/repo-path.mjs"]);
});

test("a kind scan that comes back short stops the audit instead of shrinking it", () => {
  // The failure mode deriving the list introduces. A scan that matched nothing
  // would hand back an empty kind list, the control would be satisfied by
  // reporting nothing, and the audit would print CLEAN having proven not one
  // detector alive — this file's own defect, arriving through the fix for it.
  for (const source of ["", "// a file with no detectors in it at all", 'out.push({ kind: "bom" });'])
    assert.throws(() => declaredKinds(source), VacuousScanError, `a short scan was accepted: ${source}`);
});

test("a broken kind scan refuses through the scrubber, not as a raw stack full of paths", () => {
  // WHY THIS IS A TEST AND NOT A COMMENT: the derivation used to run at module
  // scope, so the refusal above escaped as an unhandled ESM load error before
  // main() existed to catch it. Measured in a scratch clone with one documented
  // kind assembled instead of spelled: Node printed the VacuousScanError plus
  // six stack frames, five of them carrying the absolute path of the audit —
  // the leak audit printing the operator's home directory to a console while
  // refusing, which is the one thing scrubPaths is in the catch to prevent.
  //
  // Proven the only honest way: a COPY of the audit, mutated so its own kind
  // scan comes back short, run as a program in a scratch repo of its own. The
  // modules copied alongside it are DERIVED from the audit's imports — see
  // auditModuleClosure, and the measured trap that hand-typing them used to be.
  const built = scratchAudit((s) => s.replace('{ kind: "bom", where: name', '{ kind: "b" + "om", where: name'));
  const { dir } = built;
  const { status, said } = runCopy(built);
  assert.equal(status, 2, `a broken kind scan did not exit as a refusal:\n${said}`);
  assert.match(said, /the kind scan did not find the documented detector\(s\): bom/);
  assert.equal((said.match(/leak audit: /g) ?? []).length, 1, `the refusal was not the CLI's own message:\n${said}`);
  assert.doesNotMatch(said, /\n\s+at /, `the refusal printed a stack — every frame of one is a path:\n${said}`);
  assert.ok(!said.includes(dir), `the refusal printed its own absolute path:\n${said}`);
});

test("a finding under a kind nothing proved is refused, not printed beside the proven ones", () => {
  // The half a source scan cannot see: a detector whose kind is not a literal
  // beside its key at all — held in a variable, handed in from elsewhere — is
  // invisible to declaredKinds. So the verdict checks again on the way out.
  assert.deepEqual(unprovenKinds([{ kind: "bom" }, { kind: "path" }]), []);
  assert.deepEqual(unprovenKinds([{ kind: "bom" }, { kind: "sec" + "ret" }]), ["secret"]);

  // Wired into the verdict, not merely exported beside it — the same join this
  // file learned to test the hard way. With "identity" dropped from the proven
  // list, the blind check is satisfied by the three that remain and the control's
  // own identity finding is what trips the refusal.
  assert.throws(
    () => runAudit(clean(), LF_ROWS, { kinds: ["bom", "path", "eol"] }),
    (e) => {
      assert.ok(e instanceof VacuousScanError, `wrong error type: ${e}`);
      assert.match(e.message, /never proved alive: identity/);
      return true;
    },
  );
});

test("a control that carries no leak refuses to produce a verdict at all", () => {
  // The mutation this whole design exists for: break the control line and the
  // script must not emit a clean verdict. A scanner that has gone blind reads
  // exactly like a clean repo, which is how the previous shell-based audit
  // reported a planted leak as CLEAN.
  assert.throws(
    () =>
      runAudit(clean(), LF_ROWS, {
        control: { name: CONTROL_NAME, text: "nothing planted here at all", eolRow: `i/lf  w/lf  attr/\t${CONTROL_NAME}` },
      }),
    (e) => {
      assert.ok(e instanceof VacuousScanError, `wrong error type: ${e}`);
      for (const k of controlKinds()) assert.match(e.message, new RegExp(k), `the refusal did not name ${k}`);
      assert.match(e.message, /no verdict is being emitted/);
      return true;
    },
  );
});

test("one dead rule cannot hide behind the other three — the control is per-kind", () => {
  // Measured lesson, inherited from identity.mjs: with a single combined probe
  // a dead rule hides behind a live one that matched the same string. So each
  // kind is dropped from the control in turn and the refusal must name it.
  //
  // eol is dropped differently from the other three because it arrives
  // differently — it is a row git reports about a blob, not a byte in one — but
  // it is dropped, and the refusal must name it just the same.
  const parts = {
    bom: "ï»¿",
    path: ` scandir '${WIN_PATH}' `,
    identity: ` run by ${CONTROL_TOKEN} `,
  };
  for (const dropped of controlKinds()) {
    const control = {
      name: CONTROL_NAME,
      text: controlKinds()
        .filter((k) => k !== dropped && parts[k])
        .map((k) => parts[k])
        .join(""),
      eolRow: dropped === "eol" ? `i/lf  w/lf  attr/\t${CONTROL_NAME}` : CONTROL.eolRow,
    };
    assert.throws(
      () => runAudit(clean(), LF_ROWS, { control }),
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
  assert.throws(() => runAudit([], LF_ROWS), VacuousScanError);
  assert.throws(() => runAudit([{ name: "a", text: "" }, { name: "b", text: null }], LF_ROWS), VacuousScanError);
});

test("a caller that supplies no line-ending rows is refused, not reported clean", () => {
  // Half a sweep is not a clean verdict. Without this, a caller that forgot to
  // fetch the rows checks zero committed blobs and still prints "or CRLF".
  for (const rows of [undefined, "", "\0\0"])
    assert.throws(() => runAudit(clean(), rows), (e) => {
      assert.match(e.message, /not one committed blob was checked/);
      return true;
    });
});

test("a corpus entry cannot impersonate the control and hide behind its findings", () => {
  assert.throws(
    () => runAudit([{ name: CONTROL_NAME, text: "x" }], LF_ROWS),
    (e) => {
      assert.match(e.message, /shadows the control/);
      return true;
    },
  );
});

test("a committed blob cannot impersonate the control either", () => {
  assert.throws(
    () => runAudit(clean(), `i/crlf  w/crlf  attr/\t${CONTROL_NAME}`),
    (e) => {
      assert.match(e.message, /a committed blob is named .* shadows the control/s);
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
  const v = runAudit([{ name: "fixture.json", text: `{"user_id": "${stranger}", "mass": 13.07}` }], LF_ROWS);
  const id = v.findings.filter((f) => f.kind === "identity");
  assert.equal(id.length, 1, `expected one identity finding, got ${JSON.stringify(v.findings)}`);
  assert.equal(id[0].where, "fixture.json");
  assert.ok(!describeFindings(id).includes(stranger), "the finding republished the identifier");
  // A job handle is not a person: the audit must not fire on this repo's own ids.
  assert.deepEqual(runAudit([{ name: "j.json", text: `{"request_id": "${stranger}"}` }], LF_ROWS).findings, []);
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
  const { findings, files } = parseEolRows(gitEolRows());
  assert.deepEqual(findings, [], `committed blobs carry CRLF:\n${describeFindings(findings)}`);
  assert.ok(files >= 200, `expected the whole repo, checked only ${files} blobs`);
});

test("an eol finding reaches the verdict, not just the parser", () => {
  // The wiring, unit-level. parseEolRows and the corpus sweep were both tested
  // in isolation before; the JOIN between them was not, and deleting it left
  // the suite green and the CLI printing "CLEAN — no path, identity, BOM or
  // CRLF finding" while no blob was being checked at all.
  const v = runAudit(clean(), `i/lf    w/lf    attr/\tok.md\0i/crlf  w/crlf  attr/text=auto eol=lf \tbad.md`);
  assert.deepEqual(
    v.findings.map((f) => [f.kind, f.where]),
    [["eol", "bad.md"]],
  );
  assert.equal(v.blobs, 2);
});

// --- the sweep, and the process contract --------------------------------------

test("no tracked file in this repo carries a path, an identity or a BOM", () => {
  const files = trackedFiles();
  const v = runAudit(trackedCorpus(), gitEolRows());
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

// --- the CRLF half, end to end against a repo that actually has one -----------

test("a CRLF blob in the index reaches the EXIT CODE, through the whole program", () => {
  // The only check that proves .gitattributes' policy held, proven the only way
  // it can be: against a repo built to violate it. This repo has no CRLF blob,
  // so every previous assertion about this kind was made against zero examples.
  const bad = runMain(["--quiet"], scratchRepo({ crlf: true }));
  assert.equal(bad.code, 1, `a CRLF blob did not fail the audit:\n${bad.out}\n${bad.err}`);
  assert.match(bad.err, /eol\s+bad\.md/, bad.err);

  // The negative half: the SAME builder without the CRLF file is clean, so the
  // red above is the blob and not "scratch repos are always red".
  const ok = runMain(["--quiet"], scratchRepo());
  assert.equal(ok.code, 0, `a clean scratch repo was reported dirty:\n${ok.out}\n${ok.err}`);
});

test("a brand-new file is NOT swept until it is staged — the docstring's limit, pinned", () => {
  // Measured, not theorised: an untracked file holding a drive-rooted path was
  // swept straight over and this repo reported CLEAN over 235 entries. The
  // corpus is `git ls-files`, so that is correct behaviour — but the comment
  // above trackedFiles used to promise more than that, and a reader who
  // believed it would read a green audit as "this new file is clean".
  const dir = scratchRepo({ untracked: { name: "new.md", text: `see ${WIN_PATH}\n` } });
  const before = runMain(["--quiet"], dir);
  assert.equal(before.code, 0, `an untracked file was swept — the docstring is now the wrong one:\n${before.err}`);

  const add = spawnSync("git", ["add", "new.md"], { cwd: dir, encoding: "utf8" });
  assert.equal(add.status, 0, add.stderr);
  const after = runMain(["--quiet"], dir);
  assert.equal(after.code, 1, "staging the file did not expose the leak in it");
  assert.match(after.err, /path\s+new\.md/, after.err);
});

// --- arguments: nothing is silently ignored -----------------------------------

test("every argument spelling either sweeps or refuses — none is silently ignored", () => {
  assert.deepEqual(parseArgs([]), { bundle: undefined, quiet: false });
  assert.deepEqual(parseArgs(["--quiet"]), { bundle: undefined, quiet: true });
  assert.deepEqual(parseArgs(["--bundle=/x"]), { bundle: "/x", quiet: false });
  assert.deepEqual(parseArgs(["--bundle", "/x", "--quiet"]), { bundle: "/x", quiet: true });

  // Each of these exited 0 CLEAN on the previous revision while a planted leak
  // sat unswept in the bundle they named.
  for (const argv of [
    ["--bundle"], //            $PKG_DIR unset, space form
    ["--bundle="], //           $PKG_DIR unset, equals form
    ["--bundle", "--quiet"], // ditto, with a flag mistaken for the value
    ["--bundel=/x"], //         a typo
    ["-b", "/x"], //            a spelling this program does not have
    ["--bundle=/x", "--bundle=/y"], // two bundles, one of them ignored
  ])
    assert.throws(() => parseArgs(argv), VacuousScanError, `silently ignored: ${JSON.stringify(argv)}`);
});

test("a mangled --bundle exits NON-ZERO instead of reporting the repo clean", () => {
  const run = (args) => spawnSync(process.execPath, [AUDIT, ...args], { encoding: "utf8", cwd: REPO });
  const dir = mkdtempSync(join(tmpdir(), "toolcrib-leak-audit-argv-"));
  mkdirSync(join(dir, "logs"));
  writeFileSync(join(dir, "logs", "apiRun.json"), JSON.stringify({ note: `scandir '${WIN_PATH}'` }));

  // The space form is a spelling humans type, so it is PARSED, not rejected:
  // it finds the same planted leak the equals form finds.
  const spaced = run(["--bundle", dir, "--quiet"]);
  assert.equal(spaced.status, 1, `the space form did not sweep the bundle:\n${spaced.stdout}${spaced.stderr}`);
  assert.match(spaced.stderr, /path\s+bundle:logs\/apiRun\.json/, spaced.stderr);

  for (const args of [["--bundle="], ["--bundel=" + dir], ["--bundle"]]) {
    const r = run([...args, "--quiet"]);
    assert.equal(r.status, 2, `${JSON.stringify(args)} was ignored and the run reported clean: ${r.stdout}${r.stderr}`);
  }
});

test("a refusal is prefixed once, and an internal defect says where it happened", () => {
  const r = spawnSync(process.execPath, [AUDIT, "--bundel=/nope"], { encoding: "utf8", cwd: REPO });
  assert.equal(r.status, 2);
  assert.equal(
    (r.stderr.match(/leak audit: /g) ?? []).length,
    1,
    `the refusal stutters its own prefix, which reads as a formatting bug: ${r.stderr}`,
  );
  assert.doesNotMatch(r.stderr, /INTERNAL ERROR/, "a bad argument is a refusal, not a bug in the audit");
});
