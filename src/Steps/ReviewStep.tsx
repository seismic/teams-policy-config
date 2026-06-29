import { useMemo, useState } from 'react';
import {
    InputAdornment,
    IconButton,
    List,
    ListItem,
    ListItemText,
    Pagination,
    Stack,
    Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import PublicIcon from '@mui/icons-material/Public';
import TextField from '../components/TextField';
import { Option } from '../components/MultiSelect';

const PAGE_SIZE = 10;

type ReviewStepProps = {
    policyName: string;
    type: string;
    users: Option[];
    groups: Option[];
};

export default function ReviewStep({ policyName, type, users, groups }: ReviewStepProps) {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);

    const items: Option[] = type === 'user' ? users : type === 'group' ? groups : [];

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return items;
        return items.filter(
            (item) =>
                item.label.toLowerCase().includes(q) ||
                String(item.value).toLowerCase().includes(q)
        );
    }, [items, search]);

    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    const handleSearchChange = (value: string) => {
        setSearch(value);
        setPage(1);
    };

    if (type === 'global') {
        return (
            <div className="step-content">
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    The policy <strong>{policyName}</strong> will be granted to all users in the Azure organization.
                </Typography>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 2, borderRadius: 1, bgcolor: 'action.hover' }}>
                    <PublicIcon color="action" />
                    <Stack>
                        <Typography variant="body2" fontWeight={500}>Global — All Users</Typography>
                        <Typography variant="caption" color="text.secondary">
                            This policy applies tenant-wide to every user in your Azure organization.
                        </Typography>
                    </Stack>
                </Stack>
            </div>
        );
    }

    const entityLabel = type === 'group' ? 'groups' : 'users';
    const subtitle = type === 'group'
        ? 'The following groups will be granted a Teams policy'
        : 'The following users will be granted a Teams policy';

    return (
        <div className="step-content">
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {subtitle}
            </Typography>

            <TextField
                placeholder="Search"
                size="small"
                fullWidth
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                sx={{ mb: 1.5 }}
                InputProps={{
                    startAdornment: (
                        <InputAdornment position="start">
                            <SearchIcon fontSize="small" color="action" />
                        </InputAdornment>
                    ),
                    endAdornment: search ? (
                        <InputAdornment position="end">
                            <IconButton size="small" edge="end" onClick={() => handleSearchChange('')} aria-label="Clear search">
                                <ClearIcon fontSize="small" />
                            </IconButton>
                        </InputAdornment>
                    ) : undefined,
                }}
            />

            {filtered.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    {search ? `No ${entityLabel} match your search.` : `No ${entityLabel} selected.`}
                </Typography>
            ) : (
                <>
                    <List dense disablePadding sx={{ mb: 1 }}>
                        {pageItems.map((item) => (
                            <ListItem key={String(item.value)} disableGutters sx={{ py: 0.25 }}>
                                <ListItemText
                                    primary={item.label}
                                    secondary={type === 'user' ? String(item.value) : undefined}
                                    primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                                    secondaryTypographyProps={{ variant: 'caption' }}
                                />
                            </ListItem>
                        ))}
                    </List>

                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                            {filtered.length} {entityLabel} total
                        </Typography>
                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography variant="caption" color="text.secondary">
                                Page {safePage} of {pageCount}
                            </Typography>
                            <Pagination
                                size="small"
                                color="primary"
                                count={pageCount}
                                page={safePage}
                                onChange={(_, p) => setPage(p)}
                                siblingCount={0}
                                boundaryCount={1}
                            />
                        </Stack>
                    </Stack>
                </>
            )}
        </div>
    );
}
