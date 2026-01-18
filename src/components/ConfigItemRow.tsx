import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useC64ConfigItem } from '@/hooks/useC64Connection';
import { getCheckboxMapping, inferControlKind } from '@/lib/config/controlType';

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
}

export function ConfigItemRow({
  name,
  category,
  value,
  options,
  details,
  onValueChange,
  isLoading = false,
}: ConfigItemRowProps) {
  const [inputValue, setInputValue] = useState(String(value));
  const lastCommittedRef = useRef<string>(String(value));
  const debounceTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setInputValue(String(value));
    lastCommittedRef.current = String(value);
  }, [value]);

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
        currentValue: mergedValue,
        possibleValues: optionList,
      }),
    [name, mergedValue, optionList],
  );

  const displayValue = typeof mergedValue === 'string' ? mergedValue : String(mergedValue);

  if (controlKind === 'checkbox' && checkboxMapping) {
    const checked =
      String(displayValue).trim().toLowerCase() === checkboxMapping.checkedValue.trim().toLowerCase();

    return (
      <div className="settings-row w-full flex items-center justify-between gap-3">
        <div className="flex flex-col flex-1 pr-4">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">
            {checked ? checkboxMapping.checkedValue : checkboxMapping.uncheckedValue}
          </span>
        </div>
        <Checkbox
          checked={checked}
          disabled={isLoading || isItemLoading}
          onCheckedChange={(next) => {
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
    const selectedValue = optionList.includes(displayValue) ? displayValue : undefined;

    return (
      <div className="settings-row w-full flex items-center justify-between gap-3">
        <span className="text-sm font-medium flex-1 pr-4">{name}</span>
        <div className="min-w-[160px] max-w-[220px]">
          <Select
            value={selectedValue}
            onValueChange={(newValue) => {
              setInputValue(String(newValue));
              lastCommittedRef.current = String(newValue);
              onValueChange(newValue);
            }}
            disabled={isLoading || isItemLoading}
          >
            <SelectTrigger aria-label={`${name} select`}>
              <SelectValue placeholder={isItemLoading ? 'Loading…' : displayValue || 'Select'} />
            </SelectTrigger>
            <SelectContent>
              {optionList.map((option) => (
                <SelectItem key={option} value={option}>
                  {option || '(empty)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  const inputType = controlKind === 'password' ? 'password' : 'text';

  return (
    <div className="settings-row w-full flex items-center justify-between gap-3">
      <span className="text-sm font-medium flex-1 pr-4">{name}</span>
      <div className="min-w-[160px] max-w-[220px] flex items-center gap-2">
        <Input
          type={inputType}
          value={inputValue}
          disabled={isLoading || isItemLoading}
          onChange={(e) => {
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
          aria-label={`${name} ${controlKind === 'password' ? 'password' : 'text'} input`}
        />
        {(isLoading || isItemLoading) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}
