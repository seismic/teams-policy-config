export const POLICY_TARGET_TYPE = {
    USER: 'user',
    GROUP: 'group',
    GLOBAL: 'global',
} as const;

export type PolicyTargetType = typeof POLICY_TARGET_TYPE[keyof typeof POLICY_TARGET_TYPE];
