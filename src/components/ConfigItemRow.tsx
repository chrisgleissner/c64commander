import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useC64ConfigItem } from '@/hooks/useC64Connection';
import { getCheckboxMapping, inferControlKind } from '@/lib/config/controlType';
import { cn } from '@/lib/utils';

interface ConfigItemRowProps {
  name: string;
  category?: string;
  value: string | number;
  options?: string[];
  details?: {
    min?: number;
    max?: number;
    format?: string;
    presets?: string[];
  };
  onValueChange: (value: string | number) => void;
  isLoading?: boolean;
  className?: string;
  rightAccessory?: React.ReactNode;
  valueTestId?: string;
  sliderTestId?: string;
}

export function ConfigItemRow({
  name,
  category,
  value,
  options,
  details,
  onValueChange,
  isLoading = false,
  className,
  rightAccessory,
  valueTestId,
  sliderTestId,
}: ConfigItemRowProps) {
  const [inputValue, setInputValue] = useState(() => String(value));
  const lastCommittedRef = useRef<string>(String(value));
  const debounceTimerRef = useRef<number | undefined>(undefined);

  const extractConfigFromResponse = (data: unknown) => {
    if (!data || typeof data !== 'object') return undefined;
    const payload = data as Record<string, any>;
    const categoryBlock = category ? payload[category] : undefined;
    const itemBlock =
      (categoryBlock && (categoryBlock.items ?? categoryBlock)[name]) ??
      payload[name] ??
      payload.item ??
      payload.value ??
      payload;
    if (!itemBlock || typeof itemBlock !== 'object') return undefined;
    return itemBlock as Record<string, any>;
  };

  const needsDetailFetch = (!options || options.length === 0) && !details?.presets;
  const { data: itemData, isLoading: isItemLoading } = useC64ConfigItem(
    category,
    name,
    needsDetailFetch,
  );

  const fetchedConfig = useMemo(() => extractConfigFromResponse(itemData), [itemData]);

  const fetchedOptions = useMemo(() => {
    if (!fetchedConfig) return [] as string[];
    const optionsCandidate = fetchedConfig.options ?? fetchedConfig.values ?? fetchedConfig.choices;
    const presetsCandidate = fetchedConfig.details?.presets ?? fetchedConfig.presets;
    const list = [...(optionsCandidate ?? []), ...(presetsCandidate ?? [])]
      .map((opt: string) => String(opt));
    return Array.isArray(list) ? list : [];
  }, [fetchedConfig]);

  const mergedDetails = useMemo(() => {
    if (!fetchedConfig) return details;
    const min = fetchedConfig.details?.min ?? fetchedConfig.min ?? details?.min;
    const max = fetchedConfig.details?.max ?? fetchedConfig.max ?? details?.max;
    const format = fetchedConfig.details?.format ?? fetchedConfig.format ?? details?.format;
    const presets = fetchedConfig.details?.presets ?? fetchedConfig.presets ?? details?.presets;
    if (min !== undefined || max !== undefined || format || presets) {
      return { min, max, format, presets };
    }
    return details;
  }, [fetchedConfig, details]);

  const mergedValue = useMemo(() => {
    if (String(value).length > 0) return value;
    if (!fetchedConfig) return value;
    const selected =
      fetchedConfig.selected ??
      fetchedConfig.value ??
      fetchedConfig.current ??
      fetchedConfig.current_value ??
      fetchedConfig.currentValue ??
      fetchedConfig.default ??
      fetchedConfig.default_value;
    return selected ?? value;
  }, [value, fetchedConfig]);

  useEffect(() => {
    setInputValue(String(mergedValue));
    lastCommittedRef.current = String(mergedValue);
  }, [mergedValue]);

  const optionList = useMemo(() => {
    const combined = [
      ...(options ?? []),
      ...(details?.presets ?? []),
      ...fetchedOptions,
    ]
      .map((opt) => String(opt))
      .filter((opt) => opt.length > 0 || opt === '');
    const seen = new Set<string>();
    return combined.filter((opt) => {
      if (seen.has(opt)) return false;
      seen.add(opt);
      return true;
    });
  }, [options, details?.presets, fetchedOptions]);

  const checkboxMapping = useMemo(() => getCheckboxMapping(optionList), [optionList]);
  const controlKind = useMemo(
    () =>
      inferControlKind({
        name,
        category,
        currentValue: mergedValue,
        possibleValues: optionList,
      }),
    [name, category, mergedValue, optionList],
  );

  const displayValue = inputValue;
  const isReadOnly = name.startsWith('SID Detected Socket');
  const normalizeOption = (option: string) => option.trim().replace(/\s+/g, ' ').toLowerCase();
  const parseNumeric = (option: string) => {
    const match = option.trim().match(/[+-]?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : undefined;
  };
  const isLeftRightCenter = (options: string[]) => {
    const normalized = options.map(normalizeOption);
    const hasCenter = normalized.some((value) => value === 'center' || value === 'centre');
    const hasLeft = normalized.some((value) => value.startsWith('left'));
    const hasRight = normalized.some((value) => value.startsWith('right'));
    return hasCenter && hasLeft && hasRight;
  };
  const parseLeftRight = (option: string) => {
    const normalized = normalizeOption(option);
    if (normalized.startsWith('left')) {
      return { side: 'left' as const, value: parseNumeric(option) ?? 0 };
    }
    if (normalized.startsWith('right')) {
      return { side: 'right' as const, value: parseNumeric(option) ?? 0 };
    }
    if (normalized === 'center' || normalized === 'centre') {
      return { side: 'center' as const, value: 0 };
    }
    return null;
  };
  const isOffLowMediumHigh = (options: string[]) => {
    const normalized = new Set(options.map(normalizeOption));
    return (
      normalized.size === 4 &&
      normalized.has('off') &&
      normalized.has('low') &&
      normalized.has('medium') &&
      normalized.has('high')
    );
  };
  const getSliderOptions = (options: string[]) => {
    if (isOffLowMediumHigh(options)) {
      const order = ['off', 'low', 'medium', 'high'];
      return order
        .map((key) => options.find((option) => normalizeOption(option) === key))
        .filter((option): option is string => Boolean(option));
    }

    const entries = options.map((option) => ({ option, numeric: parseNumeric(option) }));
    const numericEntries = entries.filter((entry) => entry.numeric !== undefined) as Array<{
      option: string;
      numeric: number;
    }>;
    const nonNumeric = entries.filter((entry) => entry.numeric === undefined);
    const nonNumericNormalized = nonNumeric.map((entry) => normalizeOption(entry.option));
    const hasOnlyOff = nonNumeric.length > 0 && nonNumericNormalized.every((value) => value === 'off');

    if (numericEntries.length >= 2 && (nonNumeric.length === 0 || hasOnlyOff)) {
      const sortedNumeric = [...numericEntries].sort((a, b) => a.numeric - b.numeric);
      const offEntry = nonNumeric.find((entry) => normalizeOption(entry.option) === 'off');
      return [
        ...(offEntry ? [offEntry.option] : []),
        ...sortedNumeric.map((entry) => entry.option),
      ];
    }

    if (isLeftRightCenter(options)) {
      const left = options
        .map((option) => ({ option, parsed: parseLeftRight(option) }))
        .filter((entry) => entry.parsed?.side === 'left')
        .sort((a, b) => (b.parsed?.value ?? 0) - (a.parsed?.value ?? 0))
        .map((entry) => entry.option);
      const right = options
        .map((option) => ({ option, parsed: parseLeftRight(option) }))
        .filter((entry) => entry.parsed?.side === 'right')
        .sort((a, b) => (a.parsed?.value ?? 0) - (b.parsed?.value ?? 0))
        .map((entry) => entry.option);
      const center = options.find((option) => {
        const parsed = parseLeftRight(option);
        return parsed?.side === 'center';
      });
      return [...left, ...(center ? [center] : []), ...right];
    }

    return options;
  };
  const sliderOptions = useMemo(
    () => (controlKind === 'slider' ? getSliderOptions(optionList) : optionList),
    [controlKind, optionList],
  );

  if (controlKind === 'checkbox' && checkboxMapping) {
    const checked =
      String(displayValue).trim().toLowerCase() === checkboxMapping.checkedValue.trim().toLowerCase();

    return (
      <div className={cn('settings-row w-full flex items-center justify-between gap-3', className)}>
        <div className="flex flex-col flex-1 pr-4">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">
            {checked ? checkboxMapping.checkedValue : checkboxMapping.uncheckedValue}
          </span>
        </div>
        <Checkbox
          checked={checked}
          disabled={isLoading || isItemLoading || isReadOnly}
          onCheckedChange={(next) => {
            if (isReadOnly) return;
            const nextValue = next === true ? checkboxMapping.checkedValue : checkboxMapping.uncheckedValue;
            setInputValue(String(nextValue));
            lastCommittedRef.current = String(nextValue);
            onValueChange(nextValue);
          }}
          aria-label={`${name} checkbox`}
        />
      </div>
    );
  }

  if (controlKind === 'select') {
    const emptySentinel = '__empty__';
    const selectOptions = optionList.map((option) => ({
      raw: option,
      value: option === '' ? emptySentinel : option,
      label: option === '' ? '(empty)' : option,
    }));
    const selectedValue = optionList.includes(displayValue)
      ? displayValue === ''
        ? emptySentinel
        : displayValue
      : undefined;

    return (
      <div className={cn('settings-row w-full flex items-center justify-between gap-3', className)}>
        <span className="text-sm font-medium flex-1 pr-4">{name}</span>
        <div className="min-w-[160px] max-w-[220px]">
          <Select
            value={selectedValue}
            onValueChange={(newValue) => {
              if (isReadOnly) return;
              const nextValue = newValue === emptySentinel ? '' : newValue;
              setInputValue(String(nextValue));
              lastCommittedRef.current = String(nextValue);
              onValueChange(nextValue);
            }}
            disabled={isLoading || isItemLoading || isReadOnly}
          >
            <SelectTrigger aria-label={`${name} select`}>
              <SelectValue placeholder={isItemLoading ? 'Loading…' : displayValue || 'Select'} />
            </SelectTrigger>
            <SelectContent>
              {selectOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (controlKind === 'slider' && sliderOptions.length >= 2) {
    const normalizedOptions = sliderOptions.map(normalizeOption);
    const displayNormalized = normalizeOption(displayValue);
    let selectedIndex = normalizedOptions.indexOf(displayNormalized);

    if (selectedIndex < 0) {
      const displayNumber = parseNumeric(displayValue);
      if (displayNumber !== undefined) {
        const numericIndex = sliderOptions.findIndex((opt) => parseNumeric(opt) === displayNumber);
        if (numericIndex >= 0) selectedIndex = numericIndex;
      }
    }

    if (selectedIndex < 0) selectedIndex = 0;

    const currentLabel = sliderOptions[selectedIndex] ?? displayValue;

    return (
      <div className={cn('settings-row w-full flex items-center justify-between gap-3', className)}>
        <div className="flex flex-col flex-1 pr-4">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-foreground font-mono" data-testid={valueTestId}>
            {currentLabel}
          </span>
        </div>
        <div className="flex items-center gap-3 min-w-[220px] max-w-[320px] w-full">
          <div className="min-w-[180px] max-w-[260px] w-full">
            <Slider
              value={[selectedIndex]}
              min={0}
              max={sliderOptions.length - 1}
              step={1}
              disabled={isLoading || isItemLoading || isReadOnly}
              onValueChange={(values) => {
                if (isReadOnly) return;
                const nextIndex = values[0] ?? 0;
                const nextValue = sliderOptions[nextIndex] ?? sliderOptions[0];
                setInputValue(String(nextValue));
              }}
              onValueCommit={(values) => {
                if (isReadOnly) return;
                const nextIndex = values[0] ?? 0;
                const nextValue = sliderOptions[nextIndex] ?? sliderOptions[0];
                if (String(nextValue) === lastCommittedRef.current) return;
                lastCommittedRef.current = String(nextValue);
                setInputValue(String(nextValue));
                onValueChange(nextValue);
              }}
              aria-label={`${name} slider`}
              data-testid={sliderTestId}
            />
          </div>
          {rightAccessory ? <div className="flex items-center gap-2">{rightAccessory}</div> : null}
        </div>
      </div>
    );
  }

  const inputType = controlKind === 'password' ? 'password' : 'text';

  return (
    <div className={cn('settings-row w-full flex items-center justify-between gap-3', className)}>
      <span className="text-sm font-medium flex-1 pr-4">{name}</span>
      <div className="min-w-[160px] max-w-[220px] flex items-center gap-2">
        <Input
          type={inputType}
          value={inputValue}
          aria-label={`${name} ${controlKind === 'password' ? 'password' : 'text'} input`}
          disabled={isLoading || isItemLoading || isReadOnly}
          onChange={(e) => {
            if (isReadOnly) return;
            const nextValue = e.target.value;
            setInputValue(nextValue);
            if (debounceTimerRef.current !== undefined) {
              window.clearTimeout(debounceTimerRef.current);
            }
            debounceTimerRef.current = window.setTimeout(() => {
              if (nextValue === lastCommittedRef.current) return;
              lastCommittedRef.current = nextValue;
              onValueChange(nextValue);
            }, 300);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (isReadOnly) return;
            const nextValue = inputValue;
            if (nextValue === lastCommittedRef.current) return;
            if (debounceTimerRef.current !== undefined) {
              window.clearTimeout(debounceTimerRef.current);
              debounceTimerRef.current = undefined;
            }
            lastCommittedRef.current = nextValue;
            onValueChange(nextValue);
          }}
          onBlur={() => {
            if (isReadOnly) return;
            const nextValue = inputValue;
            if (nextValue === lastCommittedRef.current) return;
            if (debounceTimerRef.current !== undefined) {
              window.clearTimeout(debounceTimerRef.current);
              debounceTimerRef.current = undefined;
            }
            lastCommittedRef.current = nextValue;
            onValueChange(nextValue);
          }}
          className="font-mono"
        />
        {(isLoading || isItemLoading) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}
