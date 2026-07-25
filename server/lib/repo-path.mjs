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
// (No literal drive-letter prefix is spelled out anywhere in this file, on
// purpose. The standing audit for a leak greps the tracked files for one, and
// an example that trips that grep teaches the next auditor to wave off their
// own alarm. Same reason the illustration above elides the chain as <abs>.)
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
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep))
    return `${OUTSIDE_REPO}/${basename(abs)}`;
  return rel.split(sep).join("/");
}

// displayPath covers the paths this codebase interpolates itself. It cannot
// cover the other way a path reaches a judge: a message we did not author,
// forwarded verbatim. Node's fs errors embed the absolute path they failed on
// ("ENOENT: no such file or directory, scandir '<abs>/data/jobs'"), and those
// messages flow straight into API error bodies, which the console renders.
// scrubPaths rewrites every absolute-looking run inside such a message through
// displayPath, so the line stays diagnostic ("...scandir
// '<outside-repo>/jobs'") instead of being replaced by a useless generic error.
//
// Two families are matched, deliberately narrow:
//   drive letters  — a letter, a colon, then a separator. Unambiguous.
//   POSIX roots    — only the directories where machine identity actually
//                    lives. Matching a bare "/" would eat URL paths and route
//                    names ("no route: GET /api/jobs"), which name no machine.
// A run ends at whitespace or a quote — exactly how Node delimits the path in
// its error text. The lookbehinds stop a match from starting mid-token, so a
// URL like "https://example.com/var/log" is left alone.
const ABSOLUTE_RUN = new RegExp(
  [
    String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'\`<>|]*`,
    String.raw`(?<![\w.:\\/-])\/(?:home|Users|root|tmp|var|private)\/[^\s"'\`<>|]*`,
  ].join("|"),
  "g",
);

/**
 * Rewrite every absolute filesystem path inside an arbitrary message.
 * Messages we author are untouched — they contain no absolute paths.
 * @param {unknown} text  message from anywhere, including Node itself
 * @param {{repoRoot?: string}} [opts] repo root override (tests)
 * @returns {string} the same message with each path run rendered by displayPath
 */
export function scrubPaths(text, opts = {}) {
  const s = typeof text === "string" ? text : String(text ?? "");
  return s.replace(ABSOLUTE_RUN, (run) => {
    // A drive-letter run is a Windows path, and displayPath assumes the path
    // belongs to the platform it is running on: off win32, resolve() would
    // treat a drive-letter path as one long relative filename and hand it
    // straight back, leaking what this function exists to remove. Reduce here
    // instead, to the same "<outside-repo>/<leaf>" win32 would produce — the
    // guarantee holds on every platform, whichever platform wrote the message.
    if (sep !== "\\" && /^[A-Za-z]:[\\/]/.test(run)) {
      const segs = run.split(/[\\/]/).filter(Boolean).slice(1); // drop the drive
      return segs.length ? `${OUTSIDE_REPO}/${segs.at(-1)}` : OUTSIDE_REPO;
    }
    return displayPath(run, opts);
  });
}
