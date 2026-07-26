// One renderer for every filesystem path that escapes into something a human
// reads: ledger reasons, manifest warnings, PDF sections, API responses,
// console lines. Absolute paths are machine identity — the operator's home
// directory and username — and none of those surfaces has any use for them.
// A ledger reason is worse than the rest: it is hashed into the chain, so a
// leak there is sealed into the tamper-evident record and cannot be edited
// out afterwards without breaking the chain.
//
//   displayPath(<abs>/toolcrib/samples/requests/plain-plate.json)
//     -> "samples/requests/plain-plate.json"
//
// (No literal machine root — drive letter, UNC authority or home directory —
// is spelled out anywhere in this file, on purpose. The standing audit for a
// leak sweeps the tracked files for one, and an example that trips that sweep
// teaches the next auditor to wave off their own alarm. Same reason the
// illustration above elides the chain as <abs>. One example below did spell a
// UNC authority out longhand, and it was the single hit COMMITTED_PATH found
// across all 232 tracked files; it now reads "<host>\<share>".)
//
// Two rules, no configuration:
//
//   inside the repo   -> the repo-relative path, POSIX separators. Reproducible
//                        across machines and platforms: the same demo prints
//                        the same string on Windows and Linux.
//   outside the repo  -> "<outside-repo>/<basename>".
//
// Why keep the basename outside the repo rather than dropping the path
// entirely: the private part of a path is its DIRECTORY CHAIN — the home
// directory that names the machine and the human. The leaf is a name the
// caller chose for this run: a jobId, a uuid request file, a fixture file. It
// carries no machine identity, it keeps the line diagnostically useful, and it
// keeps outside-repo renderings distinct from one another — which the API's
// create route depends on, since it finds its new job by matching the exact
// reason string that names its own uuid request file. The "<outside-repo>"
// marker is angle-bracketed precisely so no reader mistakes the result for a
// real path they could open.

import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

/** Opaque stand-in for any directory chain that is not the repo. */
export const OUTSIDE_REPO = "<outside-repo>";

/** "<outside-repo>/<leaf>", or the bare marker when there is no leaf (a root). */
const outside = (abs) => {
  const leaf = basename(abs);
  return leaf ? `${OUTSIDE_REPO}/${leaf}` : OUTSIDE_REPO;
};

/**
 * Render a path for human eyes without naming the machine it ran on.
 * @param {string} p            absolute or cwd-relative path
 * @param {{repoRoot?: string}} [opts] repo root override (tests)
 * @returns {string} repo-relative POSIX path, "." for the root itself, or
 *                   "<outside-repo>/<basename>"
 */
export function displayPath(p, { repoRoot = REPO } = {}) {
  if (typeof p !== "string" || p.length === 0) return OUTSIDE_REPO;
  const abs = resolve(p);
  const rel = relative(resolve(repoRoot), abs);
  if (rel === "") return ".";
  // relative() is case-insensitive on win32, so drive-letter casing between
  // import.meta.url and process.cwd() cannot fake an escape.
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep)) return outside(abs);
  return rel.split(sep).join("/");
}

// --- what a machine-rooted path looks like ---------------------------------
//
// One vocabulary, defined once and used twice: scrubPaths rewrites these
// shapes OUT of a message, and MACHINE_PATH detects them so the suites can
// assert none survived. It lives here, beside the function under test, because
// three hand-copied detectors in three suites is exactly how a hole opens in
// one and not the others — which is what had happened: the copies in
// api.test.mjs and pipeline.test.mjs looked only for a drive letter or a home
// root, so a leaked "/root/<user>/part.stl" passed all three green.
//
// Coupling the detector to the scrubber has one honest consequence: a shape
// missing from this vocabulary is invisible to BOTH. That is the trade taken
// deliberately — a gap is then one edit to close instead of four, and the gap
// is visible in one place. It is NOT a claim that these are the only shapes an
// absolute path can take.
//
// The POSIX side is an allowlist of roots rather than "any leading slash",
// because a bare "/" would eat route names and URL paths ("no route: GET
// /api/jobs") that name no machine. The list is the largest set that can be
// matched without swallowing strings that are not paths at all: the two home
// roots, the system roots a temp/service dir hangs off, plus the mount roots
// under which another platform's home tree appears — WSL mounts the Windows
// drives under /mnt, macOS mounts volumes under /Volumes, and a home directory
// reached that way names the human just as loudly.
const POSIX_ROOTS = "home|Users|root|tmp|var|private|mnt|media|Volumes|opt|srv";

// A drive letter followed by a separator. The lookbehind keeps a URL scheme
// ("https:") from being read as one, and lets a file:// stack frame through
// ("file:///<drive>:/…" — the char before the drive letter is a slash).
const DRIVE_ROOT = String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]`;
// A UNC authority: two backslashes, a host, a separator. displayPath already
// rendered these correctly; only the matcher was blind to them.
const UNC_ROOT = String.raw`\\\\[^\\/\s"'\`<>|]+[\\/]`;
// The lookbehind stops a match from starting mid-token, so "example.com/var/log"
// inside a URL is not treated as a path. A colon or a hyphen does NOT stop it,
// though an earlier version made both stop it: key:value is a shape this
// codebase uses constantly ("dataDir:" plus a home root) and a stack frame is
// the "file:" scheme plus one, so suppressing after a colon was a hole, not a
// feature.
const POSIX_ROOT = String.raw`(?<![\w.\\/])\/(?:${POSIX_ROOTS})\/`;

const ROOTS = [DRIVE_ROOT, UNC_ROOT, POSIX_ROOT];
const ANY_ROOT = ROOTS.join("|");

/**
 * Does this text still name a machine-rooted path? The inverse of scrubPaths,
 * for tests that scan a payload, a bundle file or a ledger reason. Non-global
 * on purpose: a /g regex carries lastIndex between .test() calls.
 */
export const MACHINE_PATH = new RegExp(ANY_ROOT);

// --- the same question, asked of a COMMITTED FILE instead of a message ------
//
// MACHINE_PATH answers "does this MESSAGE still name a machine?". It runs over
// one line this process is about to print, where a false positive costs
// nothing: the scrubber rewrites the run and the line stays readable.
//
// COMMITTED_PATH answers a different question — "does this tracked FILE
// contain a path that names the machine it was written on?" — and there a
// false positive costs everything, because an audit that fires on the repo's
// own fixtures is an audit somebody switches off. It is used by
// server/lib/leak-audit.mjs, which sweeps every tracked file.
//
// Measured over all 232 tracked files at HEAD: MACHINE_PATH produces 31 hits,
// and every one of them is a legitimate comment or fixture in the three files
// whose job is to define and test the scrubber — a `/tmp/toolcrib-x/…` temp
// dir in a displayPath case, a `"/root/"` entry in a list of roots, the source
// of UNC_ROOT itself. None names a human or a machine. So the committed-file
// vocabulary is the HOME-ROOTED subset:
//
//   drive root     a drive letter, a separator, and a real path segment.
//   UNC authority  two backslashes, a host, a separator, a share — but only
//                  where the pair does not continue a word, so the escaped
//                  `Users\\someone` inside a JS string fixture is not read as
//                  a network share.
//   home root      the two POSIX roots that name a PERSON. tmp, var, opt, srv,
//                  media, private and root are deliberately absent: they are
//                  machine-rooted but they name nobody, they appear as
//                  literals in this repo's own fixtures, and the WSL and macOS
//                  mount forms are already caught by the home root sitting
//                  inside them.
//
// That is a narrower claim than MACHINE_PATH's, stated rather than hidden: a
// tracked file holding "/var/tmp/scratch" passes this audit. It names no
// machine. A tracked file holding a home directory does not.
//
// --- escaping, which is how the previous audit was fooled -------------------
//
// A Windows path that has been JSON-stringified once carries two separators
// where it carried one, and twice (a PDF content stream, a record stringified
// into a message that is itself stringified) carries four. The first draft of
// this vocabulary accepted exactly one, and measurably read a once-escaped
// drive path as clean — the same class of miss as the shell-quoting failure
// that started all this. So SEP accepts a run.
//
// The UNC rule pays for that generosity with a stricter lookbehind. Its
// authority is itself a run of backslashes, so "up to four" and "starts
// anywhere" together would read the ESCAPED fixture `Users\\someone\\tmp` in
// a JS string as a share called "someone" — and that fixture is exactly what
// repo-path.test.mjs and leak-audit.test.mjs are full of. Requiring the run to
// begin at something that is neither alphanumeric nor a backslash keeps a real
// authority (which follows a quote, a space or a line start) and drops a
// mid-token escape (which follows a letter, and whose later backslashes follow
// a backslash). Both directions are pinned in server/lib/leak-audit.test.mjs.
//
// Percent-encoding DOES hide all three ("file:///C%3A/Users/…"), and that is
// not covered — said out loud rather than left for the next auditor to find.
const PATH_SEG = String.raw`[A-Za-z0-9._$~-]`;
const SEP = String.raw`[\\/]{1,4}`;
const COMMITTED_DRIVE = String.raw`(?<![A-Za-z0-9])[A-Za-z]:${SEP}${PATH_SEG}`;
const COMMITTED_UNC = String.raw`(?<![A-Za-z0-9\\])\\{2,4}${PATH_SEG}+${SEP}${PATH_SEG}`;
// No lookbehind on the home rule, unlike POSIX_ROOT above, and the difference
// is deliberate. POSIX_ROOT has to tolerate prose and URLs because it matches
// eleven roots including /var and /tmp, so "example.com/var/log" would be a
// false positive. This rule matches exactly the two roots that name a PERSON,
// and suppressing it after a word character cost more than it saved: it went
// blind to the WSL and macOS mount forms — /mnt/c/Users/<name> and
// /Volumes/<disk>/Users/<name> — where the home root is preceded by the mount
// segment. Measured over all 234 tracked files with the lookbehind removed: 0
// hits. A docs link to a URL path literally named /Users/ would now make a
// human look, which for a leak audit is the correct default.
const COMMITTED_HOME = String.raw`\/(?:home|Users)\/${PATH_SEG}`;

/** Vocabulary source, so a caller can build the /g copy a sweep needs. */
export const COMMITTED_PATH_SOURCE = [COMMITTED_DRIVE, COMMITTED_UNC, COMMITTED_HOME].join("|");

/** Non-global on purpose: a /g regex carries lastIndex between .test() calls. */
export const COMMITTED_PATH = new RegExp(COMMITTED_PATH_SOURCE);

// displayPath covers the paths this codebase interpolates itself. It cannot
// cover the other way a path reaches a judge: a message we did not author,
// forwarded verbatim. Node's fs errors embed the absolute path they failed on
// ("ENOENT: no such file or directory, scandir '<abs>/data/jobs'"), and those
// messages flow into API error bodies, ledger reasons and the CLI's crash
// line. scrubPaths rewrites every absolute-looking run inside such a message
// through displayPath, so the line stays diagnostic ("...scandir
// '<outside-repo>/jobs'") instead of being blanked to a useless generic error.
//
// Where a run ENDS is the subtle half, because a path may legally contain a
// space and a Windows profile directory is named after a human with two names
// ("<drive>:\Users\John Doe\…"). Ending the run at the first space rewrote the
// prefix and emitted every segment after it verbatim — the half of the chain
// that carries the name — and the leftover has no drive letter and no home
// root, so no leak detector in this repo called it out.
//
// Two passes, because there are two ways a path is framed:
//
//   quoted    — how Node frames it in every fs error ("scandir '<path>'").
//               The closing quote is an unambiguous delimiter, so the whole
//               path is taken, spaces and all, with no risk of swallowing the
//               prose around it. This is the channel the measured leaks used.
//   unquoted  — whitespace-delimited, extended across a space when the token
//               after it still looks like path ("…\John Doe\x.json"). The
//               lookahead is one token deep on purpose: reaching further means
//               "open <path> and see /tmp/notes" joins into one run and the
//               prose between them is replaced along with the paths.
//
// The residue is an unquoted path with two adjacent space-separated segments
// ("…\Jean Van Doe\x"): the run stops at "Jean". Stated rather than hidden —
// every message measured to leak was quoted, and both fs errors and the
// file:// frames in a stack (which percent-encode their spaces) stay covered.
const PATH_CHAR = String.raw`[^\s"'\`<>|]`;
const RUN_TAIL = String.raw`(?:${PATH_CHAR}| (?=${PATH_CHAR}*[\\/]))*`;
const QUOTED_RUN = new RegExp(String.raw`(['"\`])((?:${ANY_ROOT})[^'"\`\r\n]*)\1`, "g");
const ABSOLUTE_RUN = new RegExp(ROOTS.map((root) => root + RUN_TAIL).join("|"), "g");

/** Windows-rooted: a drive letter, or a UNC authority. */
const WINDOWS_ROOTED = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/**
 * Rewrite every absolute filesystem path inside an arbitrary message.
 * Messages we author are untouched — they contain no absolute paths.
 * @param {unknown} text  message from anywhere, including Node itself
 * @param {{repoRoot?: string}} [opts] repo root override (tests)
 * @returns {string} the same message with each path run rendered by displayPath
 */
export function scrubPaths(text, opts = {}) {
  const s = typeof text === "string" ? text : String(text ?? "");
  const render = (run) => {
    // A Windows-rooted run belongs to a platform this process may not be on,
    // and displayPath assumes the path belongs to the platform it runs on:
    // off win32, resolve() would treat a drive-letter or UNC path as one long
    // relative filename and hand it straight back, leaking what this function
    // exists to remove. Reduce here instead, to the same "<outside-repo>/<leaf>"
    // win32 would produce — the guarantee holds on every platform, whichever
    // platform wrote the message.
    if (sep !== "\\" && WINDOWS_ROOTED.test(run)) {
      const segs = run.split(/[\\/]/).filter(Boolean);
      // Drop the drive, or the whole "<host>\<share>" authority: a host name
      // is machine identity too.
      const chain = segs.slice(run.startsWith("\\\\") ? 2 : 1);
      return chain.length ? `${OUTSIDE_REPO}/${chain.at(-1)}` : OUTSIDE_REPO;
    }
    return displayPath(run, opts);
  };
  // Quoted first: its delimiter is exact, and what it leaves behind can no
  // longer look like a root, so the unquoted pass runs over a shorter string
  // and cannot re-enter what was already replaced.
  return s
    .replace(QUOTED_RUN, (_m, quote, inner) => `${quote}${render(inner)}${quote}`)
    .replace(ABSOLUTE_RUN, render);
}
