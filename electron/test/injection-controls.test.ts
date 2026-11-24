import { describe, expect, it } from 'vitest';
import { isValidUserPrincipalName, assertEmail, assertSearchText, isValidEmail, isValidSearchText, psSingleQuote } from '../util/validate';

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

describe('az argument / email hardening', () => {
  it('rejects option-like and cmd.exe-sensitive values', async () => {
    const { assertAzArgText } = await import('../util/validate');
    expect(isValidEmail('-oops@example.com')).toBe(false);
    expect(isValidEmail('a%PATH%@example.com')).toBe(false);
    for (const bad of ['a&calc', 'a"b', 'a|b', 'a^b', 'a%b', 'a$(x)', 'a`b']) {
      expect(() => assertAzArgText(bad)).toThrow();
    }
    expect(assertAzArgText(" O'Brien ")).toBe("O'Brien");
  });
});

describe('isValidUserPrincipalName', () => {
  it('accepts guest and apostrophe UPNs, rejects non-strings and oversized values', () => {
    expect(isValidUserPrincipalName('john_example.com#EXT#@contoso.onmicrosoft.com')).toBe(true);
    expect(isValidUserPrincipalName("o'brien@contoso.com")).toBe(true);
    expect(isValidUserPrincipalName({ toString: () => 'a@b.com' })).toBe(false);
    expect(isValidUserPrincipalName('no-at-sign')).toBe(false);
    expect(isValidUserPrincipalName('a@b.com\n; calc')).toBe(false);
    expect(isValidUserPrincipalName('a'.repeat(400) + '@b.com')).toBe(false);
  });
});
