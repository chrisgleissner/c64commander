/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

interface ConfigDefaultStateProps {
  label: string;
  defaultValue: string | number;
  onReset: () => void;
}

/** Marks an item whose value differs from the firmware default, and offers to write the default back. */
export function ConfigDefaultState({ label, defaultValue, onReset }: ConfigDefaultStateProps) {
  return (
    <div className="flex w-full flex-wrap items-center gap-x-2" data-testid="config-item-modified">
      <span className="text-xs font-medium text-muted-foreground">Modified. Default: {String(defaultValue)}</span>
      <button
        type="button"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-xs font-medium underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Reset ${label} to default`}
        data-testid="config-item-reset-default"
        onClick={onReset}
      >
        Reset to default
      </button>
    </div>
  );
}
