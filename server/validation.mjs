export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function check(value, message, status = 400) {
  if (!value) throw new HttpError(status, message);
}
export function fields(value, allowed, required = []) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
  check(Object.keys(value).every(k => allowed.includes(k)), 'Unknown field');
  check(required.every(k => Object.hasOwn(value, k)), 'Missing required field');
}
export function text(value, max = 10000, empty = false) {
  check(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0), 'Invalid text');
  return value;
}
export function id(value) {
  check(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value), 'Invalid ID');
  return value;
}
// A model's reply as JSON. One that writes TeX may leave a backslash single, and JSON refuses most letters after it
// (\cdot, \sqrt, \alpha): those are doubled and the reply read again. Valid JSON is never touched.
export function parseReply(raw) {
  try { return JSON.parse(raw); }
  catch (error) {
    const fixed = raw.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})|\\/g, (all, valid) => valid ? all : '\\\\');
    if (fixed === raw) throw error;
    return JSON.parse(fixed);
  }
}
export function oneOf(value, options) { check(options.includes(value), 'Invalid option'); return value; }
export function revision(value, current) {
  check(Number.isInteger(value) && value >= 0, 'Invalid expected_revision');
  check(value === current, 'Revision conflict: read the latest session before retrying', 409);
}
