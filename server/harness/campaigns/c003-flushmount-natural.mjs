// C003 — Can text-to-cad make a flush-mount PAIR naturally?
// The thesis feature for the flush-mount library: a panel with an opening plus a
// separate insert that sits flush with the front face — tight deliberate clearance,
// chamfered lead-in, two colors so the fit reads. One target, seven human phrasings.
// FN-011/018: every prompt must be UNIQUE — repeats just produce dedupe hits, so this
// campaign is 7 cases x 1 run, no repeats anywhere.
//
// Mass is a weak signal here by design. Aluminum at 0.0027 g/mm³:
//   solid 60x60x3 slab            = 10800 mm³ → 29.16 g
//   panel + flush insert combined ≈ slab − clearance sliver − chamfers ≈ 28.3–29.1 g
//   (nearly invariant to opening size: the insert gives back what the opening takes)
//   panel alone (30mm opening)    = 8100 mm³  → 21.87 g
//   insert alone                  ≈ 2646 mm³  → ~7.1 g
// So in-bounds ≈ "total material plausible for both parts"; below-bounds ≈ one body
// missing. What mass CANNOT see: one fused solid vs two bodies, clearance arithmetic,
// chamfers, colors. The saved kcl/ files are the real analysis artifact — read them.

const EXPECTED = {
  minG: 23,
  maxG: 34,
  densityKgM3: 2700,
  note: "combined analytic ≈ 29.0g; panel-only 21.9g, insert-only 7.1g fall below",
};

export default {
  name: "c003-flushmount-natural",
  description:
    "Flush-mount pair (panel + insert, 0.15mm/side clearance, chamfered lead-in, two colors) asked seven unique ways: does text-to-cad ever deliver both bodies? Mass gate is loose on purpose — the kcl/ directory is the analysis artifact.",

  settings: { concurrency: 2, timeoutMin: 20, capUsd: 15 },

  cases: [
    {
      id: "f1-single-prompt-full-spec",
      // everything stated, dimensions for both parts, one prompt
      prompt:
        "Two aluminum parts: a panel 60mm x 60mm x 3mm with a square 30mm x 30mm opening through its center, and a separate square insert 29.7mm x 29.7mm x 3mm that fits into the opening and sits flush with the panel front face, leaving 0.15mm clearance per side. Chamfer the lead-in edges of the opening and the insert 0.5mm. Color the panel dark gray and the insert orange.",
      runs: 1,
      expected: { ...EXPECTED, note: "fully specified; both parts dimensioned explicitly" },
      strict: false,
    },
    {
      id: "f2-assembly-framing",
      // ask for it as an assembly, insert dims left for the model to derive
      prompt:
        "An assembly of two parts made of aluminum: part one is a 60 x 60 x 3 mm face panel with a centered square cutout 30 mm on a side; part two is a matching insert plate sized to drop into that cutout with 0.15 mm of clearance on every side, its top surface flush with the panel. Both mating edges get a small chamfer as a lead-in. Give the two parts different colors, blue panel and yellow insert.",
      runs: 1,
      expected: { ...EXPECTED, note: "assembly framing; insert size must be derived (30 − 2×0.15)" },
      strict: false,
    },
    {
      id: "f3-bezel-product-framing",
      // real-product framing: instrument panel + bezel blank
      prompt:
        "An instrument face plate in aluminum, 60mm wide, 60mm tall, 3mm thick, with a square instrument opening 32mm across in the middle, plus a separate blanking bezel that snaps into the opening and finishes flush with the front of the plate. Fit clearance 0.15mm around the bezel, chamfered edges so it leads in smoothly, plate anodized black and bezel bright red so they read as two components.",
      runs: 1,
      expected: { ...EXPECTED, note: "product framing (face plate + blanking bezel), 32mm opening" },
      strict: false,
    },
    {
      id: "f4-explicit-two-bodies",
      // spell out the modeling requirement itself: two separate solids
      prompt:
        "Model two separate solid bodies, not one merged solid. Body A: aluminum panel, 60mm square, 3mm thick, square hole 30mm x 30mm through the middle. Body B: aluminum insert that slips into the hole from the front and ends up flush with the panel face, undersized 0.15mm per side for clearance, with 0.5mm x 45 degree chamfers on the leading edges of both the hole and the insert. Make body A gray and body B green.",
      runs: 1,
      expected: { ...EXPECTED, note: "modeling requirement stated outright: two separate solids" },
      strict: false,
    },
    {
      id: "f5-shop-vernacular",
      // how it gets said across a workbench
      prompt:
        "Aluminum panel, 60 by 60, 3 thick, with a square window about 30 across cut in the center, and a little square plug that drops in that window and sits smooth with the face — leave it a hair small, 0.15 per side, break the edges with a chamfer so it starts easy, all in millimeters. Paint the panel silver and the plug dark blue so you can see the joint.",
      runs: 1,
      expected: { ...EXPECTED, note: "shop-floor phrasing: window, plug, sits smooth, a hair small" },
      strict: false,
    },
    {
      id: "f6-fit-callout",
      // engineering-fit language; clearance stated as a fit, not a dimension
      prompt:
        "Design a flush-mount pair in aluminum: outer panel 60 mm x 60 mm x 3 mm with a rectangular through-opening 30 mm x 30 mm, and an inner filler panel manufactured to a clearance fit of 0.3 mm total across the opening so it seats flush with the outer front surface. Apply lead-in chamfers of 0.5 mm at 45 degrees on the mating edges. Finish: outer panel matte gray, filler panel bright orange.",
      runs: 1,
      expected: { ...EXPECTED, note: "fit callout: 0.3mm TOTAL clearance — must halve it per side" },
      strict: false,
    },
    {
      id: "f7-minimal-underspecified",
      // the short ask a hurried user would type
      prompt:
        "60mm square 3mm aluminum panel with a square hole and a matching flush insert, 0.15mm clearance, chamfered lead-in edges, panel and insert in two different colors",
      runs: 1,
      expected: { ...EXPECTED, note: "underspecified: opening size and chamfer left to defaults" },
      strict: false,
    },
  ],
};
