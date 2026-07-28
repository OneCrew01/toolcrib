// Freshness checking for the `file:line` citations this repo writes in prose.
//
// A file:line citation is a doc claim that can go silently false. Insert one
// import at the top of server/state/store.mjs and every ":171" written about it
// points one line past the thing it names — across four documents and a
// command's printed output — with a green suite and nothing to say so.
//
// So every citation in scope has to be DECLARED in PINS below with text that
// must still be on the line it names. An undeclared citation is a failure, not
// a pass: a new citation cannot be added to these files without pinning it.
//
// This is the machinery only. The assertions live in doc-citations.test.mjs,
// the same way leak-audit.mjs holds the scanner and leak-audit.test.mjs holds
// the judgements about it — so a caller who wants this check over a wider
// surface can import it instead of copying the resolver out of a test file.
//
// SCOPE, stated plainly, because it is not the whole repo. docSources() reads
// the three documents a reader is pointed at, the amendment demonstration's own
// printed output (a judge reads those line numbers as evidence), and the two
// revision source files whose comments cite the rest of the tree. Source
// comments elsewhere in the repo are NOT checked and are not claimed to be.
// Widening it is one line — every citation it then found would need a pin.
//
// THIS FILE IS DELIBERATELY OUTSIDE ITS OWN SCOPE, and that is not an oversight
// to be tidied up later. Every key of PINS is citation-shaped, so scanning this
// file would make each pin cite itself, and the orphan check below — which
// exists to notice a pin nothing points at any more — would pass on an empty
// table forever after.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// --- what is pinned ----------------------------------------------------------
//
// key:   repo-relative path, then ":line" or ":first-last"
// value: for a single line, text that must appear on it. For a RANGE, a pair
//        [firstLineText, lastLineText] — both ends, each on its own line.
//
// Both ends, because a range that only had to match somewhere inside itself
// would tolerate drift up to its own width: `flush-mount-fit.mjs:129-133` pinned
// to "FIT_CLASS_RULES" stayed green after a two-line shift that had already made
// the citation wrong. Pinning the boundaries makes the boundaries load-bearing.
//
// Keep the substring SPECIFIC to what the citing sentence claims. "const" would
// pass on almost any shifted line; "REVISION_REQUESTED" would not.

export const PINS = {
  // the revision edge — cited by README, ARCHITECTURE, D-002, D-009 and the demo
  "server/state/states.mjs:77": "[S.REVISION_REQUESTED]: { actor: ACTOR.HUMAN, next: [S.DRAFT] }",
  "server/state/store.mjs:171": "if (from === STATE.REVISION_REQUESTED && to === STATE.DRAFT) job.rev += 1;",
  "server/state/state.test.mjs:66": "REVISION_REQUESTED -> DRAFT opens rev 2",
  "server/api/server.mjs:335": "STATE.REVISION_REQUESTED",

  // D-009's four findings
  "server/pipeline/backends.mjs:46": "fixturesDir",
  "server/state/store.mjs:190": "STATE.INPUT_ERROR",
  "server/state/store.mjs:198": "STATE.GENERATING",
  "server/pipeline/run-job.mjs:339": "TOOLCRIB_ALLOW_LIVE",
  "server/api/server.mjs:255": "TOOLCRIB_ALLOW_LIVE",
  "server/package/pdf.mjs:19": "const FALLBACK",
  "server/package/pdf.mjs:35": "function wrapText",
  "server/package/pdf.mjs:70": "Tj ET",
  "server/package/package.test.mjs:214": 'pdf.includes("MEASURED")',

  // the store, cited by D-003/D-004
  "server/state/store.mjs:43-51": [" * StateStore interface", " */"],
  "server/state/store.mjs:99-102": [
    "return join(this.jobsDir, `${jobId}.json`);",
    "return join(this.jobsDir, `${jobId}.ledger.jsonl`);",
  ],

  // the generator: where clearance is declared, and where the panel reads the chamfer
  "server/generators/flushmount.mjs:23": "no I/O, no network, no clock",
  // D-010's declared deviation: the two string literals that were edited
  "server/generators/flushmount.mjs:169": "gate(!(opening.cornerRadiusMm > 0)",
  "server/generators/flushmount.mjs:220": '"clean miter, both parts:',
  "server/generators/flushmount.mjs:272": "const { W, H, T, ow, oh, A, d, e, colors } = dd;",
  "server/generators/flushmount.mjs:336": 'constLine("clearancePerSide", mm(c))',
  "server/generators/flushmount.mjs:411": "const { W, H, T, ow, A, d, e, colors } = dd;",
  "server/generators/flushmount.mjs:458": 'constLine("clearancePerSide", mm(c))',

  // the amendment module's own internals, cited by ARCHITECTURE and its comments
  "server/revision/amend.mjs:832-837": ["amendedSpec.clearancePerSideMm = amendedValue;", "};"],
  "server/reference/tables/flush-mount-fit.mjs:120-127": ["const FIT_CLASS_ALIASES = Object.freeze({", "});"],
  "server/reference/tables/flush-mount-fit.mjs:129-133": ["const FIT_CLASS_RULES = Object.freeze({", "});"],
  "server/reference/tables/flush-mount-fit.mjs:202": '["FMF-007", "FMF-008"].map((id) => getRule(table, id))',
  "server/pipeline/backends.mjs:95": "flushMount",
};

// --- extraction ---------------------------------------------------------------

// path-ish token ending in a source extension, then :N or :N-M
export const CITATION = /((?:\.\.\/|\.\/)?(?:[\w.-]+\/)*[\w.-]+\.(?:mjs|ts|tsx))[:](\d+)(?:-(\d+))?/g;

// a colon-number that no path token introduces: the ":202" half of
// "(flush-mount-fit.mjs:129-133, :202)"
const COLON_NUMBER = /:(\d+)(?:-(\d+))?(?![\d\w])/g;

// How close a bare ":N" has to sit behind a real citation before it is read as a
// continuation of it. Wide enough to survive one wrapped line of prose, narrow
// enough that a port number in an unrelated code block is nobody's continuation.
const CONTINUATION_WINDOW = 160;

/**
 * Every full `path.mjs:N` or `path.mjs:N-M` in a body of text.
 *
 * @returns {Array<{raw: string, first: number, last: number|null, start: number, end: number}>}
 */
export function citationsIn(text) {
  const out = [];
  for (const m of text.matchAll(CITATION)) {
    out.push({
      raw: m[1],
      first: Number(m[2]),
      last: m[3] === undefined ? null : Number(m[3]),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/**
 * Bare `:N` continuation citations — the form the extractor above cannot see.
 *
 * The repo writes them: `(flush-mount-fit.mjs:129-133, :202)`. A reader resolves
 * the filename from the sentence; a regex cannot, without guessing. So rather
 * than build an extractor that infers a filename from context and is wrong
 * silently, this finds them and says spell it out.
 *
 * A `:N` counts as a continuation only when a real citation ends within
 * CONTINUATION_WINDOW characters behind it. That is what keeps a port number —
 * `# API on :8787` in the README's run instructions — from being read as one.
 *
 * @returns {Array<{token: string, index: number, after: string}>}
 */
export function bareContinuationsIn(text) {
  const cites = citationsIn(text);
  if (cites.length === 0) return [];

  // Blank the full citations out so their own ":N" halves are not re-found.
  // Sliced rather than mapped over characters, so every index stays exactly the
  // index matchAll reported — the docs are full of em-dashes and box drawing.
  let blanked = "";
  let cursor = 0;
  for (const c of cites) {
    blanked += text.slice(cursor, c.start) + " ".repeat(c.end - c.start);
    cursor = c.end;
  }
  blanked += text.slice(cursor);

  const out = [];
  for (const m of blanked.matchAll(COLON_NUMBER)) {
    const behind = cites.filter((c) => c.end <= m.index && m.index - c.end <= CONTINUATION_WINDOW);
    if (behind.length === 0) continue;
    const nearest = behind[behind.length - 1];
    out.push({ token: m[0], index: m.index, after: `${nearest.raw}:${nearest.first}` });
  }
  return out;
}

// --- resolving a cited path to a repo-relative one ---------------------------
//
// The documents cite three ways, all of them readable in context and none of
// them a full path: "server/state/store.mjs", "state/store.mjs", and bare
// "store.mjs". Source comments also cite relatively ("../state/store.mjs").
// All four are resolved to one repo-relative path so a pin is written once.

function sourceFiles(dir, acc = []) {
  for (const e of readdirSync(join(REPO, dir), { withFileTypes: true })) {
    const rel = posix.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(rel, acc);
    else if (/\.(mjs|ts|tsx)$/.test(e.name)) acc.push(rel);
  }
  return acc;
}

let basenameIndex = null;
function byBasename() {
  if (basenameIndex) return basenameIndex;
  basenameIndex = new Map();
  for (const f of [...sourceFiles("server"), ...sourceFiles("app/src")]) {
    const base = f.slice(f.lastIndexOf("/") + 1);
    if (!basenameIndex.has(base)) basenameIndex.set(base, []);
    basenameIndex.get(base).push(f);
  }
  return basenameIndex;
}

/** @returns {{path: string}|{error: string}} */
export function resolveCited(raw, fromDir) {
  const candidates = raw.startsWith(".")
    ? [posix.normalize(posix.join(fromDir, raw))]
    : [raw, posix.join("server", raw)];
  for (const c of candidates) {
    if (existsSync(join(REPO, c)) && statSync(join(REPO, c)).isFile()) return { path: c };
  }
  const hits = byBasename().get(raw) ?? [];
  if (hits.length === 1) return { path: hits[0] };
  if (hits.length > 1) return { error: `"${raw}" is ambiguous — it matches ${hits.join(", ")}` };
  return { error: `"${raw}" does not resolve to a file in this repo` };
}

// --- the sources this repo checks --------------------------------------------

const DOC_FILES = ["README.md", "docs/ARCHITECTURE.md", "docs/DECISION_LOG.md"];
const SOURCE_FILES = ["server/revision/amend.mjs", "server/revision/demo-amend.mjs"];

/**
 * The standard scope, built fresh. The demonstration's output is RENDERED here
 * rather than read from a transcript, so the citations checked are the ones a
 * reader would see today.
 *
 * @returns {Promise<Array<{label: string, dir: string, text: string}>>}
 */
export async function docSources() {
  const { runAmendmentDemo, renderAmendmentDemo } = await import("../revision/demo-amend.mjs");
  return [
    ...[...DOC_FILES, ...SOURCE_FILES].map((f) => ({
      label: f,
      dir: dirname(f),
      text: readFileSync(join(REPO, f), "utf8"),
    })),
    {
      label: "the output of `npm run amend`",
      dir: "server/revision",
      text: renderAmendmentDemo(runAmendmentDemo()),
    },
  ];
}

// --- the check ---------------------------------------------------------------

/**
 * Every citation found, keyed "repo/relative/path.mjs:N" or ":N-M", mapped to
 * the set of sources that wrote it.
 *
 * @returns {{found: Map<string, Set<string>>, findings: string[]}}
 */
export function collectCitations(sources) {
  const found = new Map();
  const findings = [];
  for (const src of sources) {
    for (const c of citationsIn(src.text)) {
      const r = resolveCited(c.raw, src.dir);
      if (r.error) {
        findings.push(`${src.label} cites ${c.raw}:${c.first}, and ${r.error}`);
        continue;
      }
      const key = `${r.path}:${c.first}${c.last === null ? "" : `-${c.last}`}`;
      if (!found.has(key)) found.set(key, new Set());
      found.get(key).add(src.label);
    }
    for (const b of bareContinuationsIn(src.text)) {
      findings.push(
        `${src.label} writes the bare "${b.token}" just after ${b.after}. A reader resolves that ` +
          `filename from the sentence; nothing here can, so the line it names is never checked. ` +
          `Spell the path out.`,
      );
    }
  }
  return { found, findings };
}

/**
 * The whole check: every citation in scope names a line that still holds its
 * pinned text, every citation is pinned, and no pin outlives its citation.
 *
 * Returns findings rather than throwing, so a caller can decide what a stale
 * citation is worth. The test treats any finding as a failure.
 *
 * @returns {{findings: string[], citations: number, pins: number}}
 */
export function checkCitations(sources, pins = PINS) {
  const { found, findings } = collectCitations(sources);

  for (const [key, where] of found) {
    const cited = [...where].join(", ");
    const expected = pins[key];
    if (expected === undefined) {
      findings.push(
        `${cited} cites ${key}, which is not pinned. Add it to PINS in ` +
          `server/lib/doc-citations.mjs with text that must appear on that line, so a shifted ` +
          `line cannot pass silently.`,
      );
      continue;
    }

    const cut = key.lastIndexOf(":");
    const path = key.slice(0, cut);
    const [first, last = first] = key
      .slice(cut + 1)
      .split("-")
      .map(Number);
    const lines = readFileSync(join(REPO, path), "utf8").split("\n");
    if (last > lines.length) {
      findings.push(`${cited} cites ${key}, but ${path} has only ${lines.length} lines`);
      continue;
    }

    // A single line pins one text; a range pins both of its ends. The shapes are
    // required to match so nobody quietly buys the drift tolerance back by
    // writing a range pin as a bare string.
    const isRange = last !== first;
    const shapedRight = isRange ? Array.isArray(expected) && expected.length === 2 : typeof expected === "string";
    if (!shapedRight) {
      findings.push(
        isRange
          ? `${key} is a range, so its pin must be exactly [firstLineText, lastLineText] — both ` +
            `ends, or the citation tolerates drift up to the width of the range`
          : `${key} names one line, so its pin must be a single string, not a pair`,
      );
      continue;
    }

    const wanted = isRange ? expected : [expected];
    const at = isRange ? [first, last] : [first];
    for (let i = 0; i < wanted.length; i++) {
      const lineNo = at[i];
      const line = lines[lineNo - 1] ?? "";
      if (line.includes(wanted[i])) continue;
      findings.push(
        `${cited} cites ${key}, whose line ${lineNo} is pinned to ${JSON.stringify(wanted[i])} — ` +
          `and that text is not there any more. The line moved. Found instead: ` +
          `${JSON.stringify(line.trim().slice(0, 90))}`,
      );
    }
  }

  const orphans = Object.keys(pins).filter((k) => !found.has(k));
  if (orphans.length > 0) {
    findings.push(
      `PINS still declares ${orphans.join(", ")}, which nothing in scope cites any more — delete them`,
    );
  }

  return { findings, citations: found.size, pins: Object.keys(pins).length };
}
