// src/string-utils.js
// The "system under test" — a tiny, dependency-free utility module.
// Same module is tested by all three runners to keep the comparison honest.

/**
 * Convert a string to a URL-safe slug.
 * "Hello World!" -> "hello-world"
 */
export function slugify(input) {
  if (typeof input !== 'string') throw new TypeError('slugify expects a string');
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Truncate a string to `max` characters, appending an ellipsis when cut.
 * "Hello world" (max 5) -> "Hello…"
 */
export function truncate(input, max = 30) {
  if (typeof input !== 'string') throw new TypeError('truncate expects a string');
  if (!Number.isFinite(max) || max < 1) throw new RangeError('max must be >= 1');
  if (input.length <= max) return input;
  return input.slice(0, Math.max(0, max - 1)) + '\u2026';
}

/**
 * Cheap palindrome check. Ignores case and non-alphanumerics.
 */
export function isPalindrome(input) {
  if (typeof input !== 'string') throw new TypeError('isPalindrome expects a string');
  const normalized = input.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized === normalized.split('').reverse().join('');
}

/**
 * Count whitespace-separated words. Empty / whitespace -> 0.
 */
export function countWords(input) {
  if (typeof input !== 'string') throw new TypeError('countWords expects a string');
  const trimmed = input.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}
