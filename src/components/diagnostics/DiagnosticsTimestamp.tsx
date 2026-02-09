/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { cn } from '@/lib/utils';
import { splitDiagnosticsTimestamp } from '@/lib/diagnostics/timeFormat';

type Props = {
  value?: string | number | Date | null;
  className?: string;
  testId?: string;
};

export const DiagnosticsTimestamp = ({ value, className, testId }: Props) => {
  const { time, millis } = splitDiagnosticsTimestamp(value);

  return (
    <span
      className={cn('inline-flex items-baseline gap-[1px] text-xs font-semibold tabular-nums whitespace-nowrap', className)}
      data-testid={testId ?? 'diagnostics-timestamp'}
    >
      <span data-testid="diagnostics-timestamp-base">{time}</span>
      <span className="text-[10px] leading-none" data-testid="diagnostics-timestamp-ms">
        .{millis}
      </span>
    </span>
  );
};
