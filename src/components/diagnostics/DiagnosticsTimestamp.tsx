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
