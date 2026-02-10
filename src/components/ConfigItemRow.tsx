/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  label?: string;
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
  readOnly?: boolean;
  className?: string;
  rightAccessory?: React.ReactNode;
  valueTestId?: string;
  sliderTestId?: string;
  formatOptionLabel?: (value: string) => string;
}

type ConfigItemLayoutMode = 'horizontal' | 'vertical';

const HORIZONTAL_GAP_PX = 12;
const HORIZONTAL_LABEL_PADDING_PX = 16;

const useAdaptiveLabelLayout = (label: string, widgetMinWidth: number) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const [layout, setLayout] = useState<ConfigItemLayoutMode>('horizontal');

  const measureLayout = useCallback(() => {
    const container = containerRef.current;
    const labelEl = labelRef.current;
    if (!container || !labelEl) return;
    const containerWidth = container.clientWidth;
    if (!containerWidth) return;
    const labelWidth = labelEl.scrollWidth;
    const labelRect = labelEl.getBoundingClientRect();
    const labelIsVertical = labelRect.width > 0 && labelRect.height > labelRect.width * 1.2;
    const requiredWidth = labelWidth + widgetMinWidth + HORIZONTAL_GAP_PX + HORIZONTAL_LABEL_PADDING_PX;
    const nextLayout: ConfigItemLayoutMode =
      labelIsVertical || containerWidth < requiredWidth ? 'vertical' : 'horizontal';
    setLayout((prev) => (prev === nextLayout ? prev : nextLayout));
  }, [widgetMinWidth]);

  useLayoutEffect(() => {
    measureLayout();
  }, [measureLayout, label]);

  useEffect(() => {
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        measureLayout();
      })
      : null;
    if (observer) {
      if (containerRef.current) observer.observe(containerRef.current);
      if (labelRef.current) observer.observe(labelRef.current);
    }
    window.addEventListener('resize', measureLayout);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureLayout);
    };
  }, [measureLayout]);

  return { layout, containerRef, labelRef };
};

export function ConfigItemRow({
  name,
  category,
  value,
  options,
  details,
  onValueChange,
  isLoading = false,
  readOnly = false,
  className,
  rightAccessory,
  valueTestId,
  sliderTestId,
  label,
  formatOptionLabel,
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

  const widgetMinWidth = useMemo(() => {
    if (controlKind === 'slider') {
      return rightAccessory ? 320 : 220;
    }
    if (controlKind === 'select') {
      return 160;
    }
    if (controlKind === 'checkbox') {
      return 44;
    }
    return 160;
  }, [controlKind, rightAccessory]);

  const displayLabel = label ?? name;
  const formatOption = (option: string) => (formatOptionLabel ? formatOptionLabel(option) : option);

  const { layout, containerRef, labelRef } = useAdaptiveLabelLayout(displayLabel, widgetMinWidth);

  const rowClassName = cn(
    'settings-row w-full',
    layout === 'horizontal'
      ? 'flex items-center justify-between gap-3'
      : 'flex flex-col items-stretch gap-2',
    className,
  );

  const labelBlockClassName = cn(
    'flex flex-col',
    layout === 'horizontal' ? 'shrink-0 pr-4' : 'w-full',
  );

  const labelClassName = cn(
    'text-sm font-medium block',
    layout === 'horizontal' ? 'whitespace-nowrap' : 'break-words w-full',
  );

  const displayValue = inputValue;
  const isReadOnly = readOnly || name.startsWith('SID Detected Socket');
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
      <div
        ref={containerRef}
        className={rowClassName}
        data-testid="config-item-layout"
        data-layout={layout}
      >
        <div className={labelBlockClassName}>
          <span ref={labelRef} className={labelClassName} data-testid="config-item-label">
            {displayLabel}
          </span>
          <span className="text-xs text-muted-foreground">
            {checked ? checkboxMapping.checkedValue : checkboxMapping.uncheckedValue}
          </span>
        </div>
        <div className={layout === 'horizontal' ? undefined : 'self-start'}>
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
            aria-label={`${displayLabel} checkbox`}
          />
        </div>
      </div>
    );
  }

  if (controlKind === 'select') {
    const emptySentinel = '__empty__';
    const normalizedOptions = optionList.includes(displayValue) || displayValue === ''
      ? optionList
      : [...optionList, displayValue];
    const selectOptions = normalizedOptions.map((option) => ({
      raw: option,
      value: option === '' ? emptySentinel : option,
      label: option === '' ? '(empty)' : formatOption(option),
    }));
    const selectedValue = displayValue === '' ? emptySentinel : displayValue;
    const displayValueLabel = displayValue === '' ? '(empty)' : formatOption(String(displayValue));

    return (
      <div
        ref={containerRef}
        className={rowClassName}
        data-testid="config-item-layout"
        data-layout={layout}
      >
        <div className={labelBlockClassName}>
          <span ref={labelRef} className={labelClassName} data-testid="config-item-label">
            {displayLabel}
          </span>
        </div>
        <div className={layout === 'horizontal' ? 'min-w-[160px] max-w-[220px]' : 'w-full'}>
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
            <SelectTrigger aria-label={`${displayLabel} select`}>
              <SelectValue placeholder={isItemLoading ? 'Loading…' : displayValueLabel || 'Select'} />
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

    const currentLabelRaw = sliderOptions[selectedIndex] ?? displayValue;
    const currentLabel = formatOption(String(currentLabelRaw));
    const resolveSliderOption = (index: number) =>
      sliderOptions[Math.round(index)] ?? sliderOptions[0] ?? '';
    const formatSliderLabel = (index: number) => formatOption(String(resolveSliderOption(index)));

    return (
      <div
        ref={containerRef}
        className={rowClassName}
        data-testid="config-item-layout"
        data-layout={layout}
      >
        <div className={labelBlockClassName}>
          <span ref={labelRef} className={labelClassName} data-testid="config-item-label">
            {displayLabel}
          </span>
          <span className="text-xs text-muted-foreground font-semibold" data-testid={valueTestId}>
            {currentLabel}
          </span>
        </div>
        <div
          className={
            layout === 'horizontal'
              ? 'flex items-center gap-3 min-w-[220px] max-w-[320px] w-full'
              : 'flex flex-wrap items-center gap-3 w-full'
          }
        >
          <div className={layout === 'horizontal' ? 'min-w-[180px] max-w-[260px] w-full' : 'w-full'}>
            <Slider
              value={[selectedIndex]}
              min={0}
              max={sliderOptions.length - 1}
              step={1}
              disabled={isLoading || isItemLoading || isReadOnly}
              onValueChange={(values) => {
                if (isReadOnly) return;
                const nextIndex = values[0] ?? 0;
                const nextValue = resolveSliderOption(nextIndex);
                setInputValue(String(nextValue));
              }}
              onValueCommit={(values) => {
                if (isReadOnly) return;
                const nextIndex = values[0] ?? 0;
                const nextValue = resolveSliderOption(nextIndex);
                setInputValue(String(nextValue));
              }}
              onValueChangeAsync={(nextIndex) => {
                if (isReadOnly) return;
                const nextValue = resolveSliderOption(nextIndex);
                onValueChange(nextValue);
              }}
              onValueCommitAsync={(nextIndex) => {
                if (isReadOnly) return;
                const nextValue = resolveSliderOption(nextIndex);
                if (String(nextValue) === lastCommittedRef.current) return;
                lastCommittedRef.current = String(nextValue);
                onValueChange(nextValue);
              }}
              valueFormatter={formatSliderLabel}
              aria-label={`${displayLabel} slider`}
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
    <div
      ref={containerRef}
      className={rowClassName}
      data-testid="config-item-layout"
      data-layout={layout}
    >
      <div className={labelBlockClassName}>
        <span ref={labelRef} className={labelClassName} data-testid="config-item-label">
          {displayLabel}
        </span>
      </div>
      <div className={layout === 'horizontal' ? 'min-w-[160px] max-w-[220px] flex items-center gap-2' : 'w-full flex items-center gap-2'}>
        <Input
          type={inputType}
          value={inputValue}
          aria-label={`${displayLabel} ${controlKind === 'password' ? 'password' : 'text'} input`}
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
          className="font-sans"
        />
        {(isLoading || isItemLoading) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}
