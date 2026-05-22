import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import MultiSelect, { Option } from './MultiSelect';

type SearchableTargetMultiSelectProps = {
  name: string;
  label: string;
  options: Option[];
  value?: Option[];
  onSelectionChange?: (selected: Option[]) => void;
  totalCount?: number;
  emptyMessage: string;
  requiredMessage: string;
  ariaLabel: string;
  indicatorKey: string;
  searchDebounceMs?: number;
  loadingText?: string;
  onSearchPage?: (text: string, page: number) => Promise<{ options: Option[]; total: number }>;
};

function appendMoreOption(options: Option[], totalCount: number, indicatorKey: string, nextPage: number, queryText: string): Option[] {
  const safeTotal = typeof totalCount === 'number' ? totalCount : options.length;
  const remainingCount = Math.max(safeTotal - options.length, 0);

  if (remainingCount <= 0) {
    return options;
  }

  return [
    ...options,
    {
      value: `${indicatorKey}_${queryText || 'default'}_${nextPage}_${remainingCount}`,
      label: `+${remainingCount} more`,
      isMoreOption: true,
      nextPage,
      queryText,
    },
  ];
}

export default function SearchableTargetMultiSelect({
  name,
  label,
  options,
  value,
  onSelectionChange,
  totalCount,
  emptyMessage,
  requiredMessage,
  ariaLabel,
  indicatorKey,
  searchDebounceMs = 600,
  loadingText,
  onSearchPage,
}: SearchableTargetMultiSelectProps) {
  const [defaultOptions, setDefaultOptions] = useState<Option[]>(options || []);
  const [defaultTotalCount, setDefaultTotalCount] = useState<number>(totalCount ?? (options || []).length);

  useEffect(() => {
    setDefaultOptions(options || []);
  }, [options]);

  useEffect(() => {
    setDefaultTotalCount(totalCount ?? (options || []).length);
  }, [totalCount, options]);

  const defaultOptionsWithMore = useMemo(
    () => appendMoreOption(defaultOptions, defaultTotalCount, indicatorKey, 1, ''),
    [defaultOptions, defaultTotalCount, indicatorKey]
  );

  if (!defaultOptions || defaultOptions.length === 0) {
    return <p>{emptyMessage}</p>;
  }

  const mergeUniqueOptions = (existing: Option[], incoming: Option[]) => {
    const map = new Map<string, Option>();
    [...existing, ...incoming].forEach((option) => {
      if (option.isMoreOption) {
        return;
      }
      map.set(String(option.value), option);
    });
    return Array.from(map.values());
  };

  const handleSearch = (text: string) => {
    const trimmed = text.trim();

    if (!trimmed || !onSearchPage) {
      return Promise.resolve(defaultOptionsWithMore);
    }

    return onSearchPage(trimmed, 0)
      .then((result) => appendMoreOption(result.options, result.total, indicatorKey, 1, trimmed))
      .catch(() => []);
  };

  const handleLoadMore = ({ query, currentOptions, trigger }: { query: string; currentOptions: Option[]; trigger: Option }) => {
    if (!onSearchPage) {
      return Promise.resolve(currentOptions);
    }

    const effectiveQuery = (trigger.queryText ?? query ?? '').trim();
    const nextPage = typeof trigger.nextPage === 'number' ? trigger.nextPage : 1;
    const currentWithoutMore = currentOptions.filter((option) => !option.isMoreOption);

    return onSearchPage(effectiveQuery, nextPage)
      .then((result) => {
        const merged = mergeUniqueOptions(currentWithoutMore, result.options);
        const withMore = appendMoreOption(merged, result.total, indicatorKey, nextPage + 1, effectiveQuery);

        if (!effectiveQuery) {
          setDefaultOptions(merged);
          setDefaultTotalCount(result.total);
        }

        return withMore;
      })
      .catch(() => currentOptions);
  };

  return (
    <FormControl fullWidth margin="normal" required sx={{ mb: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5, ml: 0.5 }}>
        {label}
        <span style={{ color: '#d32f2f', marginLeft: 2 }}>*</span>
      </Typography>
      <MultiSelect
        isSelectAll
        options={defaultOptionsWithMore}
        value={value ?? []}
        searchDebounceMs={searchDebounceMs}
        onChange={(selected: Option[]) => onSelectionChange?.(selected)}
        aria-label={ariaLabel}
        loadingText={loadingText || 'Loading results...'}
        onSearch={handleSearch}
        onLoadMore={handleLoadMore}
      />
      {/* Only show error if needed; otherwise, don't show helper text */}
      {/* <FormHelperText error>{requiredMessage}</FormHelperText> */}
    </FormControl>
  );
}
