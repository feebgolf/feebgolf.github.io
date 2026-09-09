// settings.js — house rules. Each mode's engine exports a SETTINGS schema;
// this module turns a schema into defaults and validates every change.
//
// Validation lives here rather than in each engine because a setting arrives
// as a message from the host's own UI: one place to clamp it is one place to
// audit. Unknown keys and unusable values are refused, never coerced silently
// into something the engine would have to defend against later.

export function defaults(schema = []) {
  const out = {};
  for (const s of schema) out[s.key] = s.default;
  return out;
}

const fail = (msg) => ({ ok: false, msg });

export function coerce(schema = [], key, value) {
  const s = schema.find((f) => f.key === key);
  if (!s) return fail(`Unknown setting "${key}"`);

  if (s.type === 'bool') {
    if (typeof value !== 'boolean') return fail(`${s.label} must be on or off`);
    return { ok: true, value };
  }
  if (s.type === 'int') {
    const n = Number(value);
    if (!Number.isInteger(n)) return fail(`${s.label} must be a whole number`);
    if (s.min !== undefined && n < s.min) return fail(`${s.label} can't be below ${s.min}`);
    if (s.max !== undefined && n > s.max) return fail(`${s.label} can't be above ${s.max}`);
    return { ok: true, value: n };
  }
  if (s.type === 'enum') {
    if (!s.options.some((o) => o.value === value)) return fail(`${s.label}: unknown option`);
    return { ok: true, value };
  }
  return fail(`Unsupported setting type "${s.type}"`);
}
