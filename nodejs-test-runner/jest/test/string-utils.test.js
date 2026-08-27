// jest/test/string-utils.test.js
// Same suite as node-test/ and vitest/. Run with: `npm run test:jest`
import {
  slugify,
  truncate,
  isPalindrome,
  countWords,
} from '../../src/string-utils.js';

describe('slugify', () => {
  it('converts a basic sentence', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('lowercases and trims', () => {
    expect(slugify('  MIXED case  ')).toBe('mixed-case');
  });

  it('strips punctuation', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('collapses runs of separators', () => {
    expect(slugify('foo___bar   baz')).toBe('foo-bar-baz');
  });

  it('removes leading and trailing dashes', () => {
    expect(slugify('---hello---')).toBe('hello');
  });

  it('strips diacritics', () => {
    expect(slugify('Café résumé')).toBe('cafe-resume');
  });

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(slugify('   \t\n')).toBe('');
  });

  it('throws TypeError on non-string input', () => {
    expect(() => slugify(123)).toThrow(TypeError);
  });
});

describe('truncate', () => {
  it('returns input unchanged when shorter than max', () => {
    expect(truncate('hi', 10)).toBe('hi');
  });

  it('truncates and appends ellipsis when longer than max', () => {
    expect(truncate('Hello world', 6)).toBe('Hello\u2026');
  });

  it('handles max = 1', () => {
    expect(truncate('Hello', 1)).toBe('\u2026');
  });

  it('throws on non-string input', () => {
    expect(() => truncate(42, 5)).toThrow(TypeError);
  });

  it('throws on invalid max', () => {
    expect(() => truncate('hi', 0)).toThrow(RangeError);
    expect(() => truncate('hi', -1)).toThrow(RangeError);
  });

  it('treats max = 30 as default', () => {
    const long = 'a'.repeat(50);
    const out = truncate(long);
    expect(out.length).toBe(30);
  });
});

describe('isPalindrome', () => {
  it('detects simple palindromes', () => {
    expect(isPalindrome('racecar')).toBe(true);
  });

  it('handles mixed case', () => {
    expect(isPalindrome('RaceCar')).toBe(true);
  });

  it('ignores punctuation and spaces', () => {
    expect(isPalindrome('A man, a plan, a canal: Panama')).toBe(true);
  });

  it('returns false for non-palindromes', () => {
    expect(isPalindrome('hello')).toBe(false);
  });

  it('returns true for empty string', () => {
    expect(isPalindrome('')).toBe(true);
  });

  it('returns true for whitespace-only string', () => {
    expect(isPalindrome('   ')).toBe(true);
  });

  it('throws on non-string input', () => {
    expect(() => isPalindrome(null)).toThrow(TypeError);
  });
});

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('one two three')).toBe(3);
  });

  it('collapses multiple spaces', () => {
    expect(countWords('a    b   c')).toBe(3);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   \t\n')).toBe(0);
  });

  it('counts a single word', () => {
    expect(countWords('solo')).toBe(1);
  });

  it('handles leading and trailing whitespace', () => {
    expect(countWords('  hello world  ')).toBe(2);
  });

  it('throws on non-string input', () => {
    expect(() => countWords(42)).toThrow(TypeError);
  });
});
