/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { getOnOffButtonClass } from '@/lib/ui/buttonStyles';
import { getDiagnosticsColorClassForDisplaySeverity, type DiagnosticsDisplaySeverity } from '@/lib/diagnostics/diagnosticsSeverity';

export interface DriveCardProps {
    name: string;
    enabled: boolean;
    onToggle: () => void;
    togglePending?: boolean;

    busIdValue: string;
    busIdOptions: string[];
    onBusIdChange: (value: string) => void;
    busIdPending?: boolean;

    // For Physical Drives
    typeValue?: string;
    typeOptions?: string[];
    onTypeChange?: (value: string) => void;
    typePending?: boolean;

    // For Soft IEC
    pathValue?: string; // Deprecated, use mountedPath
    onPathClick?: () => void; // Deprecated, use onMountedPathClick
    pathPending?: boolean;

    // New props for mounted path
    mountedPath?: string;
    mountedPathLabel?: string;
    onMountedPathClick?: () => void;
    statusSummary: string;
    statusSeverity?: DiagnosticsDisplaySeverity;
    onStatusClick?: () => void;
    statusRaw?: string;

    isConnected: boolean;
    className?: string;
    testIdSuffix: string;
}

const inlineSelectTriggerClass =
    'h-auto w-auto border-0 bg-transparent px-0 py-0 text-xs font-semibold text-foreground shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:hidden';

export function DriveCard({
    name,
    enabled,
    onToggle,
    togglePending,
    busIdValue,
    busIdOptions,
    onBusIdChange,
    busIdPending,
    typeValue,
    typeOptions,
    onTypeChange,
    typePending,
    pathValue,
    onPathClick,
    pathPending,
    mountedPath,
    mountedPathLabel,
    onMountedPathClick,
    statusSummary,
    statusSeverity = 'INFO',
    onStatusClick,
    statusRaw,
    isConnected,
    className,
    testIdSuffix,
}: DriveCardProps) {
    const formatSelectOptionLabel = (value: string) => (value === '' ? 'Default' : value);

    return (
        <div className={cn("bg-card border border-border rounded-xl p-3 space-y-2", className)} data-testid={`home-drive-row-${testIdSuffix}`}>
            {/* Row 1: Name and Power */}
            <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide">{name}</p>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onToggle}
                    disabled={!isConnected || togglePending}
                    className={cn("h-6 px-2 text-xs", getOnOffButtonClass(enabled))}
                    data-testid={`home-drive-toggle-${testIdSuffix}`}
                >
                    {enabled ? 'ON' : 'OFF'}
                </Button>
            </div>

            {/* Row 1.5: Mounted Path */}
            {(mountedPath !== undefined || pathValue !== undefined) && (
                <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground whitespace-nowrap">{mountedPathLabel || 'Disk'}</span>
                    <button
                        type="button"
                        onClick={onMountedPathClick || onPathClick}
                        disabled={!isConnected || pathPending}
                        className="font-medium text-foreground truncate hover:underline text-left flex-1"
                        data-testid={`home-drive-mounted-${testIdSuffix}`}
                    >
                        {(mountedPath ?? pathValue) || 'Select...'}
                    </button>
                </div>
            )}

            {/* Row 2: Bus ID and Type */}
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground whitespace-nowrap">Bus ID</span>
                    <Select
                        value={busIdValue}
                        onValueChange={onBusIdChange}
                        disabled={!isConnected || busIdPending}
                    >
                        <SelectTrigger className={inlineSelectTriggerClass} data-testid={`home-drive-bus-${testIdSuffix}`}>
                            <SelectValue placeholder={busIdValue} />
                        </SelectTrigger>
                        <SelectContent>
                            {busIdOptions.map((option) => (
                                <SelectItem key={option} value={option}>
                                    {formatSelectOptionLabel(option)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-2 justify-end min-w-0">
                    {typeValue !== undefined && (
                        <>
                            <span className="text-muted-foreground whitespace-nowrap">Type</span>
                            <Select
                                value={typeValue}
                                onValueChange={onTypeChange}
                                disabled={!isConnected || typePending}
                            >
                                <SelectTrigger className={inlineSelectTriggerClass} data-testid={`home-drive-type-${testIdSuffix}`}>
                                    <SelectValue placeholder={typeValue} />
                                </SelectTrigger>
                                <SelectContent>
                                    {typeOptions?.map((option) => (
                                        <SelectItem key={option} value={option}>
                                            {formatSelectOptionLabel(option)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </>
                    )}
                </div>
            </div>

            {/* Row 3: Status (always shown) */}
            <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground whitespace-nowrap">Status</span>
                <button
                    type="button"
                    onClick={onStatusClick}
                    disabled={!onStatusClick}
                    className={cn(
                        'truncate text-left font-medium',
                        onStatusClick ? 'underline-offset-2 hover:underline' : 'cursor-default',
                        getDiagnosticsColorClassForDisplaySeverity(statusSeverity),
                    )}
                    data-testid={`home-drive-status-${testIdSuffix}`}
                >
                    {statusSummary}
                </button>
            </div>
        </div>
    );
}
