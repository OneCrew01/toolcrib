// C002 — Phrasing robustness for the thesis feature (flush-mount countersinks).
// C001 taught us identical prompts are near-deterministic (FN-012), so repeats measure
// infrastructure, not the model. C002 holds the TARGET GEOMETRY constant — a 50×50×2
// plate, four Ø5 corner holes at 10mm edge distance, 100° flush countersinks — and
// varies only how a human would SAY it. Robust model ⇒ same mass everywhere.
// Analysis after the run: mass spread across cases + KCL variants + failure rates.

const AL = 0.0027;
const massPlain = (5000 - 4 * (Math.PI * 2.5 ** 2 * 2)) * AL; // no-countersink ceiling ≈ 13.076g

// All cases share loose bounds (countersink head Ø legitimately unspecified in most
// phrasings): below the plain-plate ceiling, above a generous-countersink floor.
const EXPECTED = { minG: 12.0, maxG: massPlain * 1.005, note: "shared bounds; see case notes" };

export default {
  name: "c002-phrasing-robustness",
  description:
    "Same countersunk-plate geometry asked five human ways: does phrasing change the part? Mass spread across cases = robustness.",

  settings: { concurrency: 2, timeoutMin: 20, capUsd: 15 },

  cases: [
    {
      id: "p1-formal-spec",
      prompt:
        "A 50mm x 50mm x 2mm aluminum plate with four 5mm diameter holes, one near each corner, each hole center 10mm from both adjacent edges, each hole countersunk at 100 degrees to sit a flush flat-head screw",
      runs: 4,
      expected: { ...EXPECTED, note: "C001 case-b baseline phrasing" },
      strict: false,
    },
    {
      id: "p2-drawing-callout",
      prompt:
        "Aluminum plate 50 x 50 x 2 mm. 4X drill 5.0 mm THRU, countersink 100 degrees, equally placed at the four corners with hole centers 10 mm from each adjacent edge, for flush flat head screws",
      runs: 4,
      expected: { ...EXPECTED, note: "engineering-drawing callout style" },
      strict: false,
    },
    {
      id: "p3-shop-vernacular",
      prompt:
        "Flat aluminum plate, 50 mm square and 2 mm thick. Drill four 5 mm holes at the corners, 10 mm in from each edge, and countersink them at 100 degrees so flat-head screws sit flush",
      runs: 4,
      expected: { ...EXPECTED, note: "spoken shop-floor phrasing" },
      strict: false,
    },
    {
      id: "p4-fastener-first",
      prompt:
        "A 50mm x 50mm x 2mm aluminum plate that accepts four M5 flat-head countersunk screws sitting flush with the surface, one screw near each corner with its center 10mm from both adjacent edges",
      runs: 4,
      expected: { ...EXPECTED, note: "model must DERIVE hole + countersink from the fastener" },
      strict: false,
    },
    {
      id: "p5-underspecified",
      prompt: "50mm square 2mm aluminum plate, four countersunk 5mm corner holes 10mm from the edges",
      runs: 4,
      expected: { ...EXPECTED, note: "angle unspecified — what default does it choose?" },
      strict: false,
    },
  ],
};
