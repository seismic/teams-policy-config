import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    List,
    ListItem,
    ListItemText,
    Radio,
    RadioGroup,
    FormControl,
    FormLabel,
    FormControlLabel,
    Chip,
    CircularProgress,
    Stack,
    Typography,
    Autocomplete,
    Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import TextField from '../components/TextField';
import { Option } from '../components/MultiSelect';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import EntitySelectionDialog from './EntitySelectionDialog';
import './grantPolicyStep.scss';

type UserRecord = {
    Id?: string;
    DisplayName?: string;
    UserPrincipalName?: string;
    id?: string;
    displayName?: string;
    userPrincipalName?: string;
};

type GroupRecord = {
    Id?: string;
    DisplayName?: string;
    id?: string;
    displayName?: string;
};

type GrantTypeSelectionStepProps = {
    isValid: boolean;
    users?: UserRecord[];
    groups?: GroupRecord[];
    usersTotal?: number;
    groupsTotal?: number;
    onValuesChange?: (values: any) => void;
    isSubmitting?: boolean;
    initialType?: string;
    initialUsers?: Option[];
    initialGroups?: Option[];
};

const POLICY_TYPE_OPTIONS = [
    {
        value: 'user',
        label: 'User level',
        tooltip: 'Assign policy per user. Best when you need user-specific targeting or exceptions.'
    },
    {
        value: 'group',
        label: 'Group level',
        tooltip: 'Assign policy to group members. Best for managing policy at team or department scale.'
    },
    {
        value: 'global',
        label: 'Global level',
        tooltip: 'Assign policy tenant-wide to all users. Use with caution for organization-wide rollout.'
    },
];

const POLICY_NOTE_MESSAGE = 'This policy will apply only to users or groups that do not already have an existing policy.';

const ORG_NAME = import.meta.env.VITE_ORG_NAME || null;
const DEFAULT_POLICY_NAME = import.meta.env.VITE_DEFAULT_POLICY_NAME?.trim() || 'Teams-Meeting-Policy';
const USER_PICKER_PAGE_SIZE_FALLBACK = 10;
const GROUP_PICKER_PAGE_SIZE_FALLBACK = 10;

function toUserOption(user: any): Option {
    const value = user?.value || user?.UserPrincipalName || user?.userPrincipalName || user?.Id || user?.id || '';
    const displayName = user?.DisplayName || user?.displayName || user?.label || 'Unknown';

    return {
        value,
        label: user?.label || displayName,
    };
}

function toGroupOption(group: any): Option {
    const value = group?.value || group?.Id || group?.id || '';
    const displayName = group?.DisplayName || group?.displayName || group?.label || 'Unknown';

    return {
        value,
        label: group?.label || displayName
    };
}

function mergeUniqueOptions(existing: Option[], incoming: Option[]): Option[] {
    const map = new Map<string, Option>();
    [...existing, ...incoming].forEach((option) => {
        map.set(String(option.value), option);
    });
    return Array.from(map.values());
}

export default function GrantPolicyStep({ onValuesChange, isSubmitting, initialType, initialUsers, initialGroups }: GrantTypeSelectionStepProps) {
    const [selectedType, setSelectedType] = useState(initialType || 'group');
    const [policyName, setPolicyName] = useState(DEFAULT_POLICY_NAME);
    const hasLoadedSavedPolicyName = useRef(false);
    const [selectedUsers, setSelectedUsers] = useState<Option[]>(initialUsers ?? []);
    const [selectedGroups, setSelectedGroups] = useState<Option[]>(initialGroups ?? []);
    const [uploadedCsvFileName, setUploadedCsvFileName] = useState('');
    const [isCsvResolvingUsers, setIsCsvResolvingUsers] = useState(false);
    const [csvResolvedCount, setCsvResolvedCount] = useState(0);
    const [csvUnresolvedEmails, setCsvUnresolvedEmails] = useState<string[]>([]);
    const [showCsvUnresolvedModal, setShowCsvUnresolvedModal] = useState(false);

    const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
    const [userDialogSearchInput, setUserDialogSearchInput] = useState('');
    const [userDialogQuery, setUserDialogQuery] = useState('');
    const [userDialogPage, setUserDialogPage] = useState(0);
    const [userDialogTotal, setUserDialogTotal] = useState(0);
    const [userDialogPageSize, setUserDialogPageSize] = useState(USER_PICKER_PAGE_SIZE_FALLBACK);
    const [userDialogLoading, setUserDialogLoading] = useState(false);
    const [userDialogOptions, setUserDialogOptions] = useState<Option[]>([]);
    const [modalSelectedUsersMap, setModalSelectedUsersMap] = useState<Record<string, Option>>({});
    const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
    const [groupDialogSearchInput, setGroupDialogSearchInput] = useState('');
    const [groupDialogQuery, setGroupDialogQuery] = useState('');
    const [groupDialogPage, setGroupDialogPage] = useState(0);
    const [groupDialogTotal, setGroupDialogTotal] = useState(0);
    const [groupDialogPageSize, setGroupDialogPageSize] = useState(GROUP_PICKER_PAGE_SIZE_FALLBACK);
    const [groupDialogLoading, setGroupDialogLoading] = useState(false);
    const [groupDialogOptions, setGroupDialogOptions] = useState<Option[]>([]);
    const [modalSelectedGroupsMap, setModalSelectedGroupsMap] = useState<Record<string, Option>>({});

    const selectedCountInModal = useMemo(
        () => Object.keys(modalSelectedUsersMap).length,
        [modalSelectedUsersMap]
    );

    const selectedGroupCountInModal = useMemo(
        () => Object.keys(modalSelectedGroupsMap).length,
        [modalSelectedGroupsMap]
    );

    useEffect(() => {
        let isMounted = true;

        window.electronAPI.getSavedPolicyName?.()
            .then((result) => {
                const savedName = result?.data?.policyName;
                if (!isMounted || typeof savedName !== 'string' || savedName.trim().length === 0) {
                    return;
                }

                setPolicyName(savedName.trim());
            })
            .catch(() => {
                // Ignore persistence read failures and keep default policy value.
            })
            .finally(() => {
                if (isMounted) {
                    hasLoadedSavedPolicyName.current = true;
                }
            });

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (!hasLoadedSavedPolicyName.current) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            window.electronAPI.setSavedPolicyName?.(policyName).catch(() => {
                // Ignore persistence write failures and keep in-memory value.
            });
        }, 300);

        return () => window.clearTimeout(timeoutId);
    }, [policyName]);

    useEffect(() => {
        const values = {
            policyName,
            type: selectedType,
            users: selectedType === 'user' ? selectedUsers : [],
            groups: selectedType === 'group' ? selectedGroups : [],
        };
        onValuesChange?.(values);
    }, [policyName, selectedType, selectedUsers, selectedGroups, onValuesChange]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            const nextQuery = userDialogSearchInput.trim();
            setUserDialogPage(0);
            setUserDialogQuery(nextQuery);
        }, 400);

        return () => window.clearTimeout(timeoutId);
    }, [userDialogSearchInput]);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            const nextQuery = groupDialogSearchInput.trim();
            setGroupDialogPage(0);
            setGroupDialogQuery(nextQuery);
        }, 400);

        return () => window.clearTimeout(timeoutId);
    }, [groupDialogSearchInput]);

    useEffect(() => {
        if (!isUserDialogOpen) {
            return;
        }

        setUserDialogLoading(true);
        window.electronAPI.searchUsers(userDialogQuery, userDialogPage)
            .then((result) => {
                if (!result?.success) {
                    setUserDialogOptions([]);
                    setUserDialogTotal(0);
                    return;
                }

                const searchedUsers = Array.isArray(result?.data?.users)
                    ? result.data.users
                    : [];
                const totalUsers = typeof result?.data?.total === 'number'
                    ? result.data.total
                    : searchedUsers.length;
                const mapped = searchedUsers.map(toUserOption);

                setUserDialogOptions(mapped);
                setUserDialogTotal(totalUsers);
            })
            .catch(() => {
                setUserDialogOptions([]);
                setUserDialogTotal(0);
            })
            .finally(() => setUserDialogLoading(false));
    }, [isUserDialogOpen, userDialogQuery, userDialogPage]);

    useEffect(() => {
        if (!isGroupDialogOpen) {
            return;
        }

        setGroupDialogLoading(true);
        window.electronAPI.searchGroups(groupDialogQuery, groupDialogPage)
            .then((result) => {
                if (!result?.success) {
                    setGroupDialogOptions([]);
                    setGroupDialogTotal(0);
                    return;
                }

                const searchedGroups = Array.isArray(result?.data?.groups)
                    ? result.data.groups
                    : [];
                const totalGroups = typeof result?.data?.total === 'number'
                    ? result.data.total
                    : searchedGroups.length;
                const mapped = searchedGroups.map(toGroupOption);

                setGroupDialogOptions(mapped);
                setGroupDialogTotal(totalGroups);
            })
            .catch(() => {
                setGroupDialogOptions([]);
                setGroupDialogTotal(0);
            })
            .finally(() => setGroupDialogLoading(false));
    }, [isGroupDialogOpen, groupDialogQuery, groupDialogPage]);

    const userDialogPageCount = useMemo(() => {
        if (userDialogTotal <= 0) {
            return 1;
        }

        const safePageSize = userDialogPageSize > 0 ? userDialogPageSize : USER_PICKER_PAGE_SIZE_FALLBACK;
        return Math.max(1, Math.ceil(userDialogTotal / safePageSize));
    }, [userDialogTotal, userDialogPageSize]);

    const groupDialogPageCount = useMemo(() => {
        if (groupDialogTotal <= 0) {
            return 1;
        }

        const safePageSize = groupDialogPageSize > 0 ? groupDialogPageSize : GROUP_PICKER_PAGE_SIZE_FALLBACK;
        return Math.max(1, Math.ceil(groupDialogTotal / safePageSize));
    }, [groupDialogTotal, groupDialogPageSize]);

    const openUserDialog = () => {
        setUserDialogSearchInput('');
        setUserDialogQuery('');
        setUserDialogPage(0);
        const preselectedUsers = selectedUsers.reduce<Record<string, Option>>((acc, option) => {
            acc[String(option.value)] = option;
            return acc;
        }, {});
        setModalSelectedUsersMap(preselectedUsers);
        setIsUserDialogOpen(true);
    };

    const closeUserDialog = () => {
        setIsUserDialogOpen(false);
    };

    const openGroupDialog = () => {
        setGroupDialogSearchInput('');
        setGroupDialogQuery('');
        setGroupDialogPage(0);
        const preselectedGroups = selectedGroups.reduce<Record<string, Option>>((acc, option) => {
            acc[String(option.value)] = option;
            return acc;
        }, {});
        setModalSelectedGroupsMap(preselectedGroups);
        setIsGroupDialogOpen(true);
    };

    const closeGroupDialog = () => {
        setIsGroupDialogOpen(false);
    };

    const toggleModalUserSelection = (option: Option) => {
        const key = String(option.value);
        setModalSelectedUsersMap((prev) => {
            const next = { ...prev };
            if (next[key]) {
                delete next[key];
            } else {
                next[key] = option;
            }
            return next;
        });
    };

    const toggleModalGroupSelection = (option: Option) => {
        const key = String(option.value);
        setModalSelectedGroupsMap((prev) => {
            const next = { ...prev };
            if (next[key]) {
                delete next[key];
            } else {
                next[key] = option;
            }
            return next;
        });
    };

    const selectAllModalUsers = (options: Option[], select: boolean) => {
        setModalSelectedUsersMap((prev) => {
            const next = { ...prev };
            options.forEach((option) => {
                const key = String(option.value);
                if (select) {
                    next[key] = option;
                } else {
                    delete next[key];
                }
            });
            return next;
        });
    };

    const selectAllModalGroups = (options: Option[], select: boolean) => {
        setModalSelectedGroupsMap((prev) => {
            const next = { ...prev };
            options.forEach((option) => {
                const key = String(option.value);
                if (select) {
                    next[key] = option;
                } else {
                    delete next[key];
                }
            });
            return next;
        });
    };

    const handleSaveModalUsers = () => {
        setSelectedUsers(Object.values(modalSelectedUsersMap));
        closeUserDialog();
    };

    const handleSaveModalGroups = () => {
        setSelectedGroups(Object.values(modalSelectedGroupsMap));
        closeGroupDialog();
    };

    // Clean, minimal, consistent with other steps
    return (
        <div className="step-content">
            <div>Grant a Microsoft Teams access policy to selected users or groups. Choose the policy type and select the targets below.</div>
            <div><strong>Note:</strong> During this process, you may be prompted to log in 2-3 times to complete the required authorization steps.</div>
            <form
                className="grant-policy-form"
            >
                <FormControl component="fieldset" sx={{ mb: 1 }}>
                    <FormLabel
                        component="label"
                        htmlFor="policyNameInput"
                        required
                        sx={{
                            color: 'text.primary',
                            '&.Mui-focused': { color: 'text.primary' },
                            '& .MuiFormLabel-asterisk': { color: 'error.main' },
                        }}
                    >
                        Policy Name{' '}
                        <Tooltip title={POLICY_NOTE_MESSAGE} arrow>
                            <span className="grant-policy-policy-note">
                                ({POLICY_NOTE_MESSAGE})
                            </span>
                        </Tooltip>
                    </FormLabel>
                    <TextField
                        id="policyNameInput"
                        name="policyName"
                        value={policyName}
                        onChange={(e) => setPolicyName(e.target.value)}
                        required
                        size="small"
                        placeholder="Policy Name"
                        sx={{ mt: 1 }}
                        disabled={isSubmitting}
                    />
                </FormControl>
                <FormControl component="fieldset" disabled={isSubmitting} sx={{ mb: 1 }}>
                    <FormLabel
                        component="legend"
                        required
                        sx={{
                            color: 'text.primary',
                            '&.Mui-focused': { color: 'text.primary' },
                            '& .MuiFormLabel-asterisk': { color: 'error.main' },
                        }}
                    >
                        Choose how you want to grant the teams policy
                    </FormLabel>
                    <RadioGroup
                        name="type"
                        value={selectedType}
                        onChange={e => setSelectedType(e.target.value)}
                        sx={{ mt: 1 }}
                    >
                        {POLICY_TYPE_OPTIONS.map(option => (
                            <FormControlLabel
                                key={option.value}
                                value={option.value}
                                control={<Radio size="small" />}
                                label={(
                                    <Stack direction="row" spacing={0.75} alignItems="center">
                                        <span>{option.label}</span>
                                        <Tooltip title={option.tooltip} arrow>
                                            <InfoOutlinedIcon fontSize="inherit" sx={{ fontSize: 16, color: 'text.secondary' }} />
                                        </Tooltip>
                                    </Stack>
                                )}
                                sx={{ mb: 0.5 }}
                            />
                        ))}
                    </RadioGroup>
                </FormControl>

                {selectedType === 'user' && (
                    <div className="grant-policy-target-section">
                        <FormControl fullWidth margin="normal" disabled={isSubmitting} required sx={{ mb: 1, mt: 0 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 400 }}>
                                Select users {selectedUsers.length > 0 && `(${selectedUsers.length})`}
                                <span className="grant-policy-required-asterisk">*</span>
                            </Typography>
                            <span className="grant-policy-help-text">
                                Manually select users from Azure, or upload a CSV file with user email addresses. You can create the CSV yourself{
                                    ORG_NAME ? ` or export one from ${ORG_NAME} Users and Groups settings. All selected and uploaded users will be included` : ''
                                }.
                            </span>
                            {
                                selectedUsers.length > 0 &&
                                <Autocomplete<Option, true, false, false>
                                    multiple
                                    options={[]}
                                    open={false}
                                    disabled={isSubmitting}
                                    forcePopupIcon={false}
                                    value={selectedUsers}
                                    onChange={(_, newValue) => setSelectedUsers(newValue)}
                                    getOptionLabel={(option) => option.label}
                                    isOptionEqualToValue={(option, value) => String(option.value) === String(value.value)}
                                    renderTags={(value, getTagProps) =>
                                        value.map((option, index) => (
                                            <Chip
                                                {...getTagProps({ index })}
                                                key={String(option.value)}
                                                size="small"
                                                label={option.label}
                                            />
                                        ))
                                    }
                                    renderInput={(params) => (
                                        <TextField
                                            {...params}
                                            disabled={true}
                                            minRows={3}
                                        />
                                    )}
                                />
                            }
                        </FormControl>
                        <Stack direction="column" spacing={2} sx={{ mt: 1, alignItems: 'flex-start' }}>
                            {/* Keep CSV upload action below Add users button */}
                            <FormControl component="fieldset">
                                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1 }}>
                                    <Tooltip title="Open user search and select one or more users to grant policy." arrow>
                                        <span>
                                            <Button
                                                type="button"
                                                variant="outlined"
                                                size="small"
                                                disabled={isSubmitting}
                                                startIcon={<AddIcon />}
                                                onClick={openUserDialog}
                                            >
                                                Add users
                                            </Button>

                                        </span>
                                    </Tooltip>
                                    <Tooltip title="Upload a CSV file to add multiple users at once." arrow>
                                        <span>
                                            <Button
                                                variant="outlined"
                                                component="label"
                                                size="small"
                                                sx={{ width: 'fit-content' }}
                                                disabled={isSubmitting || isCsvResolvingUsers}
                                                startIcon={<UploadFileIcon />}
                                            >
                                                {isCsvResolvingUsers ? 'Loading users...' : 'Upload CSV'}
                                                <input
                                                    type="file"
                                                    accept=".csv,text/csv"
                                                    hidden
                                                    id="csvFileInput"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (!file) {
                                                            return;
                                                        }
                                                        setUploadedCsvFileName(file.name);
                                                        setIsCsvResolvingUsers(true);
                                                        setCsvResolvedCount(0);
                                                        setCsvUnresolvedEmails([]);

                                                        const reader = new FileReader();
                                                        reader.onload = async (event) => {
                                                            const text = event.target?.result;
                                                            if (typeof text === 'string') {
                                                                const rows = text
                                                                    .split(/\r?\n/)
                                                                    .map((line) => line.trim())
                                                                    .filter((line) => line.length > 0);

                                                                const parsedRows = rows.map((row) =>
                                                                    row
                                                                        .split(',')
                                                                        .map((cell) => cell.trim().replace(/^"|"$/g, ''))
                                                                );

                                                                const headerRow = parsedRows[0] || [];
                                                                const emailColumnIndex = headerRow.findIndex((headerCell) => /^email$/i.test(headerCell));
                                                                const hasKnownHeader = emailColumnIndex >= 0 || /^userprincipalname$/i.test(headerRow[0] || '');
                                                                const dataRows = hasKnownHeader ? parsedRows.slice(1) : parsedRows;
                                                                const valueColumnIndex = emailColumnIndex >= 0 ? emailColumnIndex : 0;

                                                                const newOptions = dataRows
                                                                    .map((columns) => columns[valueColumnIndex] || '')
                                                                    .filter((value) => value.length > 0)
                                                                    .map((value) => ({
                                                                        value,
                                                                        label: value,
                                                                    }));

                                                                if (newOptions.length === 0) {
                                                                    setIsCsvResolvingUsers(false);
                                                                    return;
                                                                }

                                                                try {
                                                                    const emails = newOptions.map((option) => String(option.value));
                                                                    const response = await window.electronAPI.resolveUsersByEmails(emails);
                                                                    const resolvedUsers = Array.isArray(response?.data?.users)
                                                                        ? response.data.users
                                                                        : [];
                                                                    const resolvedOptions: Option[] = resolvedUsers.map(toUserOption);
                                                                    const resolvedEmailSet = new Set(resolvedOptions.map((o) => String(o.value).toLowerCase()));
                                                                    const unresolved = emails.filter((e) => !resolvedEmailSet.has(e.toLowerCase()));
                                                                    setCsvResolvedCount(resolvedOptions.length);
                                                                    setCsvUnresolvedEmails(unresolved);
                                                                    if (response?.success && resolvedOptions.length > 0) {
                                                                        setSelectedUsers((prev) => mergeUniqueOptions(prev, resolvedOptions));
                                                                    }
                                                                } catch {
                                                                    setCsvResolvedCount(0);
                                                                    setCsvUnresolvedEmails([]);
                                                                    // Ignore CSV resolution failures and keep existing selections unchanged.
                                                                } finally {
                                                                    setIsCsvResolvingUsers(false);
                                                                }
                                                            } else {
                                                                setIsCsvResolvingUsers(false);
                                                            }
                                                        };
                                                        reader.onerror = () => {
                                                            setIsCsvResolvingUsers(false);
                                                        };
                                                        reader.readAsText(file);
                                                        // Allow selecting the same file again in a later upload.
                                                        e.currentTarget.value = '';
                                                    }}
                                                />
                                            </Button>
                                        </span>
                                    </Tooltip>
                                    {uploadedCsvFileName && (
                                        <Stack direction="row" spacing={1} alignItems="center">
                                            {
                                                isCsvResolvingUsers ?
                                                    <CircularProgress size={16} />
                                                    :
                                                    <CheckCircleOutlineIcon fontSize="small" color={"success"} />
                                            }
                                            <DescriptionOutlinedIcon fontSize="small" color="action" />
                                            <Stack direction="column" spacing={0}>
                                                <Typography variant="body2" color="text.secondary">
                                                    {uploadedCsvFileName}
                                                </Typography>
                                                {!isCsvResolvingUsers && (csvResolvedCount > 0 || csvUnresolvedEmails.length > 0) && (
                                                    <Stack direction="row" spacing={0.75} alignItems="center">
                                                        {/* Show matched users count */}
                                                        {
                                                            csvResolvedCount > 0 &&
                                                            <Typography variant="caption" color="success.main">
                                                                {`${csvResolvedCount} users matched`}
                                                            </Typography>
                                                        }
                                                        {/* Show unmatched users count and a link to view them */}
                                                        {csvUnresolvedEmails.length > 0 && (
                                                            <>
                                                                {
                                                                    csvResolvedCount > 0 &&
                                                                    <Typography variant="caption" color="text.disabled">·</Typography>
                                                                }
                                                                <Typography
                                                                    variant="caption"
                                                                    color="error"
                                                                    sx={{ cursor: 'pointer', textDecoration: 'underline' }}
                                                                    onClick={() => setShowCsvUnresolvedModal(true)}
                                                                >
                                                                    {csvUnresolvedEmails.length} not found
                                                                </Typography>
                                                            </>
                                                        )}
                                                    </Stack>
                                                )}
                                            </Stack>
                                        </Stack>
                                    )}
                                </Stack>
                            </FormControl>
                        </Stack>

                        <EntitySelectionDialog
                            open={isUserDialogOpen}
                            title="Add users"
                            searchPlaceholder="Search users by name or email"
                            searchValue={userDialogSearchInput}
                            loading={userDialogLoading}
                            loadingText="Loading users..."
                            options={userDialogOptions}
                            selectedMap={modalSelectedUsersMap}
                            total={userDialogTotal}
                            totalLabel="users"
                            selectedCount={selectedCountInModal}
                            pageCount={userDialogPageCount}
                            page={userDialogPage}
                            onSearchChange={setUserDialogSearchInput}
                            onToggleOption={toggleModalUserSelection}
                            onSelectAll={selectAllModalUsers}
                            onPageChange={setUserDialogPage}
                            onClose={closeUserDialog}
                            onSave={handleSaveModalUsers}
                            getOptionPrimaryText={(option) => `${option.label} (${option.value})`}
                        />
                        <Dialog
                            open={showCsvUnresolvedModal}
                            onClose={() => setShowCsvUnresolvedModal(false)}
                            fullWidth
                            maxWidth="xs"
                        >
                            <DialogTitle>Not Found ({csvUnresolvedEmails.length})</DialogTitle>
                            <DialogContent dividers>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                    The following emails from the CSV could not be matched to any Azure users:
                                </Typography>
                                <List dense disablePadding>
                                    {csvUnresolvedEmails.map((email) => (
                                        <ListItem key={email} disableGutters>
                                            <ListItemText primary={email} />
                                        </ListItem>
                                    ))}
                                </List>
                            </DialogContent>
                            <DialogActions>
                                <Button type="button" variant="contained" onClick={() => setShowCsvUnresolvedModal(false)}>
                                    Close
                                </Button>
                            </DialogActions>
                        </Dialog>
                    </div>
                )}

                {selectedType === 'group' && (
                    <div className="grant-policy-target-section grant-policy-target-section-spaced">
                        {
                            selectedGroups.length > 0 &&
                            <FormControl fullWidth margin="normal" required sx={{ mb: 1, mt: 0 }}>
                                <Typography variant="subtitle2" sx={{ mb: 0.5, ml: 0.5 }}>
                                    Selected groups ({selectedGroups.length})
                                    <span className="grant-policy-required-asterisk">*</span>
                                </Typography>
                                <Autocomplete<Option, true, false, false>
                                    multiple
                                    options={[]}
                                    open={false}
                                    forcePopupIcon={false}
                                    value={selectedGroups}
                                    onChange={(_, newValue) => setSelectedGroups(newValue)}
                                    getOptionLabel={(option) => option.label}
                                    isOptionEqualToValue={(option, value) => String(option.value) === String(value.value)}
                                    renderTags={(value, getTagProps) =>
                                        value.map((option, index) => (
                                            <Chip
                                                {...getTagProps({ index })}
                                                key={String(option.value)}
                                                size="small"
                                                label={option.label}
                                            />
                                        ))
                                    }
                                    renderInput={(params) => (
                                        <TextField
                                            {...params}
                                            minRows={3}
                                            placeholder={selectedGroups.length === 0 ? 'No groups selected' : ''}
                                        />
                                    )}
                                />
                            </FormControl>
                        }
                        <Tooltip title="Open group search and select one or more groups to grant policy." arrow>
                            <span>
                                <Button
                                    type="button"
                                    variant="outlined"
                                    size="small"
                                    sx={{ mt: 1 }}
                                    startIcon={<AddIcon />}
                                    onClick={openGroupDialog}
                                >
                                    Add groups
                                </Button>
                            </span>
                        </Tooltip>

                        <EntitySelectionDialog
                            open={isGroupDialogOpen}
                            title="Add groups"
                            searchPlaceholder="Search groups by name"
                            searchValue={groupDialogSearchInput}
                            loading={groupDialogLoading}
                            loadingText="Loading groups..."
                            options={groupDialogOptions}
                            selectedMap={modalSelectedGroupsMap}
                            total={groupDialogTotal}
                            totalLabel="groups"
                            selectedCount={selectedGroupCountInModal}
                            pageCount={groupDialogPageCount}
                            page={groupDialogPage}
                            onSearchChange={setGroupDialogSearchInput}
                            onToggleOption={toggleModalGroupSelection}
                            onSelectAll={selectAllModalGroups}
                            onPageChange={setGroupDialogPage}
                            onClose={closeGroupDialog}
                            onSave={handleSaveModalGroups}
                        />
                    </div>
                )}

            </form>
        </div>
    );
}