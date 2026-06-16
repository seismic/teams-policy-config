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

/**
 * Quotes a value as a PowerShell single-quoted string literal.
 *
 * Inside single quotes PowerShell does NOT expand variables, $(...) subexpressions,
 * or backtick escapes; the only special character is the single quote itself, which
 * is escaped by doubling it. This is the canonical safe way to embed an arbitrary
 * string in a PowerShell command and the same pattern already used for users/emails
 * in commands.ts.
 */
export function psSingleQuote(value: string): string {
    return `'${String(value).replace(/'/g, "''")}'`;
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
 * Returns the trimmed group id if it is a valid GUID, otherwise throws.
 */
export function assertGroupId(value: unknown): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!GUID_RE.test(trimmed)) {
        throw new Error(`Invalid group id "${trimmed}". Expected an Azure AD object id (GUID).`);
    }
    return trimmed;
}
