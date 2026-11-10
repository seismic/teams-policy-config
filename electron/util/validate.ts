/**
 * Input validation + PowerShell-safe quoting helpers.
 *
 * These guard the PowerShell command layer (electron/commands.ts) against
 * command/code injection (scan finding 1352156). Values that flow into a
 * PowerShell script must be BOTH:
 *   1. allowlist-validated against a strict pattern, AND
 *   2. quoted with psSingleQuote() so they are treated as literal data.
 *
 * Validation is intentionally enforced at the use-site (right before a script
 * is built) — not only at the IPC boundary — because policyName can re-enter
 * the flow from settings.json via getSavedPolicyName(), bypassing the IPC
 * check. See OWASP "OS Command Injection Defense" and "Input Validation".
 */

// Teams CsApplicationAccessPolicy identities in normal use are letters, digits,
// spaces, dots, hyphens and underscores. Keep this strict; widen deliberately.
const POLICY_NAME_RE = /^[A-Za-z0-9 ._-]{1,64}$/;

// Azure AD object id (GUID), e.g. 8628b04c-a0f9-458c-b88c-ebc68652cf57
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Generous upper bound on free-text search queries; rejects obviously oversized payloads.
const SEARCH_TEXT_MAX_LEN = 200;

// Max email addresses accepted per batch request.
export const EMAIL_BATCH_LIMIT = 500;

// Hard cap on a single email / UPN (RFC 5321 path limit).
const EMAIL_MAX_LEN = 254;

// Strict ASCII allowlist for the email / UPN values that are placed into a PowerShell
// script and passed as an argument to `az` (which is `az.cmd` on Windows, re-parsed by
// cmd.exe). The allowlist deliberately EXCLUDES every character that is special to
// PowerShell, cmd.exe or an argv parser: whitespace, quotes of any kind (ASCII and
// Unicode U+2018/2019/201A/201B), ; | & < > ^ % ! ( ) $ ` \ , = { } [ ] and control chars.
//   local part : starts with an alphanumeric/underscore (so it can never be parsed as an
//                option such as `-h`), then letters, digits and . _ + ' # -
//                ('#' covers guest UPNs such as user_domain.com#EXT#@tenant.onmicrosoft.com;
//                 the apostrophe is legitimate, e.g. o'brien@x.com, and is escaped by
//                 psSingleQuote() and is not special to cmd.exe).
//   domain     : dot-separated DNS labels, alphabetic TLD of 2+ chars.
export const EMAIL_PATTERN_SOURCE =
    "[A-Za-z0-9_][A-Za-z0-9._+'#-]{0,63}" +
    '@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}';
const EMAIL_RE = new RegExp(`^(?:${EMAIL_PATTERN_SOURCE})$`);

// C0/C1 control characters plus the Unicode line/paragraph separators.
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

// Every character PowerShell's tokenizer treats as a single-quote inside a '...' literal.
// Only U+0027 is "obviously" a quote; the typographic ones are equivalent to PowerShell.
const POWERSHELL_SINGLE_QUOTE_CHARS_RE = /['\u2018\u2019\u201A\u201B]/g;

/**
 * Quotes a value as a PowerShell single-quoted string literal.
 *
 * This is THE helper for embedding a string in generated PowerShell source; do not
 * hand-roll `.replace(/'/g, "''")` elsewhere. Inside single quotes PowerShell does NOT
 * expand variables, $(...) subexpressions or backtick escapes; the only special
 * characters are the quote characters. PowerShell treats ASCII ' (U+0027) AND the
 * typographic quotes U+2018, U+2019, U+201A and U+201B as quotes, and a doubled quote
 * is a literal quote, so every one of them is doubled.
 *
 * Control characters (incl. NUL, CR/LF, U+2028/2029) are rejected rather than escaped:
 * no legitimate value we embed needs them.
 *
 * Prefer passing free-form user text as DATA (see search-scripts.ts) over embedding it.
 */
export function psSingleQuote(value: string): string {
    const text = String(value);
    if (CONTROL_CHARS_RE.test(text)) {
        throw new Error('Value contains control characters and cannot be used in a PowerShell script.');
    }
    return `'${text.replace(POWERSHELL_SINGLE_QUOTE_CHARS_RE, (quote) => quote + quote)}'`;
}

export function isValidPolicyName(value: unknown): value is string {
    return typeof value === 'string' && POLICY_NAME_RE.test(value.trim());
}

/**
 * Returns the trimmed policy name if valid, otherwise throws.
 * Use at the point a script is built so the settings.json reload path is covered too.
 */
export function assertPolicyName(value: unknown): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!POLICY_NAME_RE.test(trimmed)) {
        throw new Error(
            'Invalid policy name. Allowed characters: letters, numbers, space, dot, hyphen, underscore (max 64).'
        );
    }
    return trimmed;
}

export function isValidGuid(value: unknown): value is string {
    return typeof value === 'string' && GUID_RE.test(value.trim());
}

/**
 * Free-text search. Any printable character is allowed (names legitimately contain
 * apostrophes of every kind), but control characters are not. The text is never
 * interpolated into script source — it is handed to PowerShell as data.
 */
export function isValidSearchText(value: unknown): value is string {
    return typeof value === 'string' && value.length <= SEARCH_TEXT_MAX_LEN && !CONTROL_CHARS_RE.test(value);
}

/**
 * Returns the trimmed search text if valid, otherwise throws. Use at the point a
 * script is built.
 */
export function assertSearchText(value: unknown): string {
    if (typeof value !== 'string' || !isValidSearchText(value)) {
        throw new Error(`Invalid search text. Maximum ${SEARCH_TEXT_MAX_LEN} characters, no control characters.`);
    }
    return value.trim();
}

/**
 * Strict, anchored, length-limited email / UPN allowlist (see EMAIL_PATTERN_SOURCE).
 * Does not trim: callers normalise first, so what is validated is exactly what is used.
 */
export function isValidEmail(value: unknown): value is string {
    return typeof value === 'string' && value.length <= EMAIL_MAX_LEN && EMAIL_RE.test(value);
}

/**
 * Returns the email if valid, otherwise throws (without echoing the value).
 * Enforced at the point of use (searchUsersByEmails / grantPolicyToUser), not only at IPC.
 */
export function assertEmail(value: unknown): string {
    if (!isValidEmail(value)) {
        throw new Error('Invalid email address. Only letters, digits and . _ + \' # - are allowed in the user name.');
    }
    return value;
}

/**
 * Returns the trimmed group id if it is a valid GUID, otherwise throws.
 */
export function assertGroupId(value: unknown): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!GUID_RE.test(trimmed)) {
        throw new Error(`Invalid group id "${trimmed}". Expected an Azure AD object id (GUID).`);
    }
    return trimmed;
}
