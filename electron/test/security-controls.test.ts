/**
 * Security controls test suite — renderer-loads-only-local-content assumption.
 *
 * Control numbers match the list in the createWindow() JSDoc in window.ts:
 *
 *   Controls 1–3. SECURE_WEB_PREFERENCES + buildSecureWebPreferences() — the
 *                  hardened sandbox flags (sandbox/contextIsolation/nodeIntegration)
 *                  and the webPreferences object actually wired into the BrowserWindow.
 *   Control  4.   isLocalUrl() — logic behind the will-navigate guard
 *   Control  5.   resolveNewWindowAction() — the setWindowOpenHandler decision:
 *                  deny every new window; forward only https:// to the system browser.
 *   Control  6.   DEV_CSP / PROD_CSP — CSP directive completeness;
 *                  PROD_CSP parity with index.html meta tag verified here.
 *   (Additional)  IPC validators — payload allowlisting on every inbound channel
 *                  (orthogonal to the local-content assumption; included because
 *                  the same test run covers the full IPC surface).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_CSP, PROD_CSP, SECURE_WEB_PREFERENCES } from '../util/security-constants';
import { isLocalUrl } from '../util/url';
import { buildSecureWebPreferences, resolveNewWindowAction } from '../util/window-security';
import {
  EMAIL_BATCH_LIMIT,
  isValidEmail,
  isValidGuid,
  isValidPolicyName,
  isValidSearchText,
} from '../util/validate';

// ---------------------------------------------------------------------------
// Controls 1, 2, 3 — BrowserWindow webPreferences: sandbox, contextIsolation, nodeIntegration
// ---------------------------------------------------------------------------
describe('SECURE_WEB_PREFERENCES — BrowserWindow sandbox flags', () => {
  it('disables nodeIntegration', () => {
    expect(SECURE_WEB_PREFERENCES.nodeIntegration).toBe(false);
  });

  it('enables contextIsolation', () => {
    expect(SECURE_WEB_PREFERENCES.contextIsolation).toBe(true);
  });

  it('enables sandbox', () => {
    expect(SECURE_WEB_PREFERENCES.sandbox).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Controls 1–3 (wiring) — buildSecureWebPreferences(): the webPreferences object
// actually passed to new BrowserWindow(). Proves the hardened flags are applied,
// not merely defined in isolation.
// ---------------------------------------------------------------------------
describe('buildSecureWebPreferences — webPreferences wired into BrowserWindow', () => {
  const prefs = buildSecureWebPreferences('/path/to/preload.js');

  it('applies the hardened sandbox flags', () => {
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.sandbox).toBe(true);
  });

  it('sets the preload bridge path', () => {
    expect(prefs.preload).toBe('/path/to/preload.js');
  });

  it('includes every SECURE_WEB_PREFERENCES flag (no hardening silently dropped)', () => {
    for (const key of Object.keys(SECURE_WEB_PREFERENCES) as Array<keyof typeof SECURE_WEB_PREFERENCES>) {
      expect(prefs[key]).toBe(SECURE_WEB_PREFERENCES[key]);
    }
  });

  it('returns a fresh object so the shared constant cannot be mutated', () => {
    expect(buildSecureWebPreferences('/p/preload.js')).not.toBe(SECURE_WEB_PREFERENCES);
  });
});

// ---------------------------------------------------------------------------
// Control 6 — Content-Security-Policy: required directives + index.html parity
// ---------------------------------------------------------------------------
function parseCspDirectives(csp: string): Record<string, string> {
  return Object.fromEntries(
    csp.split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values.join(' ')];
    })
  );
}

describe('DEV_CSP — Content-Security-Policy for the Vite dev server', () => {
  const directives = parseCspDirectives(DEV_CSP);

  it('blocks plugins and embedded objects (object-src none)', () => {
    expect(directives['object-src']).toBe("'none'");
  });

  it('restricts base URI to self (prevents base-tag hijacking)', () => {
    expect(directives['base-uri']).toBe("'self'");
  });

  it('blocks form submissions to external origins', () => {
    expect(directives['form-action']).toBe("'none'");
  });

  it('does not allow eval() in scripts (no unsafe-eval)', () => {
    expect(directives['script-src']).not.toContain('unsafe-eval');
  });
});

describe('PROD_CSP — Content-Security-Policy for production file:// loads', () => {
  const directives = parseCspDirectives(PROD_CSP);

  it('blocks plugins and embedded objects (object-src none)', () => {
    expect(directives['object-src']).toBe("'none'");
  });

  it('restricts scripts to self only (no unsafe-inline, no unsafe-eval)', () => {
    expect(directives['script-src']).toBe("'self'");
  });

  it('restricts base URI to self (prevents base-tag hijacking)', () => {
    expect(directives['base-uri']).toBe("'self'");
  });

  it('blocks form submissions to external origins', () => {
    expect(directives['form-action']).toBe("'none'");
  });

  it('PROD_CSP matches the <meta http-equiv="Content-Security-Policy"> tag in index.html', () => {
    const htmlPath = path.resolve(__dirname, '../../index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const match = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    expect(match, 'index.html must contain a Content-Security-Policy meta tag').not.toBeNull();
    expect(match![1]).toBe(PROD_CSP);
  });
});

// ---------------------------------------------------------------------------
// Control 4 — will-navigate guard: isLocalUrl()
// (Control 5 — setWindowOpenHandler — is tested separately via
//  resolveNewWindowAction() further below.)
// ---------------------------------------------------------------------------
describe('isLocalUrl — navigation guard (will-navigate + setWindowOpenHandler)', () => {
  describe('allowed: local origins only', () => {
    it('allows file:// (production bundle)', () => {
      expect(isLocalUrl('file:///Users/foo/app/dist/index.html')).toBe(true);
    });

    it('allows http://localhost (Vite dev server)', () => {
      expect(isLocalUrl('http://localhost:5173')).toBe(true);
      expect(isLocalUrl('http://localhost:5173/some/path?q=1')).toBe(true);
    });

    it('allows https://localhost', () => {
      expect(isLocalUrl('https://localhost')).toBe(true);
    });
  });

  describe('blocked: external origins', () => {
    it('blocks http:// to a remote host', () => {
      expect(isLocalUrl('http://example.com')).toBe(false);
    });

    it('blocks https:// to a remote host', () => {
      expect(isLocalUrl('https://docs.seismic.com/some/page')).toBe(false);
    });

    it('blocks http:// to a host that starts with "localhost" but is not localhost', () => {
      expect(isLocalUrl('http://localhost.evil.com')).toBe(false);
    });

    it('blocks data: URLs (potential XSS vector)', () => {
      expect(isLocalUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    });

    it('blocks javascript: pseudo-URLs', () => {
      expect(isLocalUrl('javascript:alert(1)')).toBe(false);
    });

    it('blocks blob: URLs', () => {
      expect(isLocalUrl('blob:http://localhost/fake')).toBe(false);
    });
  });

  describe('blocked: invalid / malformed URLs', () => {
    it('blocks empty string', () => {
      expect(isLocalUrl('')).toBe(false);
    });

    it('blocks plain text', () => {
      expect(isLocalUrl('not a url')).toBe(false);
    });

    it('blocks a URL with only whitespace', () => {
      expect(isLocalUrl('   ')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Control 5 — resolveNewWindowAction(): the setWindowOpenHandler decision.
// Deny every new window; forward only https:// links to the system browser.
// ---------------------------------------------------------------------------
describe('resolveNewWindowAction — setWindowOpenHandler decision', () => {
  it('denies every new window regardless of scheme', () => {
    expect(resolveNewWindowAction('https://learn.microsoft.com').action).toBe('deny');
    expect(resolveNewWindowAction('http://example.com').action).toBe('deny');
    expect(resolveNewWindowAction('file:///etc/passwd').action).toBe('deny');
    expect(resolveNewWindowAction('not a url').action).toBe('deny');
  });

  it('forwards https:// links to the system browser', () => {
    expect(resolveNewWindowAction('https://learn.microsoft.com/teams')).toEqual({
      action: 'deny',
      openExternal: 'https://learn.microsoft.com/teams',
    });
  });

  it('does not open non-https schemes externally', () => {
    expect(resolveNewWindowAction('http://example.com').openExternal).toBeNull();
    expect(resolveNewWindowAction('file:///etc/passwd').openExternal).toBeNull();
    expect(resolveNewWindowAction('data:text/html,<script>alert(1)</script>').openExternal).toBeNull();
    expect(resolveNewWindowAction('javascript:alert(1)').openExternal).toBeNull();
  });

  it('denies and opens nothing for malformed URLs', () => {
    expect(resolveNewWindowAction('')).toEqual({ action: 'deny', openExternal: null });
    expect(resolveNewWindowAction('   ')).toEqual({ action: 'deny', openExternal: null });
  });
});

// ---------------------------------------------------------------------------
// Additional — IPC payload validators (main-process input allowlisting)
// ---------------------------------------------------------------------------
describe('isValidPolicyName — grant-policy IPC channel', () => {
  it('accepts a typical Teams policy name', () => {
    expect(isValidPolicyName('Teams-Meeting-Policy')).toBe(true);
    expect(isValidPolicyName('My Policy 1.0')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidPolicyName('')).toBe(false);
  });

  it('rejects names over 64 characters', () => {
    expect(isValidPolicyName('A'.repeat(65))).toBe(false);
  });

  it('rejects shell-injection characters', () => {
    expect(isValidPolicyName('Policy; rm -rf /')).toBe(false);
    expect(isValidPolicyName('Policy$(id)')).toBe(false);
    expect(isValidPolicyName('Policy`id`')).toBe(false);
    expect(isValidPolicyName('Policy&&evil')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isValidPolicyName(null)).toBe(false);
    expect(isValidPolicyName(undefined)).toBe(false);
    expect(isValidPolicyName(42)).toBe(false);
    expect(isValidPolicyName({ policyName: 'ok' })).toBe(false);
  });
});

describe('isValidGuid — group-id validation in grant-policy IPC channel', () => {
  it('accepts a well-formed Azure AD object id', () => {
    expect(isValidGuid('8628b04c-a0f9-458c-b88c-ebc68652cf57')).toBe(true);
  });

  it('rejects a GUID with extra characters', () => {
    expect(isValidGuid('8628b04c-a0f9-458c-b88c-ebc68652cf57x')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidGuid('')).toBe(false);
  });

  it('rejects a plain word', () => {
    expect(isValidGuid('admin')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isValidGuid(null)).toBe(false);
    expect(isValidGuid(undefined)).toBe(false);
  });
});

describe('isValidSearchText — search-users / search-groups IPC channels', () => {
  it('accepts a short query', () => {
    expect(isValidSearchText('john')).toBe(true);
    expect(isValidSearchText('')).toBe(true);  // empty = "list all", valid
  });

  it('accepts a query at the exact limit', () => {
    expect(isValidSearchText('A'.repeat(200))).toBe(true);
  });

  it('rejects a query over the limit', () => {
    expect(isValidSearchText('A'.repeat(201))).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isValidSearchText(null)).toBe(false);
    expect(isValidSearchText(42)).toBe(false);
  });
});

describe('isValidEmail — search-users-by-emails IPC channel', () => {
  it('accepts a well-formed address', () => {
    expect(isValidEmail('user@seismic.com')).toBe(true);
    expect(isValidEmail('first.last+tag@sub.domain.org')).toBe(true);
  });

  it('rejects an address without @', () => {
    expect(isValidEmail('notanemail')).toBe(false);
  });

  it('rejects an address without a domain part', () => {
    expect(isValidEmail('user@')).toBe(false);
  });

  it('rejects an address without a TLD', () => {
    expect(isValidEmail('user@domain')).toBe(false);
  });

  it('rejects an address with spaces', () => {
    expect(isValidEmail('user @seismic.com')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });
});

describe('EMAIL_BATCH_LIMIT — batch size cap on search-users-by-emails', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(EMAIL_BATCH_LIMIT)).toBe(true);
    expect(EMAIL_BATCH_LIMIT).toBeGreaterThan(0);
  });

  it('is capped at a reasonable ceiling (≤ 500)', () => {
    expect(EMAIL_BATCH_LIMIT).toBeLessThanOrEqual(500);
  });
});
