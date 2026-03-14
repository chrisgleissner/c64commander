import { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  formatSelectOptionLabel,
  normalizeOptionToken,
  normalizeSelectOptions,
  normalizeSelectValue,
  resolveSelectValue,
  resolveToggleOption,
} from "../utils/uiLogic";

type SummaryConfigCardProps = {
  children: ReactNode;
  sectionLabel?: string;
  testId: string;
  title: string;
};

type SummaryConfigControlRowProps = {
  controlType?: "auto" | "checkbox" | "select";
  disabled: boolean;
  label: string;
  onValueChange: (value: string) => void;
  options: string[];
  selectTriggerClassName: string;
  testId: string;
  toggleHints?: {
    enabled?: string[];
    disabled?: string[];
  };
  value: string;
};

export function SummaryConfigCard({ children, sectionLabel, testId, title }: SummaryConfigCardProps) {
  return (
    <div
      className="bg-card border border-border rounded-xl p-3 space-y-2"
      data-section-label={sectionLabel}
      data-testid={testId}
    >
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">{title}</p>
      <div className="space-y-2 text-xs">{children}</div>
    </div>
  );
}

export function SummaryConfigControlRow({
  controlType = "auto",
  disabled,
  label,
  onValueChange,
  options,
  selectTriggerClassName,
  testId,
  toggleHints,
  value,
}: SummaryConfigControlRowProps) {
  const normalizedOptions = options.map((option) => String(option));
  const shouldRenderCheckbox = controlType === "checkbox" || (controlType === "auto" && normalizedOptions.length === 2);

  if (shouldRenderCheckbox) {
    const enabledValue = resolveToggleOption(normalizedOptions, true, toggleHints);
    const disabledValue = resolveToggleOption(normalizedOptions, false, toggleHints);
    const checked = normalizeOptionToken(value) === normalizeOptionToken(enabledValue);

    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center justify-end">
          <Checkbox
            checked={checked}
            onCheckedChange={(nextValue) => onValueChange(nextValue === true ? enabledValue : disabledValue)}
            disabled={disabled}
            className="h-4 w-4"
            aria-label={label}
            data-testid={testId}
          />
        </div>
      </div>
    );
  }

  const selectOptions = normalizeSelectOptions(normalizedOptions, value);
  const selectValue = normalizeSelectValue(value);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <Select
        value={selectValue}
        onValueChange={(nextValue) => onValueChange(resolveSelectValue(nextValue))}
        disabled={disabled}
      >
        <SelectTrigger className={selectTriggerClassName} data-testid={testId}>
          <SelectValue placeholder={value} />
        </SelectTrigger>
        <SelectContent>
          {selectOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {formatSelectOptionLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
