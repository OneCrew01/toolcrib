// One renderer for every filesystem path that escapes into something a human
// reads: ledger reasons, manifest warnings, PDF sections, API responses,
// console lines. Absolute paths are machine identity — the operator's home
// directory and username — and none of those surfaces has any use for them.
// A ledger reason is worse than the rest: it is hashed into the chain, so a
// leak there is sealed into the tamper-evident record and cannot be edited
// out afterwards without breaking the chain.
//
//   displayPath("C:\\...\\toolcrib\\samples\\requests\\plain-plate.json")
//     -> "samples/requests/plain-plate.json"
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
