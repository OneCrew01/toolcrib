// C001 — Fastening-feature reliability matrix.
// Question: per feature class (plain holes → countersink → counterbore → pattern →
// bracket), what fraction of "completed" generations is actually correct geometry,
// and what fraction fails outright? Born from FN-006: the same countersink prompt
// failed 2/3 runs; a single generation cannot be trusted. This measures it.

const AL = 0.0027; // g/mm³, aluminum 2700 kg/m³
const holeMm3 = (d, t) => (Math.PI * (d / 2) ** 2 * t);

// A: 50×50×2 plate, 4×Ø5 through → 5000 − 157.1 = 4842.9mm³ → 13.076g
const massA = (5000 - 4 * holeMm3(5, 2)) * AL;
// C: A + 4 counterbores Ø9×1 deep (annulus over the Ø5 through in that 1mm):
//    extra removal 4×π(4.5²−2.5²)×1 = 175.9mm³ → 12.601g
const massC = (5000 - 4 * holeMm3(5, 2) - 4 * Math.PI * (4.5 ** 2 - 2.5 ** 2) * 1) * AL;
// D: 100×20×2 strip, 6×Ø5 → 4000 − 235.6 = 3764.4mm³ → 10.164g
const massD = (100 * 20 * 2 - 6 * holeMm3(5, 2)) * AL;

export default {
  name: "c001-fastening-reliability",
  description:
    "Reliability of text-to-cad per fastening feature class: identical prompt ×6, mass-gate validation on every completed run.",

  settings: { concurrency: 2, timeoutMin: 20, capUsd: 20 },

  cases: [
    {
      id: "a-plain-holes",
      prompt:
        "A 50mm x 50mm x 2mm aluminum plate with four 5mm diameter holes, one near each corner, each hole center 10mm from both adjacent edges",
      runs: 6,
      expected: { minG: massA * 0.99, maxG: massA * 1.01, note: `baseline; analytic ${massA.toFixed(3)}g ±1%` },
      strict: true,
    },
    {
      id: "b-countersink",
      prompt:
        "A 50mm x 50mm x 2mm aluminum plate with four 5mm diameter holes, one near each corner, each hole center 10mm from both adjacent edges, each hole countersunk at 100 degrees to sit a flush flat-head screw",
      runs: 6,
      // Head Ø unspecified → model chooses; countersink removal is bounded by plate
      // thickness. Loose bounds: below baseline, above plate-minus-generous-cones.
      expected: { minG: 12.0, maxG: massA * 1.005, note: "FN-006 case; loose bounds (head Ø unspecified)" },
      strict: false,
    },
    {
      id: "c-counterbore",
      prompt:
        "A 50mm x 50mm x 2mm aluminum plate with four 5mm diameter through holes, one near each corner, each hole center 10mm from both adjacent edges, each hole counterbored 9mm diameter by 1mm deep",
      runs: 6,
      expected: { minG: massC * 0.985, maxG: massC * 1.015, note: `analytic ${massC.toFixed(3)}g ±1.5%` },
      strict: true,
    },
    {
      id: "d-hole-row",
      prompt:
        "A 100mm x 20mm x 2mm aluminum strip with six 5mm diameter holes in a single row along the centerline, the first hole center 10mm from the left edge and the holes spaced 16mm apart",
      runs: 6,
      expected: { minG: massD * 0.99, maxG: massD * 1.01, note: `analytic ${massD.toFixed(3)}g ±1%` },
      strict: true,
    },
    {
      id: "e-l-bracket",
      prompt:
        "An L-shaped aluminum bracket, 2mm thick, with two rectangular legs each 40mm long and 40mm wide meeting at 90 degrees, with two 5mm diameter holes in each leg, each hole center 10mm from the free end of its leg and 10mm from the nearest side edge",
      runs: 6,
      // Corner treatment (sharp vs radiused, inner vs outer 40) moves mass — loose.
      expected: { minG: 14.0, maxG: 18.5, note: "loose bounds; corner modeling ambiguous by design" },
      strict: false,
    },
  ],
};
