/**
 * Allowlisted policy grant types accepted from the renderer.
 *
 * Single source of truth shared between the IPC boundary (electron/main.ts)
 * and the grant logic (electron/teams-setup.ts). Keeping these values in one
 * place ensures the runtime allowlist, the switch in grantAccessPolicy(), and
 * any user-facing messaging cannot drift out of sync.
 */
export enum GrantType {
    User = 'user',
    Group = 'group',
    Global = 'global',
}

/** All valid grant type values, e.g. for allowlist checks and error messages. */
export const GRANT_TYPE_VALUES = Object.values(GrantType);
