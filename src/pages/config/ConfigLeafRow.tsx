/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { ConfigItemRow } from "@/components/ConfigItemRow";
import type { NormalizedConfigItem } from "@/lib/config/normalizeConfigItem";
import { canonicalConfigKey, type AuthoritativeConfigValueState } from "@/hooks/useAuthoritativeConfigValueState";
import { getMenuValueFormatter } from "@/lib/config/menuMapping";

interface ConfigLeafRowProps {
  /** Canonical REST identity — used for control-type inference + write-back, never relabeled. */
  category: string;
  item: string;
  /** Friendly menu/overlay label (falls back to the REST item inside ConfigItemRow). */
  label: string;
  formatterId?: string;
  value: string | number;
  options?: string[];
  details?: NormalizedConfigItem["details"];
  readOnly?: boolean;
  authoritativeValues: AuthoritativeConfigValueState;
  writeLeaf: (category: string, item: string, value: string | number) => Promise<boolean>;
  isWriting?: boolean;
}

/**
 * Renders one projected leaf via the shared `ConfigItemRow`, wiring the menu label +
 * value formatter while keeping the REST `{category,item}` as the canonical identity for
 * control inference and write-back. The optimistic value comes from the page-shared
 * authoritative store keyed by `canonicalConfigKey`, so alias leaves (same REST pointer
 * shown twice) reflect one another and same-named items across categories never collide.
 */
export function ConfigLeafRow({
  category,
  item,
  label,
  formatterId,
  value,
  options,
  details,
  readOnly,
  authoritativeValues,
  writeLeaf,
  isWriting,
}: ConfigLeafRowProps) {
  const key = canonicalConfigKey(category, item);
  const resolvedValue = authoritativeValues.resolveValue(key, value, value);
  const formatOptionLabel = getMenuValueFormatter(formatterId);

  return (
    <ConfigItemRow
      category={category}
      name={item}
      label={label}
      value={resolvedValue}
      options={options}
      details={details}
      formatOptionLabel={formatOptionLabel}
      readOnly={readOnly}
      isLoading={Boolean(isWriting) || Boolean(authoritativeValues.pending[key])}
      onValueChange={(next) => writeLeaf(category, item, next)}
    />
  );
}
