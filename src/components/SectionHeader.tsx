import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SectionHeaderProps {
    title: string;
    resetAction?: () => void;
    resetLabel?: string;
    resetDisabled?: boolean;
    isResetting?: boolean;
    className?: string;
    children?: React.ReactNode;
    resetTestId?: string;
}

export function SectionHeader({
    title,
    resetAction,
    resetLabel = 'Reset',
    resetDisabled = false,
    isResetting = false,
    className,
    children,
    resetTestId,
}: SectionHeaderProps) {
    return (
        <div className={cn("flex items-center justify-between gap-2", className)}>
            <h3 className="category-header">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                {title}
                {children}
            </h3>
            {resetAction && (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={resetAction}
                    disabled={resetDisabled}
                    data-testid={resetTestId}
                >
                    {isResetting ? 'Resetting…' : resetLabel}
                </Button>
            )}
        </div>
    );
}
