#!/usr/bin/env node
// The leak audit, as a program instead of folklore.
//
//   node server/lib/leak-audit.mjs [--bundle=<dir> | --bundle <dir>] [--quiet]
//
// Any other argument is a refusal, not a shrug — see parseArgs.
//
// It sweeps every file git TRACKS (and, given --bundle, every file in a
// generated job bundle) for four things a judge must never receive. The list is
// CONTROL_KINDS, and it is NOT TYPED — it is read out of this file's own source
// by declaredKinds(), which is the whole reason "exhaustive" is a fact here and
// not a wish. Every kind it finds must be planted in the control and come back
// reported before any verdict is emitted, so a fifth detector added below grows
// CONTROL_KINDS on the next import, finds no fifth probe waiting for it, and
// makes the audit REFUSE — suite red, CLI red — rather than ship unproven.
//
// That paragraph used to make exactly this promise while nothing enforced it.
// CONTROL_KINDS was a hand-typed array, and the test that "pinned" it built its
// expected set by hand too — two literal probes plus a hardcoded "identity" — so
// it could only ever fail in the reverse direction. Measured before the fix: a
// fifth detector was added to shapeFindings with CONTROL_KINDS left alone, and
// the suite stayed at 27 pass / 0 fail while the CLI printed its four-kind
// control line and then CLEAN at exit 0. A guard whose own header is wrong is
// worse than no guard, because it is believed.
//
// The scan reads kinds spelled as string literals, which is how all four below
// are written and how a fifth would be. A kind ASSEMBLED at runtime is invisible
// to it, so runAudit checks a second time on the way out: a finding carrying a
// kind that is not in CONTROL_KINDS is a refusal, not a finding. That half is
// caught when the detector first fires rather than at import — said plainly
// because it is the honest residual, not because it is comfortable.
//
//   path      an absolute filesystem path that names the machine this was
//             written on — a drive-rooted path, a UNC share, a home directory.
//             DELIBERATELY NARROWER than repo-path.mjs's MACHINE_PATH: only the
//             roots that name a PERSON. A tracked "/var/tmp/scratch" passes.
//             The trade is measured and argued at repo-path.mjs:117-186.
//   identity  an account identifier — the operator's Zoo account or email by
//             fingerprint, or any uuid sitting in a field whose NAME means
//             "account".
//   bom       a UTF-8 byte-order mark at the head of a file.
//   eol       CRLF or mixed line endings in a COMMITTED BLOB — the regression
//             .gitattributes exists to prevent and cannot itself detect.
//
// --- why this is a program and not a shell one-liner ------------------------
//
// This audit used to be a `git ls-files | xargs grep -E …` typed at a prompt,
// and it was SILENTLY BROKEN by shell quoting: git-bash ate one backslash, the
// drive-letter pattern reached grep as an escaped brace, and a control file
// containing a real planted leak was reported CLEAN. It was caught only
// because somebody thought to plant the control. Two other agents hit the same
// class of shell-mangling the same day.
//
// So: no shell layer. The pattern is a JS regex compiled from source in
// server/lib/repo-path.mjs, the file list comes from spawnSync("git", [...])
// with an argv array that no shell ever parses, and the whole thing is tracked
// and tested. A pattern that mangles now mangles in a test run too.
//
// --- why there is a control -------------------------------------------------
//
// A scanner's characteristic failure is not a false negative on a clever
// input. It is passing over nothing at all and printing "clean": a glob that
// matched no files, a pattern that got eaten, a walk of a directory that was
// never created. Every one of those reads exactly like a clean repo.
//
// So a synthetic entry carrying a planted leak of EVERY kind is prepended to
// the corpus, travels the identical code path, and must come back reported.
// If it does not, the audit throws instead of returning — a scanner that
// cannot see a planted leak has not proven anything about the leaks it did not
// see. One probe per kind, not one probe: with a single combined probe, a dead
// path rule hides behind a live identity rule on the same string.
//
// --- one scanner, not two ---------------------------------------------------
//
// The identity half is not reimplemented here. It calls scanIdentity() in
// server/lib/identity.mjs — the same fingerprint map, the same shape rule, the
// same selfTest — so there is exactly one identity vocabulary in this repo and
// a gap in it is one edit to close. Same for the path half: the vocabulary is
// COMMITTED_PATH, exported from server/lib/repo-path.mjs beside the scrubber
// it belongs to. This file owns the corpus, the control and the verdict; it
// owns no vocabulary of its own.

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COMMITTED_PATH_SOURCE, scrubPaths } from "./repo-path.mjs";
import { scanIdentity, describeHits, VacuousScanError, CONTROL_TOKEN } from "./identity.mjs";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));

// Files are read as latin1 so binaries (stl, png, gltf, step, pdf) are swept as
// bytes rather than skipped. A sweep that silently drops the unreadable half of
// the repo is the vacuous verdict this whole file exists to refuse.
const ENCODING = "latin1";

// A UTF-8 BOM, as those three bytes look once a file is read as latin1.
// Written as escapes rather than pasted, so this file neither begins with one
// nor carries a pastable literal of one.
const BOM = "\u00EF\u00BB\u00BF";

// --- the control -------------------------------------------------------------

/** The name the planted case is reported under. No git path can collide with it. */
export const CONTROL_NAME = "<control — planted, not a file in this repo>";

// Assembled from pieces, never spelled. This file is tracked, so it is inside
// the corpus its own sweep reads: a literal machine path here would flag its
// own scaffolding, turn the audit permanently red, and get the audit deleted.
// Same reason identity.mjs assembles CONTROL_TOKEN, which is reused verbatim
// here so the identity probe travels the real fingerprint map.
const CONTROL_PATH = ["C", ":", "\\", "Users", "\\", "not-a-real-person", "\\", "toolcrib", "\\", "part.stl"].join("");

/** The planted case: one leak of every kind the audit claims to detect. */
export const CONTROL_TEXT = `${BOM}planted: scandir '${CONTROL_PATH}' on a run by ${CONTROL_TOKEN}`;

// The eol probe cannot ride in CONTROL_TEXT, because a committed blob's line
// endings are not a property of its bytes on disk — they are what git recorded,
// and they arrive as a row of `git ls-files --eol` rather than as content. So
// the control carries a synthetic ROW instead, in the exact shape git emits,
// and it is prepended to the real rows and parsed by the same parser. That is
// what makes "eol" a kind the control covers rather than a check bolted on
// beside the verdict: the mutation that drops the eol findings from the joined
// list also drops the control's, and the audit refuses instead of printing
// CLEAN. (Measured on the previous revision, where the join sat outside the
// control: deleting `...eol.findings` left npm test at 178 pass / 0 fail and
// the CLI still printed "CLEAN — no path, identity, BOM or CRLF finding".)
const CONTROL_EOL_ROW = `i/crlf  w/crlf  attr/\t${CONTROL_NAME}`;

/** The planted case in full. Injectable ONLY so a test can prove a broken one refuses. */
export const CONTROL = { name: CONTROL_NAME, text: CONTROL_TEXT, eolRow: CONTROL_EOL_ROW };

// --- the kind vocabulary, derived rather than declared -------------------------

/** This file, as a path, so it can be read as text. See declaredKinds. */
const SOURCE = fileURLToPath(import.meta.url);

// The shape a finding's kind is written in. Deliberately the ORDINARY spelling
// rather than a marker comment: a marker only works if whoever adds the fifth
// detector remembers to add the marker, which is the same forgetting this is
// meant to survive. (It does not match its own definition — after the colon
// comes a backslash, not a quote — so scanning this file does not invent a
// kind out of the scanner.)
const KIND_LITERAL = /\bkind:\s*"([a-z][a-z-]*)"/g;

/**
 * The four kinds the header documents. A FLOOR, not the list.
 *
 * Without it, the derivation has a failure mode of exactly the sort this file
 * exists to refuse: a scan that matched NOTHING would hand back an empty
 * CONTROL_KINDS, the control would be trivially satisfied by reporting nothing,
 * and the audit would print CLEAN having proven not one detector alive. So a
 * derived list that has lost a documented kind is a refusal at import.
 */
const DOCUMENTED_KINDS = ["bom", "path", "identity", "eol"];

/**
 * Every kind this file constructs, read out of this file's own source.
 *
 * @param {string} [source] defaulted to this module's text. Injectable ONLY so a
 *        test can prove what a source with a fifth detector — or with none —
 *        does, which cannot be shown by editing the real one.
 * @returns {string[]} in source order, deduplicated
 */
export function declaredKinds(source = readFileSync(SOURCE, "utf8")) {
  const found = [...new Set([...String(source).matchAll(KIND_LITERAL)].map((m) => m[1]))];
  const lost = DOCUMENTED_KINDS.filter((k) => !found.includes(k));
  if (lost.length)
    throw new VacuousScanError(
      `the kind scan did not find the documented detector(s): ${lost.join(", ")} ` +
        `(it found ${found.length ? found.join(", ") : "nothing at all"}). ` +
        `CONTROL_KINDS is derived from this file's source, so a scan that comes back short ` +
        `does not shrink the audit — it stops it, because a control with fewer probes than ` +
        `there are detectors is a control that proves less than it appears to.`,
    );
  return found;
}

/**
 * Every kind the audit detects — and therefore every kind the control must come
 * back with before a clean verdict is legal. Exhaustive BY CONSTRUCTION, in the
 * literal sense: nobody types this list, so nobody can forget to extend it.
 */
export const CONTROL_KINDS = declaredKinds();

/**
 * The kinds among `findings` that CONTROL_KINDS never proved alive.
 *
 * The second half of the guarantee, for the case the source scan cannot see: a
 * detector that assembles its kind instead of spelling it. Split out as its own
 * function so a test can hand it a finding of a kind that does not exist, which
 * is not something the real detectors can be made to produce.
 */
export const unprovenKinds = (findings, kinds = CONTROL_KINDS) => [
  ...new Set(findings.map((f) => f.kind).filter((k) => !kinds.includes(k))),
];

// --- corpus ------------------------------------------------------------------

/**
 * Every path git tracks. Not HEAD's trees — the INDEX — and the bytes swept are
 * the ones on disk right now.
 *
 * WHAT THAT DOES AND DOES NOT COVER, stated precisely, because an earlier
 * version of this comment claimed the broader half of it:
 *
 *   an EDIT to a tracked file      caught before it is committed, staged or
 *                                  not, because the bytes read are the working
 *                                  tree's. Already earned: a `git checkout --`
 *                                  of an unstaged fixture silently restored a
 *                                  real account uuid during development and the
 *                                  sweep went red on the next run.
 *   a BRAND-NEW file               NOT caught until `git add`. It is not in the
 *                                  index, so `git ls-files` does not list it and
 *                                  nothing here reads it. Measured: an untracked
 *                                  file holding a drive-rooted path was swept
 *                                  straight over and the audit reported CLEAN
 *                                  over 235 entries. Pinned by a test.
 *
 * So the promise is narrower than "it stops a bad commit": it stops a bad commit
 * to a file git already knows about, and it catches a NEW file's leak from the
 * moment that file is staged — still before the commit, but only if the audit
 * runs between `git add` and `git commit`.
 *
 * Gitignored files are excluded, so a stale local demo bundle under
 * server/pipeline/data/ cannot turn the audit red over something no judge will
 * ever see. Pass --bundle to sweep one of those on purpose.
 *
 * spawnSync with an argv array: no shell, so nothing here can be re-parsed by
 * one. If git is absent the audit refuses rather than reporting a corpus it
 * could not list.
 */
export function trackedFiles(repoRoot = REPO) {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0)
    throw new VacuousScanError(
      `git ls-files failed (${r.error?.code ?? `exit ${r.status}`}) — ` +
        `the sweep cannot verify what it cannot list.\n${r.stderr ?? ""}`,
    );
  return r.stdout.split("\0").filter(Boolean);
}

/**
 * Read one tracked file, saying what happened in this guard's own words.
 * A bare ENOENT from readFileSync names neither the guard nor the reason, and
 * prints an absolute machine path into the output while doing it — which reads
 * as "the leak test is flaky", step one toward deleting a leak test.
 */
export function readTracked(f, repoRoot = REPO) {
  try {
    return readFileSync(join(repoRoot, f), ENCODING);
  } catch (e) {
    throw new VacuousScanError(
      `could not read the tracked file ${f} (${e.code ?? e.message}). ` +
        `This is not a leak and not a flaky test: a path git tracks is missing from the working tree. ` +
        `Restore it (\`git checkout -- ${f}\`) or stage its deletion, then re-run.`,
    );
  }
}

/** The working-tree contents of every tracked path. */
export const trackedCorpus = (repoRoot = REPO) =>
  trackedFiles(repoRoot).map((f) => ({ name: f, text: readTracked(f, repoRoot) }));

/** Every file under dir, recursively, absolute. */
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** Every file in a generated bundle, named relative to it with POSIX separators. */
export function bundleCorpus(dir) {
  const files = walk(dir);
  if (files.length === 0)
    throw new VacuousScanError(`--bundle pointed at an empty directory — a sweep of nothing is not clean`);
  return files.map((abs) => ({
    name: `bundle:${relative(dir, abs).split(sep).join("/")}`,
    text: readFileSync(abs, ENCODING),
  }));
}

// --- detectors ---------------------------------------------------------------

// Built per call: a /g regex carries lastIndex between calls, and a shared one
// would start the next file's scan wherever the previous file's last hit ended
// — the "every other leak is invisible" bug, which reads as clean.
const committedPathRe = () => new RegExp(COMMITTED_PATH_SOURCE, "g");

/** 1-indexed line of a character offset, so a finding says where to look. */
const lineOf = (s, index) => {
  let n = 1;
  for (let i = 0; i < index; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
};

/**
 * Path and BOM findings for one entry.
 *
 * A finding names the FILE and the LINE and the root shape — never the chain.
 * The directory chain is the private part: it is the operator's home directory
 * and username, and a red audit log on a public repo would be one more place
 * it lives. `${file}:${line}` is enough to open it; identity.mjs makes the same
 * trade for the same reason.
 */
export function shapeFindings(name, text) {
  const s = typeof text === "string" ? text : String(text ?? "");
  const out = [];
  if (s.startsWith(BOM))
    out.push({ kind: "bom", where: name, line: 1, detail: "begins with a UTF-8 byte-order mark" });
  for (const m of s.matchAll(committedPathRe()))
    out.push({
      kind: "path",
      where: name,
      line: lineOf(s, m.index),
      detail: `an absolute path rooted at "${m[0].slice(0, 3)}…" names the machine this was written on`,
    });
  return out;
}

/**
 * The raw `git ls-files --eol -z` output, unparsed.
 *
 * Split from the parsing on purpose: the control's synthetic row has to be
 * prepended to these rows and go through the same parser, so the fetch has to
 * hand back rows rather than a verdict.
 *
 * Asked of git rather than of the working tree, also on purpose: core.autocrlf
 * is true on the build machine, so the working tree legitimately holds CRLF for
 * text files while the committed blob holds LF. The blob is what a judge
 * clones, so the blob is what is checked.
 */
export function gitEolRows(repoRoot = REPO) {
  const r = spawnSync("git", ["ls-files", "--eol", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0)
    throw new VacuousScanError(
      `git ls-files --eol failed (${r.error?.code ?? `exit ${r.status}`}) — ` +
        `the committed line endings cannot be verified.\n${r.stderr ?? ""}`,
    );
  return r.stdout;
}

/**
 * The NUL-separated rows of `git ls-files --eol -z`, split out so the parser is
 * testable without a repo in a particular state.
 *
 * A row reads "i/lf    w/crlf  attr/<attributes>\t<path>". The TAB is the only
 * delimiter that survives, because once .gitattributes exists the attributes
 * column carries spaces of its own ("attr/text=auto eol=lf") — a whitespace
 * split reads the path as "eol=lf" and reports a clean repo forever after.
 * An unparseable row throws rather than being skipped: a skipped row is a file
 * nobody checked, reported as checked.
 */
export function parseEolRows(stdout) {
  const rows = String(stdout).split("\0").filter(Boolean);
  if (rows.length === 0) throw new VacuousScanError("git listed no files for the line-ending check");
  const out = [];
  for (const row of rows) {
    const m = /^i\/(\S+)\s+w\/\S+\s+attr\/[^\t]*\t([\s\S]*)$/.exec(row);
    if (!m) throw new VacuousScanError(`could not parse a git ls-files --eol row: ${JSON.stringify(row)}`);
    const [, indexEol, path] = m;
    if (indexEol === "crlf" || indexEol === "mixed")
      out.push({
        kind: "eol",
        where: path,
        line: 1,
        detail: `the committed blob has ${indexEol.toUpperCase()} line endings — .gitattributes says every text blob is LF`,
      });
  }
  return { findings: out, files: rows.length };
}

// --- the verdict -------------------------------------------------------------

/**
 * Sweep a corpus AND the committed line endings, or refuse to give a verdict.
 *
 * Both halves are joined HERE, inside the control's reach, rather than by the
 * caller. That placement is the guard: the control contributes a finding of
 * every kind to this one list, so a refactor that drops a finding SOURCE from
 * the join drops the control's evidence with it and the audit refuses. When the
 * join lived in main() instead, deleting the eol half was invisible — npm test
 * 178 pass / 0 fail, exit 0, and a verdict line that still said "or CRLF".
 *
 * Fails closed seven ways before any caller sees an empty findings list:
 *
 *   empty corpus    -> throw. Zero entries is not zero leaks.
 *   no eol rows     -> throw. A caller that forgot to fetch them checked no
 *                      committed blob, and would report it as checked.
 *   zero bytes      -> throw. Entries that all read empty are the same lie.
 *   name collision  -> throw. A corpus entry calling itself the control could
 *                      hide behind the control's own findings.
 *   row collision   -> throw. So could a committed blob.
 *   control missed  -> throw, naming the kind that went blind. scanIdentity()
 *                      additionally runs its own selfTest over the same regexes
 *                      and digest map before it will report anything.
 *   unproven kind   -> throw, naming it. A finding of a kind the control never
 *                      demonstrated is a finding from a detector nothing tested;
 *                      reporting it beside four proven ones lends it a
 *                      credibility no probe ever earned it.
 *
 * @param {Iterable<{name: string, text: unknown}>} entries
 * @param {string} eolRows raw `git ls-files --eol -z` output (see gitEolRows)
 * @param {{control?: {name: string, text: string, eolRow: string}, kinds?: string[]}} [opts]
 *        both are injectable ONLY so the test suite can prove what a broken one
 *        does — a control carrying no leak, and a kind list that does not cover
 *        the findings. The defaults are the real planted case and the real
 *        derived vocabulary; nothing in production passes either.
 * @returns {{entries: number, bytes: number, blobs: number, control: Array, findings: Array}}
 */
export function runAudit(entries, eolRows, { control = CONTROL, kinds = CONTROL_KINDS } = {}) {
  const corpus = [...entries];
  if (corpus.length === 0) throw new VacuousScanError("empty corpus — a sweep of nothing is not a clean verdict");
  for (const e of corpus)
    if (e.name === control.name)
      throw new VacuousScanError(`a corpus entry is named ${control.name}, which shadows the control`);

  const realRows = String(eolRows ?? "").split("\0").filter(Boolean);
  if (realRows.length === 0)
    throw new VacuousScanError(
      "no `git ls-files --eol` rows were supplied, so not one committed blob was checked for CRLF — " +
        "and the committed blobs are what a judge clones",
    );
  for (const row of realRows)
    if (row.endsWith(`\t${control.name}`))
      throw new VacuousScanError(`a committed blob is named ${control.name}, which shadows the control`);

  // Counted over the corpus alone: the control's own bytes prove nothing about
  // whether the corpus was read.
  const bytes = corpus.reduce((n, e) => n + String(e.text ?? "").length, 0);
  if (bytes === 0)
    throw new VacuousScanError(`${corpus.length} entries and not one byte of content — nothing was read`);

  const all = [control, ...corpus];
  const findings = all.flatMap((e) => shapeFindings(e.name, e.text));

  // One identity scanner for the whole repo, called — not copied. It runs its
  // own selfTest and refuses a vacuous corpus before returning.
  for (const h of scanIdentity(all).hits)
    findings.push({ kind: "identity", where: h.where, line: 0, detail: describeHits([h]) });

  // The control's row goes through the real parser, ahead of the real rows.
  findings.push(...parseEolRows([control.eolRow, ...realRows].join("\0")).findings);

  const controlFindings = findings.filter((f) => f.where === control.name);
  const seen = new Set(controlFindings.map((f) => f.kind));
  const blind = kinds.filter((k) => !seen.has(k));
  if (blind.length)
    throw new VacuousScanError(
      `the control was NOT reported for: ${blind.join(", ")}. ` +
        `A scanner that cannot see a planted leak has proven nothing about the leaks it did not report, ` +
        `so no verdict is being emitted. Fix the detector (or the control) before believing any sweep.`,
    );

  const unproven = unprovenKinds(findings, kinds);
  if (unproven.length)
    throw new VacuousScanError(
      `a finding was reported under a kind the control never proved alive: ${unproven.join(", ")}. ` +
        `CONTROL_KINDS is derived from this file's own source, so a kind missing from it belongs to a ` +
        `detector that assembles its kind rather than spelling it. Spell it, and plant a probe for it ` +
        `in the control, so it is proven like the other ${kinds.length} before anything it says is believed.`,
    );

  return {
    entries: corpus.length,
    bytes,
    blobs: realRows.length,
    control: controlFindings,
    findings: findings.filter((f) => f.where !== control.name),
  };
}

/**
 * One line per finding, for output that says where to look. An identity
 * finding carries line 0 because its detail — rendered by identity.mjs's own
 * describeHits — already names the file; printing the name twice is how an
 * audit log becomes unreadable and then unread.
 */
export const describeFindings = (findings) =>
  findings.map((f) => `  ${f.kind.padEnd(8)} ${f.line ? `${f.where}:${f.line}  ` : ""}${f.detail}`).join("\n");

// --- CLI ---------------------------------------------------------------------

export const USAGE = "usage: node server/lib/leak-audit.mjs [--bundle=<dir> | --bundle <dir>] [--quiet]";

/**
 * Parse argv, or REFUSE. Nothing is silently ignored.
 *
 * This is the same failure the rest of this file exists to end, one layer out.
 * Measured on the previous revision, whose parser was a lone
 * `argv.find(a => a.startsWith("--bundle="))`, against a bundle holding a
 * planted drive-rooted path:
 *
 *   --bundle=<dir>   exit 1, finding reported   (the only spelling that worked)
 *   --bundle <dir>   exit 0, CLEAN              (the spelling a human types)
 *   --bundle=        exit 0, CLEAN              (an unset $DIR expands to this)
 *   --bundel=<dir>   exit 0, CLEAN              (a typo)
 *
 * Three ways to ask for a sweep, three sweeps that never happened, three green
 * verdicts. So: the space form is PARSED, because it is a spelling humans type
 * and rejecting a reasonable spelling is its own kind of trap; everything else
 * is an error. An argument this program does not understand is an argument that
 * did not do what its author meant, and `--bundle` with nothing usable after it
 * is exactly what a release step produces when an earlier step failed and left
 * $PKG_DIR unset.
 *
 * @returns {{bundle: string|undefined, quiet: boolean}}
 */
export function parseArgs(argv = []) {
  let bundle;
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quiet") {
      quiet = true;
      continue;
    }
    let value;
    if (a.startsWith("--bundle=")) value = a.slice("--bundle=".length);
    else if (a === "--bundle") value = argv[++i];
    else throw new VacuousScanError(`unrecognised argument ${JSON.stringify(a)}. ${USAGE}`);

    if (!value || value.startsWith("--"))
      throw new VacuousScanError(
        `--bundle was given no directory to sweep${value ? ` (got ${JSON.stringify(value)})` : ""}. ` +
          `A bundle sweep that quietly did not happen still exits 0, which is the failure this audit exists to stop. ` +
          USAGE,
      );
    if (bundle !== undefined)
      throw new VacuousScanError(`--bundle was given twice (${bundle}, then ${value}); one bundle is swept per run`);
    bundle = value;
  }
  return { bundle, quiet };
}

/**
 * @param {string[]} argv
 * @param {(s: string) => void} log
 * @param {(s: string) => void} err
 * @param {string} repoRoot which repo to sweep. Threaded rather than fixed so a
 *        test can point the WHOLE program — argv, corpus, git, verdict, exit
 *        code — at a scratch repo built to contain a specific defect. That is
 *        the only honest way to prove a CRLF blob reaches the exit code, since
 *        this repo deliberately does not have one.
 * @returns {number} process exit code
 */
export function main(argv = [], log = console.log, err = console.error, repoRoot = REPO) {
  const { bundle, quiet } = parseArgs(argv);

  const corpus = [...trackedCorpus(repoRoot), ...(bundle ? bundleCorpus(bundle) : [])];
  const verdict = runAudit(corpus, gitEolRows(repoRoot));

  // The control proof is printed BEFORE the verdict, always — including on the
  // clean path. A reader must never see "clean" without seeing, on the line
  // above it, that the scanner demonstrated it can see a leak.
  if (!quiet) {
    log(
      `leak audit control: ${verdict.control.length} finding(s) on the planted case ` +
        `(${CONTROL_KINDS.join(", ")}) — the scanner can see a leak it is shown`,
    );
    log(
      `leak audit corpus:  ${verdict.entries} entries, ${verdict.bytes.toLocaleString("en-US")} bytes` +
        `${bundle ? ` (tracked files + bundle ${bundle})` : " (tracked files)"}; ` +
        `${verdict.blobs} committed blobs checked for CRLF`,
    );
  }

  if (verdict.findings.length) {
    err(
      `leak audit: ${verdict.findings.length} finding(s) — this repo is NOT clean:\n${describeFindings(verdict.findings)}`,
    );
    return 1;
  }
  if (!quiet) log("leak audit: CLEAN — no path, identity, BOM or CRLF finding in the corpus.");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    // A refusal is not a pass. VacuousScanError means the audit declined to
    // give a verdict at all, and that must exit non-zero just as loudly as a
    // finding does.
    //
    // THIS is where the "leak audit: " prefix is added, and it is added exactly
    // once — every message raised inside this module is a plain sentence for
    // that reason. An earlier revision prefixed in both places, so the loudest
    // output this tool produces read "leak audit: leak audit: the control was
    // NOT reported for: bom." — a nudge toward reading the one message designed
    // to stop a human from believing a sweep as a formatting bug instead.
    //
    // A refusal gets its message; anything else is a defect in the audit itself
    // and gets the stack, because "TypeError: x is not a function" with no
    // location is indistinguishable from a deliberate refusal to whoever is
    // staring at a red exit 2.
    //
    // Both are scrubbed on the way out: a bad --bundle argument makes Node
    // raise an ENOENT with the absolute path embedded in it, and every frame of
    // a stack is a path — the tool whose job is to stop paths reaching a
    // console does not get to print one.
    const body = e instanceof VacuousScanError ? e.message : `INTERNAL ERROR — this is a bug in the audit.\n${e.stack}`;
    console.error(`leak audit: ${scrubPaths(body)}`);
    process.exitCode = 2;
  }
}
