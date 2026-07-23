// Burn-cert print recipe — the half of flammability the CAD cannot enforce.
//
// Geometry the CAD controls (wall thickness) is gated by burncert-validate.
// Material, infill, and orientation are print-time facts: the package can
// only REQUIRE them, loudly and citably. printRecipe() assembles that
// requirement block from the fail-closed burn-cert table — structured object
// plus a markdown block ready for a sample bundle or shop traveler.
//
// Traveler wiring (future hook): server/package/assemble.mjs would attach
// recipe.markdown to the traveler — pipeline is frozen for the contest
// window, so the recipe ships in the sample bundle instead.
//
// CLI:  node server/generators/burncert-recipe.mjs --material=PC-ABS-FR \
//         [--allow-draft] [--json]
// Prints markdown (or the JSON object with --json); exit 2 on fail-closed.

import { pathToFileURL } from "node:url";
import {
  burnCert,
  minWallFloor,
  minInfillPercent,
  BURN_CERT_DISCLAIMER,
} from "../reference/tables/burn-cert.mjs";
import { UnverifiedRuleError, DRAFT_WATERMARK } from "../reference/lookup.mjs";
import { PENDING_OPERATOR, VERIFIED } from "../reference/schema.mjs";

const ORIENTATION_NOTE =
  "Record the actual build orientation on the traveler. TN23-65 treated orientation as an " +
  "interaction effect with material, thickness, and infill (UNCONFIRMED — verify against the " +
  "printed source); do not rotate the part off its modeled orientation without re-running the " +
  "min-wall gate on thin features.";

/**
 * Structured print recipe + markdown block for a material.
 * Fail-closed: consulting PENDING rules without { allowDraft: true } throws
 * UnverifiedRuleError. Deterministic — no clock, no I/O.
 * @param {{material?: string, allowDraft?: boolean}} [opts]
 * @param {object} [table] burn-cert rule table override (tests)
 * @returns {{recipe: object, markdown: string}}
 */
export function printRecipe({ material, allowDraft = false } = {}, table = burnCert) {
  const wall = minWallFloor({ material, allowDraft }, table);
  const infill = minInfillPercent({ allowDraft }, table);

  const rules = [...wall.verification.rules, ...infill.verification.rules];
  const pending = rules.some((r) => r.status !== VERIFIED);
  const recipe = {
    tool: "burncert-recipe",
    material: wall.material,
    materialListed: wall.materialListed,
    minWallMm: wall.floorMm,
    wallBasis: wall.floorBasis,
    minInfillPercent: infill.percent,
    infillEnforcement: infill.enforcement,
    orientationNote: ORIENTATION_NOTE,
    chemistryNote: wall.chemistryNote,
    citations: { wall: wall.citation.floor, chemistry: wall.citation.chemistry, infill: infill.citation },
    disclaimer: BURN_CERT_DISCLAIMER,
    verification: { status: pending ? PENDING_OPERATOR : VERIFIED, rules },
  };
  if (pending) recipe.watermark = DRAFT_WATERMARK;

  const md = [];
  md.push("## Print recipe — design-for-burn-cert");
  md.push("");
  if (recipe.watermark) {
    md.push(`**${recipe.watermark}** — rules await operator sign-off (docs/VERIFICATION_LOG.md).`);
    md.push("");
  }
  md.push(`- **Material:** ${recipe.material}${recipe.materialListed ? "" : " — no material-specific UL listing in the reference table; general FR floor applies"}`);
  md.push(`- **Minimum wall:** ${recipe.minWallMm} mm (${recipe.wallBasis})`);
  md.push(`- **Minimum infill:** ${recipe.minInfillPercent}% — ${recipe.infillEnforcement}`);
  md.push(`- **Orientation:** ${recipe.orientationNote}`);
  md.push("");
  md.push(`> ${recipe.disclaimer}`);
  md.push("");
  md.push(`> ${recipe.chemistryNote}`);
  md.push("");
  md.push("Citations:");
  md.push(`- wall floor: ${recipe.citations.wall}`);
  md.push(`- chemistry: ${recipe.citations.chemistry}`);
  md.push(`- infill: ${recipe.citations.infill}`);
  md.push("");

  return { recipe, markdown: md.join("\n") };
}

// --------------------------------------------------------------------- CLI

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  try {
    const { recipe, markdown } = printRecipe({
      material: flag("material"),
      allowDraft: args.includes("--allow-draft"),
    });
    console.log(args.includes("--json") ? JSON.stringify(recipe, null, 2) : markdown);
  } catch (e) {
    if (e instanceof UnverifiedRuleError) {
      console.error(`fail-closed: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
}
