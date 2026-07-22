// The intent envelope: what a requester must state before any generation
// runs. Pure and throw-free — bad input is a result, not an exception. The
// store maps a failed validation to INPUT_ERROR with these errors as the
// ledger reason (see store.mjs runValidation).

// Zoo UnitLength vocabulary.
export const UNITS = Object.freeze(["cm", "ft", "in", "m", "mm", "yd"]);

const nonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const plainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * @typedef {Object} GenerationRequest
 * @property {string} title
 * @property {string} [prompt]            exactly one of prompt / structuredIntent
 * @property {object} [structuredIntent]
 * @property {{name: string, densityKgM3: number}} material
 * @property {"cm"|"ft"|"in"|"m"|"mm"|"yd"} units
 * @property {string} requester           who is asking — every job has a name on it
 */

/**
 * Validate a raw intent envelope.
 * @returns {{ok: true, request: GenerationRequest} | {ok: false, errors: string[]}}
 */
export function validateGenerationRequest(obj) {
  if (!plainObject(obj)) return { ok: false, errors: ["request: must be an object"] };
  const errors = [];

  if (!nonEmptyString(obj.title)) errors.push("title: required, non-empty string");

  const hasPrompt = nonEmptyString(obj.prompt);
  const hasIntent = plainObject(obj.structuredIntent) && Object.keys(obj.structuredIntent).length > 0;
  if (hasPrompt === hasIntent)
    errors.push("prompt/structuredIntent: provide exactly one");

  if (!plainObject(obj.material)) {
    errors.push("material: required object {name, densityKgM3}");
  } else {
    if (!nonEmptyString(obj.material.name)) errors.push("material.name: required, non-empty string");
    const d = obj.material.densityKgM3;
    if (typeof d !== "number" || !Number.isFinite(d) || d <= 0)
      errors.push("material.densityKgM3: must be a finite number > 0");
  }

  if (!UNITS.includes(obj.units)) errors.push(`units: must be one of ${UNITS.join("|")}`);

  if (!nonEmptyString(obj.requester)) errors.push("requester: required, non-empty string");

  if (errors.length > 0) return { ok: false, errors };

  // Normalized whitelist copy — unknown keys are dropped, never stored.
  const request = {
    title: obj.title.trim(),
    ...(hasPrompt
      ? { prompt: obj.prompt.trim() }
      : { structuredIntent: obj.structuredIntent }),
    material: { name: obj.material.name.trim(), densityKgM3: obj.material.densityKgM3 },
    units: obj.units,
    requester: obj.requester.trim(),
  };
  return { ok: true, request };
}
