import SuccessIndicator from "../components/SuccessIndicator";
import { POLICY_TARGET_TYPE } from '../policyTypes';

type UserGrantDetail = {
    user: string;
    policyName: string;
    status: 'applied-target-policy' | 'added-app-id-existing-policy' | 'skipped-already-has-app-id';
    message: string;
};

type GrantResultData = {
    targetType?: string;
    policyName?: string;
    details?: UserGrantDetail[];
    targets?: string[];
};

type CompleteStepProps = {
    isValid: boolean;
    onCompleted: () => void;
    grantResult?: GrantResultData | null;
};

function toReadableStatus(status: UserGrantDetail['status']): string {
    switch (status) {
        case 'added-app-id-existing-policy':
            return 'Assigned policy';
        case 'skipped-already-has-app-id':
            return 'Already had policy';
        case 'applied-target-policy':
        default:
            return 'Assigned policy';
    }
}

function toStatusDescription(status: UserGrantDetail['status'], targetType: typeof POLICY_TARGET_TYPE.USER | typeof POLICY_TARGET_TYPE.GROUP): string {
    const targetLabel = targetType === POLICY_TARGET_TYPE.GROUP ? 'groups' : 'users';
    switch (status) {
        case 'added-app-id-existing-policy':
            return `These ${targetLabel} had a policy applied to them.`;
        case 'skipped-already-has-app-id':
            return `These ${targetLabel} already had an existing policy assigned and no changes were needed.`;
        case 'applied-target-policy':
        default:
            return `These ${targetLabel} had a policy applied to them.`;
    }
}

export default function CompleteStep({ grantResult }: CompleteStepProps) {
    const details = Array.isArray(grantResult?.details) ? grantResult.details : [];
    const targets = Array.isArray(grantResult?.targets) ? grantResult.targets : [];
    const statusOrder: UserGrantDetail['status'][] = [
        'applied-target-policy',
        'added-app-id-existing-policy',
        'skipped-already-has-app-id',
    ];
    const groupedByStatus = statusOrder
        .map((status) => ({
            status,
            users: details
                .filter((item) => item.status === status)
                .map((item) => item.user),
        }))
        .filter((group) => group.users.length > 0);

    const isUserGrant = grantResult?.targetType === POLICY_TARGET_TYPE.USER;
    const isGroupGrant = grantResult?.targetType === POLICY_TARGET_TYPE.GROUP;
    const shouldShowStatusGroups = groupedByStatus.length > 0 || (isGroupGrant && targets.length > 0);
    const statusGroups = groupedByStatus.length > 0
        ? groupedByStatus
        : (isGroupGrant
            ? [{ status: 'applied-target-policy' as UserGrantDetail['status'], users: targets }]
            : []);

    const hasUserFallbackTargets = isUserGrant && groupedByStatus.length === 0 && targets.length > 0;
    const shouldShowTargets = !isUserGrant && !isGroupGrant && targets.length > 0;

    return (
        <div className="step-content">
            <SuccessIndicator
                text="The policy was successfully applied"
            />

            {shouldShowStatusGroups && (
                <div style={{ marginTop: 16 }}>
                    {statusGroups.map((group) => (
                        <div key={group.status} style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 600, marginBottom: 2 }}>
                                {toReadableStatus(group.status)} ({group.users.length})
                            </div>
                            <div style={{ fontWeight: 400, fontSize: 12, color: '#535B64', marginBottom: 6 }}>
                                {toStatusDescription(group.status, isGroupGrant ? POLICY_TARGET_TYPE.GROUP : POLICY_TARGET_TYPE.USER)}
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 20 }}>
                                {group.users.map((user) => (
                                    <li key={`${group.status}-${user}`} style={{ marginBottom: 4 }}>
                                        {user}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            {shouldShowTargets && (
                <div style={{ marginTop: 16 }}>
                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>
                            Assigned targets ({targets.length})
                        </div>
                        <div style={{ fontWeight: 400, fontSize: 12, color: '#535B64', marginBottom: 6 }}>
                            These targets had a policy applied to them.
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                            {targets.map((target) => (
                                <li key={`target-${target}`} style={{ marginBottom: 4 }}>
                                    {target}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}

            {hasUserFallbackTargets && (
                <div style={{ marginTop: 16 }}>
                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>
                            Assigned users ({targets.length})
                        </div>
                        <div style={{ fontWeight: 400, fontSize: 12, color: '#535B64', marginBottom: 6 }}>
                            These users had a policy applied to them.
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                            {targets.map((target) => (
                                <li key={`user-target-${target}`} style={{ marginBottom: 4 }}>
                                    {target}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}