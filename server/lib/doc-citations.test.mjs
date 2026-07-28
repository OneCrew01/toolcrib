// node --test "server/lib/*.test.mjs"
//
// A file:line citation is the second kind of doc claim that can go silently
// false. The first is a quoted hash, and that one is already pinned
// (demo-amend.test.mjs). This is the other: insert one import at the top of
// server/state/store.mjs and every ":171" written about it points one line
// past the thing it names — across four documents and a command's printed
// output — with a green suite and nothing to say so.
//
// So every citation in scope has to be DECLARED here with a substring that
// must appear on the line it names. An undeclared citation is a failure, not a
// pass: a new one cannot be added to these files without pinning it.
//
// SCOPE, stated plainly, because it is not the whole repo. This checks the
// three documents a reader is pointed at, plus the amendment demonstration's
// own printed output (a judge reads those line numbers as evidence), plus the
// two revision source files whose comments cite the rest of the tree. Other
// source comments elsewhere in the repo are NOT checked and are not claimed to
// be.

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { runAmendmentDemo, renderAmendmentDemo } from "../revision/demo-amend.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// --- what is pinned ----------------------------------------------------------
//
// key:   repo-relative path, then ":line" or ":first-last"
// value: text that must appear on that line (or somewhere inside that range)
//
// Keep the substring SPECIFIC to what the citing sentence claims. "const" would
// pass on almost any shifted line; "REVISION_REQUESTED" would not.

const PINS = {
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
  "server/state/store.mjs:43-51": "StateStore",
  "server/state/store.mjs:99-102": "ledgerPath",

  // the generator: where clearance is declared, and where the panel reads the chamfer
  "server/generators/flushmount.mjs:23": "no I/O, no network, no clock",
  "server/generators/flushmount.mjs:272": "const { W, H, T, ow, oh, A, d, e, colors } = dd;",
  "server/generators/flushmount.mjs:336": 'constLine("clearancePerSide", mm(c))',
  "server/generators/flushmount.mjs:411": "const { W, H, T, ow, A, d, e, colors } = dd;",
  "server/generators/flushmount.mjs:458": 'constLine("clearancePerSide", mm(c))',

  // the amendment module's own internals, cited by ARCHITECTURE and its comments
  "server/revision/amend.mjs:832-837": "amendedSpec.clearancePerSideMm = amendedValue;",
  "server/reference/tables/flush-mount-fit.mjs:120-127": "FIT_CLASS_ALIASES",
  "server/reference/tables/flush-mount-fit.mjs:129-133": "FIT_CLASS_RULES",
  "server/pipeline/backends.mjs:95": "flushMount",
};

// --- where citations are read from -------------------------------------------

const DOC_FILES = ["README.md", "docs/ARCHITECTURE.md", "docs/DECISION_LOG.md"];
const SOURCE_FILES = ["server/revision/amend.mjs", "server/revision/demo-amend.mjs"];

const SOURCES = [
  ...DOC_FILES.map((f) => ({ label: f, dir: dirname(f), text: readFileSync(join(REPO, f), "utf8") })),
  ...SOURCE_FILES.map((f) => ({ label: f, dir: dirname(f), text: readFileSync(join(REPO, f), "utf8") })),
  {
    label: "the output of `npm run amend`",
    dir: "server/revision",
    text: renderAmendmentDemo(runAmendmentDemo()),
  },
];

// path-ish token ending in a source extension, then :N or :N-M
const CITATION = /((?:\.\.\/|\.\/)?(?:[\w.-]+\/)*[\w.-]+\.(?:mjs|ts|tsx))[:](\d+)(?:-(\d+))?/g;

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
const ALL = [...sourceFiles("server"), ...sourceFiles("app/src")];

const byBasename = new Map();
for (const f of ALL) {
  const base = f.slice(f.lastIndexOf("/") + 1);
  if (!byBasename.has(base)) byBasename.set(base, []);
  byBasename.get(base).push(f);
}

function resolveCited(raw, fromDir) {
  const candidates = raw.startsWith(".")
    ? [posix.normalize(posix.join(fromDir, raw))]
    : [raw, posix.join("server", raw)];
  for (const c of candidates) {
    if (existsSync(join(REPO, c)) && statSync(join(REPO, c)).isFile()) return { path: c };
  }
  const hits = byBasename.get(raw) ?? [];
  if (hits.length === 1) return { path: hits[0] };
  if (hits.length > 1) return { error: `"${raw}" is ambiguous — it matches ${hits.join(", ")}` };
  return { error: `"${raw}" does not resolve to a file in this repo` };
}

// --- the checks --------------------------------------------------------------

function collect() {
  const found = new Map(); // key -> Set of source labels
  for (const src of SOURCES) {
    for (const m of src.text.matchAll(CITATION)) {
      const r = resolveCited(m[1], src.dir);
      assert.ok(!r.error, `${src.label} cites ${m[0]}, and ${r.error}`);
      const key = `${r.path}:${m[2]}${m[3] ? `-${m[3]}` : ""}`;
      if (!found.has(key)) found.set(key, new Set());
      found.get(key).add(src.label);
    }
  }
  return found;
}

test("every file:line citation in the docs and the demo output names the line it claims", () => {
  const found = collect();
  assert.ok(found.size > 0, "no citations found at all — the extractor has stopped working");

  for (const [key, where] of found) {
    const cited = [...where].join(", ");
    const expected = PINS[key];
    assert.ok(
      expected !== undefined,
      `${cited} cites ${key}, which is not pinned. Add it to PINS in this file with a ` +
        `substring that must appear on that line, so a shifted line cannot pass silently.`,
    );

    const [path, range] = [key.slice(0, key.lastIndexOf(":")), key.slice(key.lastIndexOf(":") + 1)];
    const [first, last = first] = range.split("-").map(Number);
    const lines = readFileSync(join(REPO, path), "utf8").split("\n");
    assert.ok(
      last <= lines.length,
      `${cited} cites ${key}, but ${path} has only ${lines.length} lines`,
    );

    const window = lines.slice(first - 1, last).join("\n");
    assert.ok(
      window.includes(expected),
      `${cited} cites ${key}, which is pinned to ${JSON.stringify(expected)} — and that text is ` +
        `not there any more. The line moved. Found instead: ${JSON.stringify(window.trim().slice(0, 90))}`,
    );
  }
});

test("no pin outlives the citation it was written for", () => {
  // A pin nobody cites is a pin nobody reads, and it will be maintained as if
  // it still mattered. Deleting a citation should delete its pin.
  const found = collect();
  const orphans = Object.keys(PINS).filter((k) => !found.has(k));
  assert.deepStrictEqual(
    orphans,
    [],
    `PINS still declares ${orphans.join(", ")}, which nothing in scope cites any more — delete them`,
  );
});

test("the checker resolves all three ways the docs write a path, and refuses an unknown one", () => {
  // The extractor is the load-bearing half: if it silently stops matching, both
  // tests above pass by finding nothing. These are its own unit checks.
  assert.strictEqual(resolveCited("server/state/store.mjs", "docs").path, "server/state/store.mjs");
  assert.strictEqual(resolveCited("state/store.mjs", "docs").path, "server/state/store.mjs");
  assert.strictEqual(resolveCited("store.mjs", "docs").path, "server/state/store.mjs");
  assert.strictEqual(resolveCited("../state/store.mjs", "server/revision").path, "server/state/store.mjs");
  assert.ok(resolveCited("no-such-file.mjs", "docs").error, "an unknown path resolved to something");

  const hits = [...("see state/store.mjs:171 and pdf.mjs:35-40 here".matchAll(CITATION))];
  assert.strictEqual(hits.length, 2, "the citation regex no longer matches both forms");
  assert.deepStrictEqual([hits[0][1], hits[0][2], hits[0][3]], ["state/store.mjs", "171", undefined]);
  assert.deepStrictEqual([hits[1][1], hits[1][2], hits[1][3]], ["pdf.mjs", "35", "40"]);
});
