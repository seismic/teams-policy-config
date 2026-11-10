/**
 * Regression tests for OS command injection (CWE-78):
 *   MTGINGEST-5914  user / group search text
 *   MTGINGEST-5915  CSV-imported emails -> PowerShell source
 *   MTGINGEST-5918  CSV-imported emails -> az.cmd / cmd.exe on Windows
 */
import { describe, expect, it } from 'vitest';
import {
  SEARCH_TEXT_ENV_VAR,
  buildEmailLookupScript,
  buildGroupSearchScripts,
  buildUserSearchScripts,
  toSafePage,
} from '../util/search-scripts';
import { assertEmail, isValidEmail, isValidSearchText, psSingleQuote } from '../util/validate';

const UNICODE_QUOTES = ['\u2018', '\u2019', '\u201A', '\u201B'];
const ALL_QUOTES = ["'", ...UNICODE_QUOTES];
const PS_QUOTE = new Set(ALL_QUOTES);

/**
 * Minimal model of PowerShell's single-quoted string tokenizer: a quote char ends the
 * literal unless the next char is also a quote char (then it is a literal quote).
 * Returns the literal's value and the index just past its closing quote.
 */
function parsePsSingleQuoted(src: string): { value: string; end: number } {
  if (!PS_QUOTE.has(src[0])) throw new Error('not a literal');
  let value = '';
  let i = 1;
  while (i < src.length) {
    const c = src[i];
    if (PS_QUOTE.has(c)) {
      if (i + 1 < src.length && PS_QUOTE.has(src[i + 1])) {
        value += src[i + 1];
        i += 2;
        continue;
      }
      return { value, end: i + 1 };
    }
    value += c;
    i += 1;
  }
  throw new Error('unterminated literal');
}

const HOSTILE_SEARCH = [
  "'; Remove-Item -Recurse C:\\ ; '",
  '\u2018; calc.exe; \u2018',
  '\u2019; calc.exe; \u2019',
  '\u201A; calc.exe; \u201A',
  '\u201B; calc.exe; \u201B',
  "x'.ToLower(); $(calc.exe); '",
  '$(calc.exe)',
  '`$(calc.exe)`',
  "\u2019$(calc.exe)\u2019;`n#",
  "a'b\u2019c; $(whoami) `whoami` | iex",
];

describe('psSingleQuote — shared PowerShell quoting helper', () => {
  it.each(ALL_QUOTES)('doubles the quote character U+%#x so it cannot terminate the literal', (q) => {
    const hostile = `a${q};calc.exe;${q}b`;
    const quoted = psSingleQuote(hostile);
    const { value, end } = parsePsSingleQuoted(quoted);
    expect(end).toBe(quoted.length); // literal spans the whole output: nothing escapes
    expect(value).toBe(hostile); // and round-trips as data
  });

  it('keeps ;, $(), backticks and | inert inside the literal', () => {
    const hostile = "x; $(calc) `calc` | iex #";
    const quoted = psSingleQuote(hostile);
    expect(parsePsSingleQuoted(quoted)).toEqual({ value: hostile, end: quoted.length });
  });

  it('rejects control characters instead of embedding them', () => {
    for (const bad of ['a\nb', 'a\rb', 'a\u0000b', 'a\u2028b', 'a\u001Bb']) {
      expect(() => psSingleQuote(bad)).toThrow();
    }
  });
});

describe('isValidSearchText', () => {
  it('accepts names with ASCII and typographic apostrophes', () => {
    for (const name of ["O'Brien", 'O\u2019Brien', 'D\u2018Souza', 'Smith\u201A Jr', 'Al\u201Bi', 'José Müller']) {
      expect(isValidSearchText(name)).toBe(true);
    }
  });

  it('rejects control characters', () => {
    expect(isValidSearchText('a\nb')).toBe(false);
    expect(isValidSearchText('a\u0000b')).toBe(false);
    expect(isValidSearchText('a\u2028b')).toBe(false);
  });
});

describe.each([
  ['user', buildUserSearchScripts],
  ['group', buildGroupSearchScripts],
] as const)('%s search scripts (page + count)', (_kind, build) => {
  const baseline = build('baseline', 0);

  it.each(HOSTILE_SEARCH)('never contains the search text in script source: %s', (payload) => {
    const { page, total } = build(payload, 0);
    for (const spec of [page, total]) {
      const source = spec.commands.join('\n');
      expect(source).not.toContain(payload);
      for (const frag of ['calc.exe', 'whoami', 'Remove-Item']) expect(source).not.toContain(frag);
      expect(spec.env).toEqual({ [SEARCH_TEXT_ENV_VAR]: payload.trim() });
    }
  });

  it.each(HOSTILE_SEARCH)('script structure is identical regardless of input: %s', (payload) => {
    const { page, total } = build(payload, 0);
    expect(page.commands).toEqual(baseline.page.commands);
    expect(total.commands).toEqual(baseline.total.commands);
  });

  it('reads the text only from the environment', () => {
    const { page, total } = build("O'Brien", 0);
    expect(page.commands.join('\n')).toContain(`$env:${SEARCH_TEXT_ENV_VAR}`);
    expect(total.commands.join('\n')).toContain(`$env:${SEARCH_TEXT_ENV_VAR}`);
  });

  it.each(["O'Brien", 'O\u2019Brien', 'D\u2018Souza', 'Smith\u201A', 'X\u201BY'])(
    'passes legitimate name %s through unchanged as data',
    (name) => {
      const { page, total } = build(name, 2);
      expect(page.env[SEARCH_TEXT_ENV_VAR]).toBe(name);
      expect(total.env[SEARCH_TEXT_ENV_VAR]).toBe(name);
    }
  );

  it('empty text produces data-free scripts', () => {
    const { page, total } = build('   ', 0);
    expect(page.env).toEqual({});
    expect(total.env).toEqual({});
    expect(page.commands.join('\n')).not.toContain('$env:');
  });

  it('rejects control characters and oversized text', () => {
    expect(() => build('a\nb', 0)).toThrow();
    expect(() => build('A'.repeat(201), 0)).toThrow();
    expect(() => build(undefined, 0)).toThrow();
  });

  it('only numeric paging values reach the script', () => {
    const { page } = build('x', '1; calc' as unknown as number);
    expect(page.commands.join('\n')).not.toContain('calc');
    expect(page.commands.join('\n')).toContain('-Skip 0 ');
    expect(toSafePage(3)).toBe(3);
    expect(toSafePage(-1)).toBe(0);
    expect(toSafePage(Infinity)).toBe(0);
    expect(toSafePage(1e300)).toBeLessThanOrEqual(100000);
  });
});

describe('isValidEmail / assertEmail — strict allowlist', () => {
  const legit = [
    'user@seismic.com',
    'first.last+tag@sub.domain.org',
    "o'brien@seismic.com",
    'user_name-1@my-domain.co.uk',
    'guest_partner.com#EXT#@tenant.onmicrosoft.com',
  ];
  it.each(legit)('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
    expect(assertEmail(email)).toBe(email);
  });

  const hostile = [
    ...UNICODE_QUOTES.map((q) => `a${q};calc@x.com`),
    ...UNICODE_QUOTES.map((q) => `a@x.com${q}`),
    ...UNICODE_QUOTES.map((q) => `${q}a@x.com`),
    "a';calc;'@x.com",
    'a;calc@x.com',
    'a$(calc)@x.com',
    'a`calc`@x.com',
    'a|calc@x.com',
    'a&calc@x.com',
    'a<b@x.com',
    'a>b@x.com',
    'a^b@x.com',
    'a%PATH%@x.com',
    'a"b@x.com',
    'a b@x.com',
    'a@x.com\n',
    'a@x.com\nGet-Process',
    'a@x.com\u2028',
    '-h@x.com',
    'a@x.c;om',
    'a@x.com & calc',
    'a@x!.com',
    '(a)@x.com',
    'a\\b@x.com',
    'a,b@x.com',
    'a=b@x.com',
    'a@@x.com',
    'a@x',
    'a@.com',
    'a@x..com',
    `${'a'.repeat(65)}@x.com`,
    `a@${'b'.repeat(250)}.com`,
  ];
  it.each(hostile)('rejects %j', (email) => {
    expect(isValidEmail(email)).toBe(false);
    expect(() => assertEmail(email)).toThrow();
  });

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 42, {}, ['a@x.com']]) expect(isValidEmail(v)).toBe(false);
  });
});

describe('buildEmailLookupScript', () => {
  it('returns null for an empty list', () => {
    expect(buildEmailLookupScript([])).toBeNull();
    expect(buildEmailLookupScript(['  ', ''])).toBeNull();
    expect(buildEmailLookupScript(undefined)).toBeNull();
  });

  it('embeds legitimate emails (deduped, lower-cased) via psSingleQuote', () => {
    const r = buildEmailLookupScript(['User@Seismic.com', 'user@seismic.com', "O'Brien@seismic.com"])!;
    expect(r.emails).toEqual(['user@seismic.com', "o'brien@seismic.com"]);
    expect(r.commands[0]).toBe("$targetEmails = @('user@seismic.com', 'o''brien@seismic.com')");
  });

  it.each([
    ...UNICODE_QUOTES.map((q) => `a${q}, $(calc); ${q}@x.com`),
    "x'); calc; ('@x.com",
    'a;calc@x.com',
    'a$(calc)@x.com',
    'a`calc`@x.com',
    'a|calc@x.com',
  ])('throws before producing any script for %j', (bad) => {
    expect(() => buildEmailLookupScript(['good@seismic.com', bad])).toThrow();
  });

  it('invalid values never appear in generated output', () => {
    let leaked = '';
    try {
      buildEmailLookupScript(['good@seismic.com', 'evil;calc@x.com']);
    } catch (e) {
      leaked = String((e as Error).message);
    }
    expect(leaked).not.toContain('evil');
  });

  it('script text is the same shape for any set of valid emails, apart from the list', () => {
    const a = buildEmailLookupScript(['a@x.com'])!.commands.slice(1);
    const b = buildEmailLookupScript(['b@y.org', 'c.d@z.io'])!.commands.slice(1);
    expect(a).toEqual(b);
  });

  describe('Windows: az resolves to az.cmd and is re-parsed by cmd.exe', () => {
    // On Windows `Get-Command 'az'` resolves to az.cmd; the args we pass to it are re-parsed
    // by cmd.exe, so none of its metacharacters may ever reach the invocation.
    const CMD_META = /[&|<>^%"!()]/;
    const emails = [
      'user@seismic.com',
      "o'brien@seismic.com",
      'first.last+tag@sub.domain.org',
      'guest_partner.com#EXT#@tenant.onmicrosoft.com',
    ];

    it('values containing cmd metacharacters are rejected before execution', () => {
      for (const ch of ['&', '|', '<', '>', '^', '%', '"']) {
        expect(() => buildEmailLookupScript([`a${ch}calc@x.com`])).toThrow();
        expect(() => buildEmailLookupScript([`a@x.com${ch}calc`])).toThrow();
      }
      expect(() => buildEmailLookupScript(['a@x.com & calc.exe'])).toThrow();
      expect(() => buildEmailLookupScript(['a@x.com" & calc.exe & "'])).toThrow();
      expect(() => buildEmailLookupScript(['%COMSPEC%@x.com'])).toThrow();
    });

    it('accepted emails contain no cmd.exe metacharacter', () => {
      const { emails: accepted } = buildEmailLookupScript(emails)!;
      for (const e of accepted) expect(e).not.toMatch(CMD_META);
    });

    it('the only caller-controlled argument to az is the $email variable, behind an in-script guard', () => {
      const { commands } = buildEmailLookupScript(emails)!;
      const azCalls = commands.filter((c) => c.includes('$azCli'));
      expect(azCalls).toHaveLength(1);
      expect(azCalls[0]).toContain('--id $email ');
      // Everything else on the az line is static text.
      const variables = azCalls[0].match(/\$[A-Za-z]+/g) ?? [];
      expect(variables.sort()).toEqual(['$azCli', '$email', '$null', '$userJson']);
      expect(azCalls[0]).not.toContain('`');
      const guardIdx = commands.findIndex((c) => c.includes('-notmatch $emailGuard'));
      const callIdx = commands.findIndex((c) => c.includes('$azCli'));
      expect(guardIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeLessThan(callIdx);
      // The guard regex (a literal in the script) is anchored with \A...\z and excludes metacharacters.
      const guardLine = commands.find((c) => c.startsWith('$emailGuard = '))!;
      const guard = parsePsSingleQuoted(guardLine.slice('$emailGuard = '.length)).value;
      expect(guard.startsWith('\\A(?:')).toBe(true);
      expect(guard.endsWith(')\\z')).toBe(true);
      const jsGuard = new RegExp(guard.replace('\\A', '^').replace('\\z', '$'));
      for (const e of emails) expect(jsGuard.test(e)).toBe(true);
      for (const bad of ['a&b@x.com', 'a|b@x.com', 'a^b@x.com', 'a%b@x.com', 'a"b@x.com', 'a<b@x.com', 'a>b@x.com']) {
        expect(jsGuard.test(bad)).toBe(false);
      }
    });
  });
});
