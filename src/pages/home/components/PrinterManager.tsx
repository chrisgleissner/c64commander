import { useActionTrace } from '@/hooks/useActionTrace';
import { useSharedConfigActions } from '../hooks/ConfigActionsContext';
import { usePrinterData } from '../hooks/usePrinterData';
import {
    PRINTER_CONTROL_SPEC,
    PRINTER_HOME_ITEMS,
    PRINTER_BUS_ID_DEFAULTS,
    DriveControlSpec,
} from '../constants';
import {
    formatPrinterLabel,
    formatPrinterOptionLabel,
    readItemOptions,
    readItemDetails,
    buildConfigKey
} from '../utils/HomeConfigUtils';
import { buildBusIdOptions } from '@/lib/drives/driveDevices';
import { SectionHeader } from '@/components/SectionHeader';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { getOnOffButtonClass } from '@/lib/ui/buttonStyles';

interface PrinterManagerProps {
    isConnected: boolean;
    machineTaskBusy: boolean;
    machineTaskId: string | null;
    onResetPrinter: (callback: () => Promise<void>) => Promise<void>;
}

export function PrinterManager({
    isConnected,
    machineTaskBusy,
    machineTaskId,
    onResetPrinter
}: PrinterManagerProps) {
    const trace = useActionTrace('PrinterManager');
    const { updateConfigValue, resolveConfigValue, configWritePending } = useSharedConfigActions();
    const { refetchDrives, printerConfig, printerDevice } = usePrinterData(isConnected);

    const printerEnabledValue = String(
        resolveConfigValue(
            undefined,
            PRINTER_CONTROL_SPEC.category,
            PRINTER_CONTROL_SPEC.enabledItem,
            printerDevice?.enabled ? 'Enabled' : 'Disabled',
        ),
    );
    const printerEnabled = printerEnabledValue.trim().toLowerCase() === 'enabled';

    const printerBusValue = Number(
        resolveConfigValue(
            undefined,
            PRINTER_CONTROL_SPEC.category,
            PRINTER_CONTROL_SPEC.busItem,
            printerDevice?.busId ?? 4,
        ),
    );

    const printerBusOptions = buildBusIdOptions(PRINTER_BUS_ID_DEFAULTS, Number.isFinite(printerBusValue) ? printerBusValue : null);
    const printerConfigPayload = printerConfig as Record<string, unknown> | undefined;

    const buildPrinterControl = (itemName: typeof PRINTER_HOME_ITEMS[number], fallback: string | number) => {
        const value = resolveConfigValue(printerConfigPayload, 'Printer Settings', itemName, fallback);
        const options = readItemOptions(printerConfigPayload, 'Printer Settings', itemName).map((entry) => String(entry));
        const details = readItemDetails(printerConfigPayload, 'Printer Settings', itemName);
        return {
            itemName,
            label: formatPrinterLabel(itemName),
            value: String(value),
            options,
            details,
            pending: Boolean(configWritePending[buildConfigKey('Printer Settings', itemName)]),
        };
    };

    const printerControlRows = [
        buildPrinterControl('Output type', 'PNG B&W'),
        buildPrinterControl('Ink density', 'Medium'),
        buildPrinterControl('Emulation', 'Commodore MPS'),
        buildPrinterControl('Commodore charset', 'USA/UK'),
        buildPrinterControl('Epson charset', 'Basic'),
        buildPrinterControl('IBM table 2', 'International 1'),
    ];

    const inlineSelectTriggerClass =
        'h-auto w-auto border-0 bg-transparent px-0 py-0 text-xs font-semibold text-foreground shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:hidden';

    const handleEnabledToggle = trace(async function handleEnabledToggle(
        label: string,
        spec: DriveControlSpec,
        enabled: boolean,
    ) {
        const nextValue = enabled ? 'Disabled' : 'Enabled';
        await updateConfigValue(
            spec.category,
            spec.enabledItem,
            nextValue,
            'HOME_DRIVE_ENABLED',
            `${label} ${enabled ? 'disabled' : 'enabled'}`,
            { refreshDrives: true },
        );
    });

    return (
        <div className="space-y-3" data-section-label="Printers">
            <SectionHeader
                title="Printers"
                resetAction={async () => await onResetPrinter(async () => { await refetchDrives(); })}
                resetDisabled={!isConnected || machineTaskBusy}
                isResetting={machineTaskId === 'reset-printer'}
                resetTestId="home-printer-reset"
            />
            <div className="space-y-2" data-testid="home-printer-group">
                <div className="bg-card border border-border rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-primary uppercase tracking-wide">Printer</p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void handleEnabledToggle('Printer', PRINTER_CONTROL_SPEC, printerEnabled)}
                            disabled={!isConnected || Boolean(configWritePending[buildConfigKey(PRINTER_CONTROL_SPEC.category, PRINTER_CONTROL_SPEC.enabledItem)])}
                            data-testid="home-printer-toggle"
                            className={cn("h-6 px-2 text-xs", getOnOffButtonClass(printerEnabled))}
                        >
                            {printerEnabled ? 'ON' : 'OFF'}
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground whitespace-nowrap">Bus ID</span>
                            <Select
                                value={String(printerBusValue)}
                                onValueChange={(value) =>
                                    void updateConfigValue(
                                        PRINTER_CONTROL_SPEC.category,
                                        PRINTER_CONTROL_SPEC.busItem,
                                        Number(value),
                                        'HOME_PRINTER_BUS',
                                        'Printer bus ID updated',
                                        { refreshDrives: true },
                                    )}
                                disabled={!isConnected || Boolean(configWritePending[buildConfigKey(PRINTER_CONTROL_SPEC.category, PRINTER_CONTROL_SPEC.busItem)])}
                            >
                                <SelectTrigger className={inlineSelectTriggerClass} data-testid="home-printer-bus">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {printerBusOptions.map((option) => (
                                        <SelectItem key={option} value={option}>
                                            {option}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {printerControlRows.filter((entry) => entry.options.length > 0).map((entry) => (
                            <div key={entry.itemName} className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground whitespace-nowrap">{entry.label}</span>
                                <Select
                                    value={entry.value}
                                    onValueChange={(value) =>
                                        void updateConfigValue(
                                            'Printer Settings',
                                            entry.itemName,
                                            value,
                                            'HOME_PRINTER_CONFIG',
                                            `${entry.label} updated`,
                                        )}
                                    disabled={!isConnected || entry.pending}
                                >
                                    <SelectTrigger className={inlineSelectTriggerClass} data-testid={`home-printer-${entry.itemName.toLowerCase().replace(/\s+/g, '-')}`}>
                                        <SelectValue>{formatPrinterOptionLabel(entry.value)}</SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {entry.options.map((option) => (
                                            <SelectItem key={option} value={option}>
                                                {formatPrinterOptionLabel(option)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
