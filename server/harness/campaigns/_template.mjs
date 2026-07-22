// CAMPAIGN TEMPLATE — copy this file, rename to cNNN-your-idea.mjs, edit, then:
//   npm run campaign -- cNNN-your-idea --dry     (sanity-check the plan, free)
//   npm run campaign -- cNNN-your-idea           (run it — backgroundable overnight)
//
// A campaign = one question, asked as a grid of prompts with N repeats and a
// validation range per case. Keep one variable moving at a time; repeats are what
// turn anecdotes into statistics.

export default {
  // kebab-case, unique; results are filed under this name
  name: "cNNN-your-idea",
  description: "One sentence: the question this campaign answers.",

  settings: {
    concurrency: 2,   // parallel generations (limits unknown — see office-hours Q3)
    timeoutMin: 20,   // per-run client timeout (FN-005: latency spread is huge)
    capUsd: 20,       // graceful stop when the run has burned this much
  },

  cases: [
    {
      id: "a-short-slug",
      // The EXACT prompt, repeated `runs` times. Identical repeats measure
      // reliability; vary the prompt across CASES, never within one.
      prompt: "A 50mm x 50mm x 2mm aluminum plate ...",
      runs: 6,
      format: "step", // export format to request (step feeds the mass gate)
      expected: {
        // Mass gate in grams. Compute analytically and show your work in `note`
        // (volume mm³ × density g/mm³; aluminum = 0.0027). Wide bounds are fine
        // for ambiguous prompts — set strict:false so misses are informational.
        minG: 12.9,
        maxG: 13.2,
        densityKgM3: 2700,
        note: "5000mm³ − 4×39.27mm³ holes = 4842.9mm³ → 13.076g ±1%",
      },
      strict: true, // false = range is informational, misses aren't "invalid"
    },
  ],
};
