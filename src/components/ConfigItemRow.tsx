import { useState, useEffect, useMemo } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ConfigItemRowProps {
  name: string;
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
  value,
  options,
  details,
  onValueChange,
  isLoading = false,
}: ConfigItemRowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(String(value));

  useEffect(() => {
    setInputValue(String(value));
  }, [value]);

  const optionList = useMemo(() => {
    const combined = [...(options ?? []), ...(details?.presets ?? [])]
      .map((opt) => String(opt))
      .filter((opt) => opt.length > 0 || opt === '');
    const seen = new Set<string>();
    return combined.filter((opt) => {
      if (seen.has(opt)) return false;
      seen.add(opt);
      return true;
    });
  }, [options, details?.presets]);

  const hasOptions = optionList.length > 0;
  const hasPresets = details?.presets !== undefined && details?.presets.length > 0;
  const isNumeric =
    (details?.min !== undefined && details?.max !== undefined) ||
    (typeof value === 'number' && !hasOptions && !hasPresets);
  const isPreset = details?.presets !== undefined;
  const isEditable = true;

  const getBooleanOptions = (choices: string[]) => {
    if (!choices || choices.length !== 2) return undefined;
    const normalize = (v: string) => v.trim().toLowerCase();
    const trueValues = new Set(['on', 'enabled', 'enable', 'yes', 'true', '1', 'checked']);
    const falseValues = new Set(['off', 'disabled', 'disable', 'no', 'false', '0', 'unchecked']);

    const [a, b] = choices;
    const aNorm = normalize(a);
    const bNorm = normalize(b);

    const aIsTrue = trueValues.has(aNorm);
    const aIsFalse = falseValues.has(aNorm);
    const bIsTrue = trueValues.has(bNorm);
    const bIsFalse = falseValues.has(bNorm);

    if ((aIsTrue && bIsFalse) || (aIsFalse && bIsTrue)) {
      const trueOption = aIsTrue ? a : b;
      const falseOption = aIsFalse ? a : b;
      return { trueOption, falseOption };
    }

    return undefined;
  };

  const booleanOptions = getBooleanOptions(optionList);
  const isBoolean = Boolean(booleanOptions);
  const isChecked = (() => {
    if (!isBoolean || !booleanOptions) return false;
    if (typeof value === 'number') return value !== 0;
    return String(value).trim().toLowerCase() === booleanOptions.trueOption.trim().toLowerCase();
  })();

  const handleSelect = (newValue: string) => {
    onValueChange(newValue);
    setIsOpen(false);
  };

  const handleNumericSubmit = () => {
    const numVal = parseFloat(inputValue);
    if (!isNaN(numVal)) {
      if (details?.min !== undefined && details?.max !== undefined) {
        const clamped = Math.max(details.min, Math.min(details.max, numVal));
        onValueChange(clamped);
        setInputValue(String(clamped));
      } else {
        onValueChange(numVal);
        setInputValue(String(numVal));
      }
    }
    setIsOpen(false);
  };

  const handleTextSubmit = () => {
    onValueChange(inputValue);
    setIsOpen(false);
  };

  const displayValue = typeof value === 'string' ? value : String(value);
  const selectedValue = optionList.includes(displayValue) ? displayValue : undefined;

  if (isBoolean && booleanOptions) {
    return (
      <div className="settings-row w-full flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">
            {isChecked ? booleanOptions.trueOption : booleanOptions.falseOption}
          </span>
        </div>
        <Switch
          checked={isChecked}
          disabled={isLoading}
          onCheckedChange={(checked) =>
            onValueChange(checked ? booleanOptions.trueOption : booleanOptions.falseOption)
          }
        />
      </div>
    );
  }

  if (hasOptions || isPreset) {
    return (
      <div className="settings-row w-full flex items-center justify-between gap-3">
        <span className="text-sm font-medium flex-1 pr-4">{name}</span>
        <div className="min-w-[160px] max-w-[220px]">
          <Select
            value={selectedValue}
            onValueChange={handleSelect}
            disabled={isLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select" />
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

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild disabled={!isEditable}>
        <button
          className={`settings-row w-full text-left ${isEditable ? 'cursor-pointer active:bg-muted/50' : 'cursor-default'}`}
          disabled={!isEditable}
        >
          <span className="text-sm font-medium flex-1 pr-4">{name}</span>
          <div className="flex items-center gap-2">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                <span className="value-badge max-w-[150px] truncate">
                  {displayValue || '—'}
                </span>
                {isEditable && (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </>
            )}
          </div>
        </button>
      </SheetTrigger>
      
      <SheetContent side="bottom" className="h-[70vh] rounded-t-2xl">
        <SheetHeader className="pb-4">
          <SheetTitle className="font-mono text-lg">{name}</SheetTitle>
        </SheetHeader>
        
        {isNumeric ? (
          <div className="space-y-4 p-4">
            <div className="text-sm text-muted-foreground">
              {details?.min !== undefined && details?.max !== undefined ? (
                <>Range: {details.min} — {details.max}</>
              ) : (
                <>Enter a numeric value</>
              )}
              {details?.format && ` (${details.format})`}
            </div>
            <Input
              type="number"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              min={details?.min}
              max={details?.max}
              className="font-mono text-lg"
            />
            <Button onClick={handleNumericSubmit} className="w-full">
              Apply
            </Button>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            <div className="text-sm text-muted-foreground">Enter a new value</div>
            <Input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="font-mono text-lg"
            />
            <Button onClick={handleTextSubmit} className="w-full">
              Apply
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
