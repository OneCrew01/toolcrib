#!/usr/bin/env node
// The leak audit, as a program instead of folklore.
//
//   node server/lib/leak-audit.mjs [--bundle=<dir>] [--quiet]
//
// It sweeps every file git TRACKS (and, given --bundle, every file in a
// generated job bundle) for three things a judge must never receive:
//
//   path      an absolute filesystem path that names the machine this was
//             written on — a drive-rooted path, a UNC share, a home directory.
//   identity  an account identifier — the operator's Zoo account or email by
//             fingerprint, or any uuid sitting in a field whose NAME means
//             "account".
//   bom       a UTF-8 byte-order mark at the head of a file.
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

/** Every kind the control must come back with before a clean verdict is legal. */
export const CONTROL_KINDS = ["bom", "path", "identity"];

// --- corpus ------------------------------------------------------------------

/**
 * Every path git tracks. Not HEAD's trees — the INDEX — and the bytes swept are
 * the ones on disk right now, so a leak written but not yet committed is still
 * caught. That is the only version of this guard that can stop a bad commit
 * instead of reporting one, and it has already earned it: a `git checkout --`
 * of an unstaged fixture silently restored a real account uuid during
 * development, and the sweep went red on the next run.
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
      `leak audit: git ls-files failed (${r.error?.code ?? `exit ${r.status}`}) — ` +
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
      `the leak audit could not read the tracked file ${f} (${e.code ?? e.message}). ` +
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
    throw new VacuousScanError(`leak audit: --bundle pointed at an empty directory — a sweep of nothing is not clean`);
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
 * CRLF that reached the INDEX, which .gitattributes exists to prevent and
 * cannot by itself detect. Asked of git rather than of the working tree on
 * purpose: core.autocrlf is true on the build machine, so the working tree
 * legitimately holds CRLF for text files while the committed blob holds LF.
 * The blob is what a judge clones, so the blob is what is checked.
 */
export function indexEolFindings(repoRoot = REPO) {
  const r = spawnSync("git", ["ls-files", "--eol", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0)
    throw new VacuousScanError(
      `leak audit: git ls-files --eol failed (${r.error?.code ?? `exit ${r.status}`}) — ` +
        `the committed line endings cannot be verified.\n${r.stderr ?? ""}`,
    );
  return parseEolRows(r.stdout);
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
  if (rows.length === 0) throw new VacuousScanError("leak audit: git listed no files for the line-ending check");
  const out = [];
  for (const row of rows) {
    const m = /^i\/(\S+)\s+w\/\S+\s+attr\/[^\t]*\t([\s\S]*)$/.exec(row);
    if (!m) throw new VacuousScanError(`leak audit: could not parse a git ls-files --eol row: ${JSON.stringify(row)}`);
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
 * Sweep a corpus, or refuse to give it a verdict.
 *
 * Fails closed four ways before any caller sees an empty findings list:
 *
 *   empty corpus    -> throw. Zero entries is not zero leaks.
 *   zero bytes      -> throw. Entries that all read empty are the same lie.
 *   name collision  -> throw. An entry calling itself the control could hide
 *                      behind the control's own findings.
 *   control missed  -> throw, naming the kind that went blind. scanIdentity()
 *                      additionally runs its own selfTest over the same regexes
 *                      and digest map before it will report anything.
 *
 * @param {Iterable<{name: string, text: unknown}>} entries
 * @param {{control?: {name: string, text: string}}} [opts] the control is
 *        injectable ONLY so the test suite can prove what a broken one does.
 *        The default is the real planted case; nothing in production passes it.
 * @returns {{entries: number, bytes: number, control: Array, findings: Array}}
 */
export function runAudit(entries, { control = { name: CONTROL_NAME, text: CONTROL_TEXT } } = {}) {
  const corpus = [...entries];
  if (corpus.length === 0)
    throw new VacuousScanError("leak audit: empty corpus — a sweep of nothing is not a clean verdict");
  for (const e of corpus)
    if (e.name === control.name)
      throw new VacuousScanError(`leak audit: a corpus entry is named ${control.name}, which shadows the control`);

  // Counted over the corpus alone: the control's own bytes prove nothing about
  // whether the corpus was read.
  const bytes = corpus.reduce((n, e) => n + String(e.text ?? "").length, 0);
  if (bytes === 0)
    throw new VacuousScanError(`leak audit: ${corpus.length} entries and not one byte of content — nothing was read`);

  const all = [control, ...corpus];
  const findings = all.flatMap((e) => shapeFindings(e.name, e.text));

  // One identity scanner for the whole repo, called — not copied. It runs its
  // own selfTest and refuses a vacuous corpus before returning.
  for (const h of scanIdentity(all).hits)
    findings.push({ kind: "identity", where: h.where, line: 0, detail: describeHits([h]) });

  const controlFindings = findings.filter((f) => f.where === control.name);
  const seen = new Set(controlFindings.map((f) => f.kind));
  const blind = CONTROL_KINDS.filter((k) => !seen.has(k));
  if (blind.length)
    throw new VacuousScanError(
      `leak audit: the control was NOT reported for: ${blind.join(", ")}. ` +
        `A scanner that cannot see a planted leak has proven nothing about the leaks it did not report, ` +
        `so no verdict is being emitted. Fix the detector (or the control) before believing any sweep.`,
    );

  return { entries: corpus.length, bytes, control: controlFindings, findings: findings.filter((f) => f.where !== control.name) };
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

/** @returns {number} process exit code */
export function main(argv = [], log = console.log, err = console.error) {
  const bundle = argv.find((a) => a.startsWith("--bundle="))?.slice("--bundle=".length);
  const quiet = argv.includes("--quiet");

  const corpus = [...trackedCorpus(), ...(bundle ? bundleCorpus(bundle) : [])];
  const verdict = runAudit(corpus);
  const eol = indexEolFindings();
  const findings = [...verdict.findings, ...eol.findings];

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
        `${eol.files} committed blobs checked for CRLF`,
    );
  }

  if (findings.length) {
    err(`leak audit: ${findings.length} finding(s) — this repo is NOT clean:\n${describeFindings(findings)}`);
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
    // finding does. Scrubbed on the way out: a bad --bundle argument makes
    // Node raise an ENOENT with the absolute path embedded in it, and the tool
    // whose job is to stop paths reaching a console does not get to print one.
    console.error(`leak audit: ${scrubPaths(e.message)}`);
    process.exitCode = 2;
  }
}
