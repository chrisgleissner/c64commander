import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { getC64API } from '@/lib/c64api';
import { useActionTrace } from '@/hooks/useActionTrace';
import { SectionHeader } from '@/components/SectionHeader';
import { useConfigActions } from '../hooks/useConfigActions';
import { useSidData } from '../hooks/useSidData';
import { SidCard } from '../SidCard';
import { silenceSidTargets } from '@/lib/sid/sidSilence';
import { buildSidEnablement } from '@/lib/config/sidVolumeControl';
import {
    resolveOptionIndex,
    resolveVolumeCenterIndex,
    resolvePanCenterIndex,
    clampSliderValue,
    resolveSliderIndex,
    applySoftDetent,
    formatSidBaseAddress,
    resolveSelectValue,
    resolveSidSocketToggleValue,
    resolveSidAddressDisableValue,
    resolveSidAddressEnableValue
} from '../utils/uiLogic';
import {
    buildConfigKey,
    readItemOptions,
} from '../utils/HomeConfigUtils';
import { formatDbValue, formatPanValue } from '@/lib/ui/sliderValueFormat';
import { SID_SLIDER_STEP, SID_DETECTED_ITEMS, ULTISID_PROFILE_ITEMS } from '../constants';

interface AudioMixerProps {
    isConnected: boolean;
    machineTaskBusy: boolean;
    runMachineTask: (taskId: string, action: () => Promise<void>, title: string, desc?: string) => Promise<void>;
}

export function AudioMixer({ isConnected, machineTaskBusy, runMachineTask }: AudioMixerProps) {
    const api = getC64API();
    const trace = useActionTrace('AudioMixer');
    const {
        configOverrides,
        configWritePending,
        updateConfigValue,
        resolveConfigValue,
    } = useConfigActions();

    const {
        sidControlEntries,
        sidSilenceTargets,
        sidAddressingCategory,
        ultiSidCategory,
        sidSocketsCategory,
    } = useSidData(isConnected, configOverrides);

    const [activeSliders, setActiveSliders] = useState<Record<string, number>>({});

    const ultiSidConfig = ultiSidCategory as Record<string, unknown> | undefined;
    const ultiSid1ProfileValue = String(resolveConfigValue(ultiSidConfig, 'UltiSID Configuration', 'UltiSID 1 Filter Curve', '—'));
    const ultiSid2ProfileValue = String(resolveConfigValue(ultiSidConfig, 'UltiSID Configuration', 'UltiSID 2 Filter Curve', '—'));
    const ultiSid1ProfileSelectOptions = readItemOptions(ultiSidConfig, 'UltiSID Configuration', 'UltiSID 1 Filter Curve').map((value) => String(value));
    const ultiSid2ProfileSelectOptions = readItemOptions(ultiSidConfig, 'UltiSID Configuration', 'UltiSID 2 Filter Curve').map((value) => String(value));

    // For Select compatibility (labels = values)
    const ultiSid1ProfileSelectValue = ultiSid1ProfileValue;
    const ultiSid2ProfileSelectValue = ultiSid2ProfileValue;

    const sidDetectedSocket1 = String(resolveConfigValue(
        sidSocketsCategory as Record<string, unknown> | undefined,
        'SID Sockets Configuration',
        'SID Detected Socket 1',
        'None',
    ));
    const sidDetectedSocket2 = String(resolveConfigValue(
        sidSocketsCategory as Record<string, unknown> | undefined,
        'SID Sockets Configuration',
        'SID Detected Socket 2',
        'None',
    ));

    const sidEnablement = useMemo(
        () => buildSidEnablement(
            sidSocketsCategory as Record<string, unknown> | undefined,
            sidAddressingCategory as Record<string, unknown> | undefined,
        ),
        [sidAddressingCategory, sidSocketsCategory],
    );

    const sidStatusMap = useMemo(() => new Map([
        ['socket1', sidEnablement.socket1],
        ['socket2', sidEnablement.socket2],
        ['ultiSid1', sidEnablement.ultiSid1],
        ['ultiSid2', sidEnablement.ultiSid2],
    ]), [sidEnablement]);

    const handleSidEnableToggle = trace(async function handleSidEnableToggle(
        entry: typeof sidControlEntries[number],
        enabled: boolean,
    ) {
        if (entry.key === 'socket1' || entry.key === 'socket2') {
            const socketIndex = entry.key === 'socket1' ? 1 : 2;
            const socketItem = `SID Socket ${socketIndex}`;
            const socketOptions = readItemOptions(
                sidSocketsCategory as Record<string, unknown> | undefined,
                'SID Sockets Configuration',
                socketItem,
            ).map((value) => String(value));
            const nextValue = resolveSidSocketToggleValue(socketOptions, !enabled);
            await updateConfigValue(
                'SID Sockets Configuration',
                socketItem,
                nextValue,
                'HOME_SID_ENABLED',
                `${entry.label} ${enabled ? 'disabled' : 'enabled'}`,
            );
            return;
        }

        const addressOptions = entry.addressOptions.length ? entry.addressOptions : [entry.address];
        const nextValue = enabled
            ? resolveSidAddressDisableValue(addressOptions)
            : resolveSidAddressEnableValue(addressOptions);
        await updateConfigValue(
            'SID Addressing',
            entry.addressItem,
            nextValue,
            'HOME_SID_ADDRESS',
            `${entry.label} ${enabled ? 'disabled' : 'enabled'}`,
        );
    });

    const handleSidReset = trace(async function handleSidReset() {
        await runMachineTask(
            'reset-sid',
            async () => {
                await silenceSidTargets(api, sidSilenceTargets);
                // Force config refresh after silence
                // But silence doesn't change config items?
                // It writes to memory.

                // Original code check:
                /*
                 await silenceSidTargets(api, sidSilenceTargets);
                 // We don't need to refresh config here
                */
            },
            'SID silence command sent',
            'Volume set to zero, then restored settings.',
        );
    });

    // Helper to resolve values using the utility from hook or we can use our own helper wrapper
    // The hook returns resolveConfigValue which handles overrides.



    // We need logic to map sidStatusMap?
    // Original code: const statusValue = sidStatusMap.get(entry.key);
    // sidStatusMap was in HomePage?
    // It came from `useSidStatus()` ? No.
    // Let's check HomePage.tsx for sidStatusMap.
    // It is `buildSidStatusMap(sidDetectedSocket1, sidDetectedSocket2, ultiSid1ProfileValue, ultiSid2ProfileValue)`?

    // I need to find where sidStatusMap is defined in HomePage.tsx

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.36 }}
            className="space-y-2"
            data-testid="home-sid-status"
            data-section-label="SID"
        >
            <SectionHeader
                title="SID"
                resetAction={() => void handleSidReset()}
                resetDisabled={!isConnected || machineTaskBusy}
                resetTestId="home-sid-reset"
            />
            <div className="space-y-3">
                {sidControlEntries.map((entry) => {
                    const volumeKey = buildConfigKey('Audio Mixer', entry.volumeItem);
                    const panKey = buildConfigKey('Audio Mixer', entry.panItem);
                    const addressKey = buildConfigKey('SID Addressing', entry.addressItem);

                    const statusValue = sidStatusMap.get(entry.key);
                    const isSidEnabled = statusValue !== false;

                    const volumeOptions = entry.volumeOptions.length ? entry.volumeOptions : [entry.volume];
                    const panOptions = entry.panOptions.length ? entry.panOptions : [entry.pan];
                    const volumeIndex = resolveOptionIndex(volumeOptions, entry.volume);
                    const panIndex = resolveOptionIndex(panOptions, entry.pan);
                    const volumeCenterIndex = resolveVolumeCenterIndex(volumeOptions);
                    const panCenterIndex = resolvePanCenterIndex(panOptions);
                    const volumeMax = Math.max(volumeOptions.length - 1, 0);
                    const panMax = Math.max(panOptions.length - 1, 0);
                    const volumeSliderId = `sid-${entry.key}-volume`;
                    const panSliderId = `sid-${entry.key}-pan`;
                    const volumePending = Boolean(configWritePending[volumeKey]);
                    const panPending = Boolean(configWritePending[panKey]);

                    const baseAddressLabel = formatSidBaseAddress(entry.addressRaw ?? entry.address);
                    const activeVolumeValue = activeSliders[volumeSliderId];
                    const activePanValue = activeSliders[panSliderId];
                    const volumeSliderValue = clampSliderValue(activeVolumeValue ?? volumeIndex, volumeMax);
                    const panSliderValue = clampSliderValue(activePanValue ?? panIndex, panMax);

                    const isUltiSid = entry.key === 'ultiSid1' || entry.key === 'ultiSid2';
                    const resolveVolumeIndexValue = (value: number) =>
                        resolveSliderIndex(applySoftDetent(value, volumeCenterIndex), volumeMax);
                    const resolvePanIndexValue = (value: number) =>
                        resolveSliderIndex(applySoftDetent(value, panCenterIndex), panMax);
                    const resolveVolumeOption = (value: number) =>
                        volumeOptions[resolveVolumeIndexValue(value)] ?? volumeOptions[0] ?? entry.volume;
                    const resolvePanOption = (value: number) =>
                        panOptions[resolvePanIndexValue(value)] ?? panOptions[0] ?? entry.pan;
                    const volumeValueFormatter = (value: number) =>
                        formatDbValue(String(volumeOptions[Math.round(value)] ?? volumeOptions[0] ?? ''));
                    const panValueFormatter = (value: number) =>
                        formatPanValue(String(panOptions[Math.round(value)] ?? panOptions[0] ?? ''));

                    const handleVolumeLocalChange = (val: number) => {
                        const snapped = clampSliderValue(applySoftDetent(val, volumeCenterIndex), volumeMax);
                        setActiveSliders((prev) => ({ ...prev, [volumeSliderId]: snapped }));
                    };
                    const handleVolumeLocalCommit = (_val: number) => {
                        setActiveSliders((prev) => {
                            const next = { ...prev };
                            delete next[volumeSliderId];
                            return next;
                        });
                    };
                    const handleVolumeAsyncChange = (val: number) => {
                        const v = resolveVolumeOption(val);
                        void updateConfigValue('Audio Mixer', entry.volumeItem, v, 'HOME_SID_VOLUME', `${entry.label} volume updated`, { suppressToast: true });
                    };
                    const handleVolumeAsyncCommit = (val: number) => {
                        const v = resolveVolumeOption(val);
                        void updateConfigValue('Audio Mixer', entry.volumeItem, v, 'HOME_SID_VOLUME', `${entry.label} volume updated`);
                    };
                    const handlePanLocalChange = (val: number) => {
                        const snapped = clampSliderValue(applySoftDetent(val, panCenterIndex), panMax);
                        setActiveSliders((prev) => ({ ...prev, [panSliderId]: snapped }));
                    };
                    const handlePanLocalCommit = (_val: number) => {
                        setActiveSliders((prev) => {
                            const next = { ...prev };
                            delete next[panSliderId];
                            return next;
                        });
                    };
                    const handlePanAsyncChange = (val: number) => {
                        const v = resolvePanOption(val);
                        void updateConfigValue('Audio Mixer', entry.panItem, v, 'HOME_SID_PAN', `${entry.label} pan updated`, { suppressToast: true });
                    };
                    const handlePanAsyncCommit = (val: number) => {
                        const v = resolvePanOption(val);
                        void updateConfigValue('Audio Mixer', entry.panItem, v, 'HOME_SID_PAN', `${entry.label} pan updated`);
                    };

                    // Identity / Filter
                    const identityLabel = isUltiSid ? 'Filter' : 'SID';
                    const identityValue = entry.key === 'socket1'
                        ? sidDetectedSocket1
                        : entry.key === 'socket2'
                            ? sidDetectedSocket2
                            : entry.key === 'ultiSid1'
                                ? ultiSid1ProfileValue
                                : ultiSid2ProfileValue;
                    const identityOptions = isUltiSid
                        ? (entry.key === 'ultiSid1' ? ultiSid1ProfileSelectOptions : ultiSid2ProfileSelectOptions)
                        : undefined;
                    const identitySelectValue = isUltiSid
                        ? (entry.key === 'ultiSid1' ? ultiSid1ProfileSelectValue : ultiSid2ProfileSelectValue)
                        : undefined;
                    const identityPending = isUltiSid
                        ? Boolean(configWritePending[buildConfigKey('UltiSID Configuration', entry.key === 'ultiSid1' ? 'UltiSID 1 Filter Curve' : 'UltiSID 2 Filter Curve')])
                        : false;

                    // Address
                    const addressOptions = readItemOptions(sidAddressingCategory as Record<string, unknown> | undefined, 'SID Addressing', entry.addressItem).map(String);
                    const addressSelectValue = resolveSelectValue(String(entry.addressRaw ?? entry.address));
                    const addressPending = Boolean(configWritePending[addressKey]);

                    // Shaping Controls
                    const shapingControls = [];
                    if (isUltiSid) {
                        const ultiIndex = entry.key === 'ultiSid1' ? 1 : 2;
                        const resonanceItem = `UltiSID ${ultiIndex} Filter Resonance`;
                        const waveformItem = `UltiSID ${ultiIndex} Combined Waveforms`;
                        const digisItem = `UltiSID ${ultiIndex} Digis Level`;

                        shapingControls.push({
                            label: 'Reson',
                            value: String(resolveConfigValue(ultiSidCategory as Record<string, unknown> | undefined, 'UltiSID Configuration', resonanceItem, '—')),
                            options: readItemOptions(ultiSidCategory as Record<string, unknown> | undefined, 'UltiSID Configuration', resonanceItem).map(String),
                            onChange: (val: string) => void updateConfigValue('UltiSID Configuration', resonanceItem, resolveSelectValue(val), `HOME_ULTISID_RES_${ultiIndex}`, `UltiSID ${ultiIndex} resonance updated`),
                            pending: Boolean(configWritePending[buildConfigKey('UltiSID Configuration', resonanceItem)]),
                        });
                        shapingControls.push({
                            label: 'Wave',
                            value: String(resolveConfigValue(ultiSidCategory as Record<string, unknown> | undefined, 'UltiSID Configuration', waveformItem, '—')),
                            options: readItemOptions(ultiSidCategory as Record<string, unknown> | undefined, 'UltiSID Configuration', waveformItem).map(String),
                            onChange: (val: string) => void updateConfigValue('UltiSID Configuration', waveformItem, resolveSelectValue(val), `HOME_ULTISID_WAVE_${ultiIndex}`, `UltiSID ${ultiIndex} waveform updated`),
                            pending: Boolean(configWritePending[buildConfigKey('UltiSID Configuration', waveformItem)]),
                        });
                        shapingControls.push({
                            label: 'Digis',
                            value: String(resolveConfigValue(ultiSidCategory as Record<string, unknown> | undefined, 'UltiSID Configuration', digisItem, '—')),
                            options: readItemOptions(ultiSidCategory as Record<string, unknown> | undefined, 'UltiSID Configuration', digisItem).map(String),
                            onChange: (val: string) => void updateConfigValue('UltiSID Configuration', digisItem, resolveSelectValue(val), `HOME_ULTISID_DIGIS_${ultiIndex}`, `UltiSID ${ultiIndex} digis updated`),
                            pending: Boolean(configWritePending[buildConfigKey('UltiSID Configuration', digisItem)]),
                        });
                    }

                    const socketItemName = entry.key === 'socket1' ? 'SID Socket 1' : entry.key === 'socket2' ? 'SID Socket 2' : null;
                    const toggleKey = socketItemName
                        ? buildConfigKey('SID Sockets Configuration', socketItemName)
                        : addressKey;
                    const togglePending = Boolean(configWritePending[toggleKey]);

                    return (
                        <SidCard
                            key={entry.key}
                            name={entry.label}
                            power={isSidEnabled}
                            onPowerToggle={() => void handleSidEnableToggle(entry, isSidEnabled)}
                            powerPending={togglePending}

                            identityLabel={identityLabel}
                            identityValue={identitySelectValue || identityValue} // Prefer SelectValue (resolved)
                            identityOptions={identityOptions}
                            onIdentityChange={(val) => {
                                if (isUltiSid) {
                                    void updateConfigValue(
                                        'UltiSID Configuration',
                                        entry.key === 'ultiSid1' ? 'UltiSID 1 Filter Curve' : 'UltiSID 2 Filter Curve',
                                        resolveSelectValue(val),
                                        'HOME_ULTISID_PROFILE',
                                        'UltiSID filter curve updated'
                                    );
                                }
                            }}
                            identityPending={identityPending}
                            isIdentityReadOnly={!isUltiSid}

                            addressValue={addressSelectValue || baseAddressLabel}
                            addressOptions={addressOptions}
                            onAddressChange={(val) => void updateConfigValue('SID Addressing', entry.addressItem, resolveSelectValue(val), 'HOME_SID_ADDRESS', `${entry.label} address updated`)}
                            addressPending={addressPending}
                            shapingControls={shapingControls}
                            volume={volumeSliderValue}
                            volumeMax={volumeMax}
                            volumeStep={SID_SLIDER_STEP}
                            onVolumeChange={handleVolumeLocalChange}
                            onVolumeCommit={handleVolumeLocalCommit}
                            onVolumeChangeAsync={handleVolumeAsyncChange}
                            onVolumeCommitAsync={handleVolumeAsyncCommit}
                            volumeValueFormatter={volumeValueFormatter}
                            volumeMidpoint={volumeCenterIndex}
                            volumePending={volumePending}
                            pan={panSliderValue}
                            panMax={panMax}
                            panStep={SID_SLIDER_STEP}
                            onPanChange={handlePanLocalChange}
                            onPanCommit={handlePanLocalCommit}
                            onPanChangeAsync={handlePanAsyncChange}
                            onPanCommitAsync={handlePanAsyncCommit}
                            panValueFormatter={panValueFormatter}
                            panMidpoint={panCenterIndex}
                            panPending={panPending}
                            isConnected={isConnected}
                            testIdSuffix={entry.key}
                        />
                    );
                })}
            </div>
        </motion.div>
    );
}
