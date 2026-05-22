import {
    Button,
    Checkbox,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    IconButton,
    InputAdornment,
    List,
    ListItemButton,
    ListItemText,
    Pagination,
    Stack,
    Typography,
} from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';
import TextField from '../components/TextField';
import { Option } from '../components/MultiSelect';

type EntitySelectionDialogProps = {
    open: boolean;
    title: string;
    searchPlaceholder: string;
    searchValue: string;
    loading: boolean;
    loadingText: string;
    options: Option[];
    selectedMap: Record<string, Option>;
    total: number;
    totalLabel: string;
    selectedCount: number;
    pageCount: number;
    page: number;
    onSearchChange: (value: string) => void;
    onToggleOption: (option: Option) => void;
    onSelectAll?: (options: Option[], select: boolean) => void;
    onPageChange: (page: number) => void;
    onClose: () => void;
    onSave: () => void;
    getOptionPrimaryText?: (option: Option) => string;
};

export default function EntitySelectionDialog({
    open,
    title,
    searchPlaceholder,
    searchValue,
    loading,
    loadingText,
    options,
    selectedMap,
    total,
    totalLabel,
    selectedCount,
    pageCount,
    page,
    onSearchChange,
    onToggleOption,
    onSelectAll,
    onPageChange,
    onClose,
    onSave,
    getOptionPrimaryText,
}: EntitySelectionDialogProps) {
    const allPageSelected = options.length > 0 && options.every((o) => Boolean(selectedMap[String(o.value)]));
    const somePageSelected = !allPageSelected && options.some((o) => Boolean(selectedMap[String(o.value)]));
    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="sm"
        >
            <DialogTitle>{title}</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={1.5}>
                    <TextField
                        placeholder={searchPlaceholder}
                        size="small"
                        value={searchValue}
                        onChange={(e) => onSearchChange(e.target.value)}
                        InputProps={{
                            endAdornment: searchValue ? (
                                <InputAdornment position="end">
                                    <IconButton
                                        aria-label="Clear search"
                                        size="small"
                                        edge="end"
                                        onClick={() => onSearchChange('')}
                                    >
                                        <ClearIcon fontSize="small" />
                                    </IconButton>
                                </InputAdornment>
                            ) : undefined,
                        }}
                    />
                    {loading ? (
                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ py: 1 }}>
                            <CircularProgress size={16} />
                            <Typography variant="body2">{loadingText}</Typography>
                        </Stack>
                    ) : (
                        <Stack spacing={0}>
                            {onSelectAll && options.length > 0 && (
                                <>
                                    <ListItemButton
                                        onClick={() => onSelectAll(options, !allPageSelected)}
                                        className="select-all-option"
                                        sx={{ position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper' }}
                                    >
                                        <Checkbox
                                            edge="start"
                                            tabIndex={-1}
                                            disableRipple
                                            checked={allPageSelected}
                                            indeterminate={somePageSelected}
                                        />
                                        <ListItemText primary="Select all on this page" />
                                    </ListItemButton>
                                    <Divider />
                                </>
                            )}
                            <List dense className="grant-policy-list" sx={{ overflowY: 'auto', maxHeight: 280 }}>
                                {options.map((option) => {
                                    const optionKey = String(option.value);
                                    const checked = Boolean(selectedMap[optionKey]);
                                    return (
                                        <ListItemButton key={optionKey} onClick={() => onToggleOption(option)}>
                                            <Checkbox edge="start" tabIndex={-1} disableRipple checked={checked} />
                                            <ListItemText
                                                primary={
                                                    getOptionPrimaryText
                                                        ? getOptionPrimaryText(option)
                                                        : option.label
                                                }
                                            />
                                        </ListItemButton>
                                    );
                                })}
                            </List>
                        </Stack>
                    )}
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <div>
                            <Typography variant="body2" color="text.secondary">
                                {total} {totalLabel} found
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {selectedCount} selected
                            </Typography>
                            <Typography variant="caption" color="text.secondary" className="entity-selection-page-count">
                                {options.length} shown on this page
                            </Typography>
                        </div>
                        <Pagination
                            color="primary"
                            size="small"
                            count={pageCount}
                            page={page + 1}
                            onChange={(_, nextPage) => onPageChange(nextPage - 1)}
                        />
                    </Stack>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button type="button" variant="text" onClick={onClose}>Cancel</Button>
                <Button type="button" variant="contained" onClick={onSave}>Save</Button>
            </DialogActions>
        </Dialog>
    );
}
