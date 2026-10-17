/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  effectiveValue: string;
  error?: string | null;
  children?: ReactNode;
};

// The effective value is printed under the field: as a placeholder it was cut off at the field's edge.
export const ArchiveOverrideField = ({ id, label, value, onChange, effectiveValue, error, children }: Props) => (
  <div className="space-y-2">
    <Label htmlFor={id} className="text-sm font-medium">
      {label}
    </Label>
    <Input
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Default"
      aria-describedby={error ? `${id}-error` : undefined}
      aria-invalid={error ? true : undefined}
      data-testid={id}
    />
    <p className="break-normal text-xs text-muted-foreground" data-testid={`${id}-effective`}>
      In use: {effectiveValue}
    </p>
    {error ? (
      <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
        {error}
      </p>
    ) : null}
    {children}
  </div>
);
