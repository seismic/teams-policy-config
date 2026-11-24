import { describe, expect, it } from 'vitest';
import { assertEmail, assertSearchText, isValidEmail, isValidSearchText, psSingleQuote } from '../util/validate';

const SMART_QUOTES = ['‘', '’', '‚', '‛'];

describe('isValidEmail / assertEmail — strict allowlist', () => {
  it('accepts normal addresses and UPNs', () => {
    expect(isValidEmail('first.last+tag@example.co.uk')).toBe(true);
    expect(assertEmail('  user@contoso.com ')).toBe('user@contoso.com');
  });

  it.each([
    ...SMART_QUOTES.map((q) => `a${q};calc@example.com`),
    "a'b@example.com",
    'a;calc@example.com',
    'a$(calc)@example.com',
    'a`calc`@example.com',
    'a|calc@example.com',
    'a b@example.com',
    'a\n@example.com',
    'a@exa mple.com',
  ])('rejects %j', (value) => {
    expect(isValidEmail(value)).toBe(false);
    expect(() => assertEmail(value)).toThrow();
  });
});

describe('psSingleQuote', () => {
  it('doubles ASCII and Unicode single-quote characters', () => {
    expect(psSingleQuote("a'b")).toBe("'a''b'");
    for (const q of SMART_QUOTES) {
      expect(psSingleQuote(`x${q};calc`)).toBe(`'x${q}${q};calc'`);
    }
  });
});

describe('isValidSearchText / assertSearchText', () => {
  it('rejects control characters and oversized input', () => {
    expect(isValidSearchText('ab\ncd')).toBe(false);
    expect(isValidSearchText('a'.repeat(201))).toBe(false);
    expect(() => assertSearchText('a\u0000b')).toThrow();
  });

  it('accepts ordinary names', () => {
    expect(assertSearchText(" O'Brien ")).toBe("O'Brien");
  });
});
