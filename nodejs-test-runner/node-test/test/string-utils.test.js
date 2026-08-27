// node-test/test/string-utils.test.js
// Same suite as jest/ and vitest/. Run with: `npm run test:node`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  truncate,
  isPalindrome,
  countWords,
} from '../../src/string-utils.js';

describe('slugify', () => {
  it('converts a basic sentence', () => {
    assert.equal(slugify('Hello World'), 'hello-world');
  });

  it('lowercases and trims', () => {
    assert.equal(slugify('  MIXED case  '), 'mixed-case');
  });

  it('strips punctuation', () => {
    assert.equal(slugify('Hello, World!'), 'hello-world');
  });

  it('collapses runs of separators', () => {
    assert.equal(slugify('foo___bar   baz'), 'foo-bar-baz');
  });

  it('removes leading and trailing dashes', () => {
    assert.equal(slugify('---hello---'), 'hello');
  });

  it('strips diacritics', () => {
    assert.equal(slugify('Café résumé'), 'cafe-resume');
  });

  it('returns empty string for empty input', () => {
    assert.equal(slugify(''), '');
  });

  it('returns empty string for whitespace-only input', () => {
    assert.equal(slugify('   \t\n'), '');
  });

  it('throws TypeError on non-string input', () => {
    assert.throws(() => slugify(123), TypeError);
  });
});

describe('truncate', () => {
  it('returns input unchanged when shorter than max', () => {
    assert.equal(truncate('hi', 10), 'hi');
  });

  it('truncates and appends ellipsis when longer than max', () => {
    assert.equal(truncate('Hello world', 6), 'Hello…');
  });

  it('handles max = 1', () => {
    assert.equal(truncate('Hello', 1), '…');
  });

  it('throws on non-string input', () => {
    assert.throws(() => truncate(42, 5), TypeError);
  });

  it('throws on invalid max', () => {
    assert.throws(() => truncate('hi', 0), RangeError);
    assert.throws(() => truncate('hi', -1), RangeError);
  });

  it('treats max = 30 as default', () => {
    const long = 'a'.repeat(50);
    const out = truncate(long);
    assert.equal(out.length, 30);
  });
});

describe('isPalindrome', () => {
  it('detects simple palindromes', () => {
    assert.equal(isPalindrome('racecar'), true);
  });

  it('handles mixed case', () => {
    assert.equal(isPalindrome('RaceCar'), true);
  });

  it('ignores punctuation and spaces', () => {
    assert.equal(isPalindrome('A man, a plan, a canal: Panama'), true);
  });

  it('returns false for non-palindromes', () => {
    assert.equal(isPalindrome('hello'), false);
  });

  it('returns true for empty string', () => {
    assert.equal(isPalindrome(''), true);
  });

  it('returns true for whitespace-only string', () => {
    assert.equal(isPalindrome('   '), true);
  });

  it('throws on non-string input', () => {
    assert.throws(() => isPalindrome(null), TypeError);
  });
});

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    assert.equal(countWords('one two three'), 3);
  });

  it('collapses multiple spaces', () => {
    assert.equal(countWords('a    b   c'), 3);
  });

  it('returns 0 for empty string', () => {
    assert.equal(countWords(''), 0);
  });

  it('returns 0 for whitespace-only string', () => {
    assert.equal(countWords('   \t\n'), 0);
  });

  it('counts a single word', () => {
    assert.equal(countWords('solo'), 1);
  });

  it('handles leading and trailing whitespace', () => {
    assert.equal(countWords('  hello world  '), 2);
  });

  it('throws on non-string input', () => {
    assert.throws(() => countWords(42), TypeError);
  });
});
