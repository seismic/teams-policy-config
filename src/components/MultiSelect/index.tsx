import { useEffect, useRef, useState } from "react";
import { default as ReactSelect, components, InputAction } from "react-select";

export type Option = {
  value: number | string;
  label: string;
  isDisabled?: boolean;
  isMoreOption?: boolean;
  nextPage?: number;
  queryText?: string;
};

type MultiSelectProps = {
  options?: any[];
  value?: any[];
  isSelectAll?: boolean;
  onSearch?: (query: string) => Promise<Option[] | void> | Option[] | void;
  onLoadMore?: (args: {
    query: string;
    currentOptions: Option[];
    trigger: Option;
  }) => Promise<Option[] | void> | Option[] | void;
  searchDebounceMs?: number;
  minSearchLength?: number;
  loadingText?: string;
  [key: string]: any;
};

const MultiSelect = (props: MultiSelectProps) => {
  const [selectInput, setSelectInput] = useState<string>("");
  const [searchResults, setSearchResults] = useState<Option[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const onSearchRef = useRef<MultiSelectProps["onSearch"]>(props.onSearch);
  const isAllSelected = useRef<boolean>(false);
  const selectAllLabel = useRef<string>("Select all");
  const latestSearchId = useRef(0);
  const allOption = { value: "*", label: selectAllLabel.current };
  const effectiveOptions = searchResults ?? props.options ?? [];

  useEffect(() => {
    onSearchRef.current = props.onSearch;
  }, [props.onSearch]);

  const filterOptions = (options: Option[], input: string) =>
    options?.filter(({ label }: Option) =>
      label.toLowerCase().includes(input.toLowerCase())
    );

  const comparator = (v1: Option, v2: Option) =>
    String(v1.value).localeCompare(String(v2.value));

  const selectableOptions = (effectiveOptions ?? []).filter(
    (option: Option) => !option.isDisabled && !option.isMoreOption
  );

  let filteredOptions = filterOptions(selectableOptions, selectInput);
  let filteredSelectedOptions = filterOptions(
    (props.value ?? []).filter((option: Option) => !option.isDisabled),
    selectInput
  );

  useEffect(() => {
    const onSearch = onSearchRef.current;
    if (!onSearch) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    const trimmedInput = selectInput.trim();
    const minSearchLength = props.minSearchLength ?? 1;
    const searchDebounceMs = props.searchDebounceMs ?? 300;

    if (trimmedInput.length < minSearchLength) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    const searchId = ++latestSearchId.current;
    setIsSearching(true);

    const timeoutId = window.setTimeout(async () => {
      try {
        const result = await onSearch(trimmedInput);
        if (latestSearchId.current !== searchId) return;
        setSearchResults(Array.isArray(result) ? result : []);
      } catch {
        if (latestSearchId.current !== searchId) return;
        setSearchResults([]);
      } finally {
        if (latestSearchId.current === searchId) {
          setIsSearching(false);
        }
      }
    }, searchDebounceMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectInput, props.minSearchLength, props.searchDebounceMs]);

  const Option = (props: any) => (
    <components.Option {...props}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {props.data?.isMoreOption ? (
          <span style={{ color: "#2563eb", fontWeight: 600 }}>{props.label}</span>
        ) : props.isDisabled ? (
          <span style={{ color: "#6b7280" }}>{props.label}</span>
        ) : props.value === "*" &&
          !isAllSelected.current &&
          filteredSelectedOptions?.length > 0 ? (
          <input
            key={props.value}
            type="checkbox"
            style={{ width: "auto", padding: 0, margin: 0 }}
            ref={(input) => {
              if (input) input.indeterminate = true;
            }}
          />
        ) : (
          <input
            key={props.value}
            type="checkbox"
            style={{ width: "auto", padding: 0, margin: 0 }}
            checked={props.isSelected || isAllSelected.current}
            onChange={() => { }}
          />
        )}
        {!props.isDisabled && !props.data?.isMoreOption && <span>{props.label}</span>}
      </div>
    </components.Option>
  );

  const Input = (props: any) => (
    <>
      {selectInput.length === 0 ? (
        <components.Input autoFocus={props.selectProps.menuIsOpen} {...props}>
          {props.children}
        </components.Input>
      ) : (
        <div style={{ border: "1px dotted gray" }}>
          <components.Input autoFocus={props.selectProps.menuIsOpen} {...props}>
            {props.children}
          </components.Input>
        </div>
      )}
    </>
  );

  const customFilterOption = (
    { value, label, isDisabled, isMoreOption }: Option,
    input: string
  ) =>
    Boolean(isDisabled) ||
    Boolean(isMoreOption) ||
    (value !== "*" && label.toLowerCase().includes(input.toLowerCase())) ||
    (value === "*" && filteredOptions?.length > 0);

  const onInputChange = (
    inputValue: string,
    event: { action: InputAction }
  ) => {
    if (event.action === "input-change") setSelectInput(inputValue);
    else if (event.action === "menu-close" && selectInput !== "")
      setSelectInput("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if ((e.key === " " || e.key === "Enter") && !selectInput)
      e.preventDefault();
  };

  const handleChange = (selected: readonly Option[] | null) => {
    const selectedRaw = [...(selected ?? [])];
    const selectedMoreOption = selectedRaw.find((option: Option) => option.isMoreOption);

    if (selectedMoreOption && props.onLoadMore) {
      setIsLoadingMore(true);

      Promise.resolve(
        props.onLoadMore({
          query: selectInput.trim(),
          currentOptions: effectiveOptions,
          trigger: selectedMoreOption,
        })
      )
        .then((nextOptions) => {
          if (Array.isArray(nextOptions)) {
            setSearchResults(nextOptions);
          }
        })
        .catch(() => { })
        .finally(() => setIsLoadingMore(false));

      return;
    }

    const selectedOptions = selectedRaw.filter(
      (option: Option) => !option.isDisabled && !option.isMoreOption
    );

    if (
      selectedOptions.length > 0 &&
      !isAllSelected.current &&
      (selectedOptions[selectedOptions.length - 1].value === allOption.value ||
        JSON.stringify(filteredOptions) ===
        JSON.stringify(selectedOptions.slice().sort(comparator)))
    )
      return props.onChange(
        [
          ...(props.value ?? []),
          ...selectableOptions.filter(
            ({ label }: Option) =>
              label.toLowerCase().includes(selectInput?.toLowerCase()) &&
              (props.value ?? []).filter((opt: Option) => opt.label === label)
                .length === 0
          ),
        ].sort(comparator)
      );
    else if (
      selectedOptions.length > 0 &&
      selectedOptions[selectedOptions.length - 1].value !== allOption.value &&
      JSON.stringify(selectedOptions.slice().sort(comparator)) !==
      JSON.stringify(filteredOptions)
    )
      return props.onChange(selectedOptions);
    else
      return props.onChange([
        ...(props.value ?? []).filter(
          ({ label }: Option) =>
            !label.toLowerCase().includes(selectInput?.toLowerCase())
        ),
      ]);
  };

  const customStyles = {
    multiValueLabel: (def: any) => ({
      ...def,
      backgroundColor: "lightgray",
    }),
    multiValueRemove: (def: any) => ({
      ...def,
      backgroundColor: "lightgray",
    }),
    valueContainer: (base: any) => ({
      ...base,
      maxHeight: "65px",
      overflow: "auto",
    }),
    option: (styles: any, { isSelected, isFocused }: any) => {
      return {
        ...styles,
        backgroundColor:
          isSelected && !isFocused
            ? null
            : isFocused && !isSelected
              ? styles.backgroundColor
              : isFocused && isSelected
                ? "#DEEBFF"
                : null,
        color: isSelected ? null : null,
      };
    },
    menu: (def: any) => ({ ...def, zIndex: 9999 }),
  };

  if (props.isSelectAll && effectiveOptions.length !== 0) {
    isAllSelected.current =
      JSON.stringify(filteredSelectedOptions) ===
      JSON.stringify(filteredOptions);

    if (filteredSelectedOptions?.length > 0) {
      if (filteredSelectedOptions?.length === filteredOptions?.length)
        selectAllLabel.current = `All (${filteredOptions.length}) selected`;
      else
        selectAllLabel.current = `${filteredSelectedOptions?.length} / ${filteredOptions.length} selected`;
    } else selectAllLabel.current = "Select all";

    allOption.label = selectAllLabel.current;

    return (
      <div>
        <ReactSelect
          {...props}
          inputValue={selectInput}
          isLoading={isSearching || isLoadingMore}
          onInputChange={onInputChange}
          onKeyDown={onKeyDown}
          options={[allOption, ...effectiveOptions]}
          onChange={handleChange}
          components={{
            Option: Option,
            Input: Input,
            ...props.components,
          }}
          filterOption={customFilterOption}
          menuPlacement={props.menuPlacement ?? "auto"}
          styles={customStyles}
          isMulti
          closeMenuOnSelect={false}
          tabSelectsValue={false}
          backspaceRemovesValue={false}
          hideSelectedOptions={false}
          blurInputOnSelect={false}
        />
        {(isSearching || isLoadingMore) && selectInput.trim().length > 0 && (
          <div style={{ marginTop: "6px", color: "#6b7280", fontSize: "12px" }}>
            {props.loadingText ?? "Loading..."}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <ReactSelect
        {...props}
        inputValue={selectInput}
        isLoading={isSearching || isLoadingMore}
        options={effectiveOptions}
        onInputChange={onInputChange}
        filterOption={customFilterOption}
        components={{
          Input: Input,
          ...props.components,
        }}
        menuPlacement={props.menuPlacement ?? "auto"}
        onKeyDown={onKeyDown}
        tabSelectsValue={false}
        hideSelectedOptions={true}
        backspaceRemovesValue={false}
        blurInputOnSelect={true}
      />
      {(isSearching || isLoadingMore) && selectInput.trim().length > 0 && (
        <div style={{ marginTop: "6px", color: "#6b7280", fontSize: "12px" }}>
          {props.loadingText ?? "Loading..."}
        </div>
      )}
    </div>
  );
};

export default MultiSelect;
