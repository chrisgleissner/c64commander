import { cn } from '@/lib/utils';
import { useDiagnosticsActivity } from '@/hooks/useDiagnosticsActivity';

type Props = {
    onClick: () => void;
    className?: string;
};

type IndicatorDotProps = {
    colorClass: string;
    count: number;
    animate: boolean;
    testId: string;
    ariaLabel: string;
};

const IndicatorDot = ({ colorClass, count, animate, testId, ariaLabel }: IndicatorDotProps) => {
    return (
        <span
            className={cn(
                'relative inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold leading-none',
                colorClass,
                animate ? 'animate-pulse-soft' : null,
            )}
            aria-label={ariaLabel}
            data-testid={testId}
            data-count={count}
            data-in-flight={animate}
        >
            {count > 0 ? <span className="text-white">{count}</span> : null}
        </span>
    );
};

export const DiagnosticsActivityIndicator = ({ onClick, className }: Props) => {
    const { restCount, ftpCount, errorCount, restInFlight, ftpInFlight } = useDiagnosticsActivity();
    const restActive = restInFlight > 0;
    const ftpActive = ftpInFlight > 0;
    const restDisplayCount = restCount > 0 ? restCount : restInFlight;

    return (
        <button
            type="button"
            className={cn('flex items-center gap-1.5', className)}
            onClick={onClick}
            aria-label="Open diagnostics"
            data-testid="diagnostics-activity-indicator"
            data-diagnostics-open-trigger="true"
        >
            {restCount > 0 || restInFlight > 0 ? (
                <IndicatorDot
                    colorClass="bg-diagnostics-rest"
                    count={restDisplayCount}
                    animate={restActive}
                    testId="diagnostics-activity-rest"
                    ariaLabel="REST activity"
                />
            ) : null}
            {ftpCount > 0 ? (
                <IndicatorDot
                    colorClass="bg-diagnostics-ftp"
                    count={ftpCount}
                    animate={ftpActive}
                    testId="diagnostics-activity-ftp"
                    ariaLabel="FTP activity"
                />
            ) : null}
            {errorCount > 0 ? (
                <IndicatorDot
                    colorClass="bg-diagnostics-error"
                    count={errorCount}
                    animate={false}
                    testId="diagnostics-activity-error"
                    ariaLabel="Error activity"
                />
            ) : null}
        </button>
    );
};
