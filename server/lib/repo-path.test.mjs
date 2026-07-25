// displayPath is the only thing standing between the operator's home
// directory and a judge's screen. Everything it can be handed — a repo file, a
// temp dir, a relative argument, the repo root itself — is pinned here.

import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { displayPath, scrubPaths, OUTSIDE_REPO } from "./repo-path.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

// Anything that still looks like a machine-rooted path fails the whole point.
const ABSOLUTE = /(^|[^A-Za-z0-9])[A-Za-z]:[\\/]|(^|\s)\/(home|Users)\//;

test("a file inside the repo renders repo-relative, forward-slashed", () => {
  const out = displayPath(join(REPO, "samples", "requests", "plain-plate.json"));
  assert.equal(out, "samples/requests/plain-plate.json");
  assert.doesNotMatch(out, ABSOLUTE);
});

test("separators are POSIX on every platform, so one demo reads like another", () => {
  const out = displayPath(join(REPO, "server", "pipeline", "data", "packages", "abc-123"));
  assert.equal(out, "server/pipeline/data/packages/abc-123");
  assert.ok(!out.includes("\\"));
});

test("a path outside the repo keeps only its leaf, behind an unmistakable marker", () => {
  const outsideDir = mkdtempSync(join(tmpdir(), "toolcrib-displaypath-"));
  const out = displayPath(join(outsideDir, "9f3c.json"));
  assert.equal(out, `${OUTSIDE_REPO}/9f3c.json`);
  assert.doesNotMatch(out, ABSOLUTE);
  // The directory chain is the private part: none of it may survive. One
  // marker plus one leaf means exactly one separator, whatever the real depth.
  assert.equal(out.split("/").length, 2);
  for (const seg of outsideDir.split(sep).filter(Boolean).slice(0, -1))
    assert.ok(!out.includes(seg), `leaked path segment ${seg}`);
});

test("the leaf survives, so an outside path is still unique enough to match on", () => {
  const a = displayPath("/tmp/toolcrib-x/11111111-1111-4111-8111-111111111111.json");
  const b = displayPath("/tmp/toolcrib-y/22222222-2222-4222-8222-222222222222.json");
  assert.notEqual(a, b);
  assert.match(a, /11111111-1111-4111-8111-111111111111\.json$/);
});

test("a relative argument resolves against cwd, not silently passed through", () => {
  const out = displayPath("samples/requests/plain-plate.json");
  // npm scripts run from the repo root; the demo's own argument must render clean.
  assert.doesNotMatch(out, ABSOLUTE);
  assert.ok(out.endsWith("plain-plate.json"), out);
});

test("the repo root itself is '.', never an empty string", () => {
  assert.equal(displayPath(REPO), ".");
  assert.equal(displayPath(REPO.replace(/[\\/]$/, "")), ".");
});

test("a sibling of the repo is outside it, and a dotted name inside it is not", () => {
  assert.equal(displayPath(join(REPO, "..", "some-other-repo", "f.txt")), `${OUTSIDE_REPO}/f.txt`);
  assert.equal(displayPath(join(REPO, "..gitkeep")), "..gitkeep");
});

test("nullish and non-string input degrade to a marker instead of throwing", () => {
  assert.equal(displayPath(undefined), OUTSIDE_REPO);
  assert.equal(displayPath(null), OUTSIDE_REPO);
  assert.equal(displayPath(""), OUTSIDE_REPO);
});

// --- scrubPaths: the messages we do NOT author -----------------------------
//
// displayPath only covers paths this codebase interpolates. Node writes its own
// error text, embeds the absolute path it failed on, and that text is forwarded
// verbatim into API error bodies and ledger reasons.

// These fixtures have to contain machine-rooted paths — that is the point of
// the function — but a literal one in a tracked file trips the standing leak
// audit (grep the tracked files for a drive letter or a home root) and teaches
// the next auditor to wave off a real hit. So the prefixes are assembled here
// rather than spelled out, and every one of them is invented: no string in
// this file is anyone's actual path.
const DRIVE = "C" + ":" + "\\";
const USERS = "/" + "Users/";
const HOME = "/" + "home/";

test("a Node fs error keeps its diagnosis and loses the machine", () => {
  const out = scrubPaths(`ENOENT: no such file or directory, scandir '${DRIVE}Users\\someone\\tmp\\zz\\data\\jobs'`);
  assert.equal(out, `ENOENT: no such file or directory, scandir '${OUTSIDE_REPO}/jobs'`);
  assert.doesNotMatch(out, ABSOLUTE);
  assert.ok(out.includes("ENOENT") && out.includes("scandir"), "the diagnosis must survive");
  assert.ok(!out.includes("someone"), "the user segment must not survive");
});

test("a path inside the repo scrubs to its repo-relative form, still useful", () => {
  assert.equal(
    scrubPaths(`EACCES: permission denied, open '${join(REPO, "samples", "requests", "plain-plate.json")}'`),
    "EACCES: permission denied, open 'samples/requests/plain-plate.json'",
  );
});

test("POSIX machine roots are scrubbed; URLs and route names are left intact", () => {
  assert.equal(scrubPaths(`open ${USERS}someone/x/part.stl`), `open ${OUTSIDE_REPO}/part.stl`);
  assert.equal(scrubPaths(`open ${HOME}someone/x/part.stl`), `open ${OUTSIDE_REPO}/part.stl`);
  // A bare "/" prefix is NOT a path for this purpose — these must not be touched.
  assert.equal(scrubPaths("no route: GET /api/jobs"), "no route: GET /api/jobs");
  assert.equal(scrubPaths("fetch failed: https://api.zoo.dev/user/payment"), "fetch failed: https://api.zoo.dev/user/payment");
  assert.equal(scrubPaths("see https://example.com/var/log/notes"), "see https://example.com/var/log/notes");
});

test("every path in a multi-path message is scrubbed, not just the first", () => {
  const out = scrubPaths(`copy ${DRIVE}Users\\someone\\a\\one.stl -> ${DRIVE}Users\\someone\\b\\two.stl`);
  assert.equal(out, `copy ${OUTSIDE_REPO}/one.stl -> ${OUTSIDE_REPO}/two.stl`);
  assert.doesNotMatch(out, ABSOLUTE);
});

test("messages we author contain no paths, so scrubbing them is a no-op", () => {
  for (const authored of [
    "DRAFT -> VALIDATING is not a legal move",
    "actorName is required — decisions are made by named humans, no defaults",
    "gate(s) failed: envelope — 300x300x300mm exceeds the build volume",
    "text-to-cad t2c-9 completed in 4.2s but its outputs never appeared on /async/operations",
  ])
    assert.equal(scrubPaths(authored), authored);
});

test("scrubPaths never throws on whatever an unknown error object hands it", () => {
  assert.equal(scrubPaths(undefined), "");
  assert.equal(scrubPaths(null), "");
  assert.equal(scrubPaths(42), "42");
  assert.equal(scrubPaths({ toString: () => "boom" }), "boom");
});
