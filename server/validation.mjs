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
// A correction's changes, one row each; anything malformed is dropped rather than failing the correction.
export function changeRows(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(c => c && typeof c.from === 'string' && typeof c.to === 'string' && typeof c.why === 'string' && c.to.trim())
    .slice(0, 8).map(c => ({ from: c.from.slice(0, 300), to: c.to.slice(0, 300), why: c.why.slice(0, 200) }));
}
export function oneOf(value, options) { check(options.includes(value), 'Invalid option'); return value; }
export function revision(value, current) {
  check(Number.isInteger(value) && value >= 0, 'Invalid expected_revision');
  check(value === current, 'Revision conflict: read the latest session before retrying', 409);
}
