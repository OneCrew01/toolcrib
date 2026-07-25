// displayPath is the only thing standing between the operator's home
// directory and a judge's screen. Everything it can be handed — a repo file, a
// temp dir, a relative argument, the repo root itself — is pinned here.

import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { displayPath, OUTSIDE_REPO } from "./repo-path.mjs";

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
