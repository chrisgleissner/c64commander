import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type DiagnosticsListItemMode = 'trace' | 'action';

type Props = {
    mode: DiagnosticsListItemMode;
    title: string;
    timestamp: string;
    origin?: 'user' | 'system' | null;
    secondaryLeft?: ReactNode;
    secondaryRight?: ReactNode;
    children?: ReactNode;
    testId?: string;
};

export const DiagnosticsListItem = ({
    mode,
    title,
    timestamp,
    origin,
    secondaryLeft,
    secondaryRight,
    children,
    testId,
}: Props) => {
    const showOrigin = mode === 'action' && origin;
    const originClass =
        origin === 'user'
            ? 'bg-diagnostics-user'
            : origin === 'system'
                ? 'bg-diagnostics-system'
                : undefined;

    return (
        <details className="rounded-lg border border-border p-3" data-testid={testId}>
            <summary className="cursor-pointer select-none">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-sm font-medium">
                    <div className="flex items-start gap-2 min-w-0">
                        {showOrigin ? (
                            <span
                                className={cn('mt-1 h-2.5 w-2.5 rounded-full shrink-0', originClass)}
                                aria-label={origin ?? undefined}
                            />
                        ) : null}
                        <span className="min-w-0 break-words whitespace-normal">{title}</span>
                    </div>
                    <span className="text-muted-foreground font-mono text-xs tabular-nums text-right shrink-0">
                        {timestamp}
                    </span>
                </div>
                {secondaryLeft || secondaryRight ? (
                    <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-xs">
                        <div className={cn('min-w-0 flex flex-wrap items-center gap-2', showOrigin ? 'pl-5' : undefined)}>
                            {secondaryLeft}
                        </div>
                        <div className="text-muted-foreground font-mono tabular-nums text-right shrink-0">
                            {secondaryRight}
                        </div>
                    </div>
                ) : null}
            </summary>
            {children ? <div className="mt-3 text-xs">{children}</div> : null}
        </details>
    );
};
