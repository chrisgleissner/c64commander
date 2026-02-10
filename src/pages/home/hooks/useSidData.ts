import { useMemo } from 'react';
import { useC64ConfigItems } from '@/hooks/useC64Connection';
import {
    HOME_SID_SOCKET_ITEMS,
    HOME_ULTISID_ITEMS,
    HOME_SID_ADDRESSING_ITEMS,
    SID_AUDIO_ITEMS,
} from '../constants';
import { buildSidControlEntries } from '@/lib/config/sidDetails';
import { buildConfigKey } from '../utils/HomeConfigUtils';
import { buildSidSilenceTargets } from '@/lib/sid/sidSilence';

export function useSidData(
    isConnected: boolean,
    configOverrides: Record<string, string | number>
) {
    const { data: sidSocketsCategory } = useC64ConfigItems(
        'SID Sockets Configuration',
        [...HOME_SID_SOCKET_ITEMS],
        isConnected,
    );
    const { data: ultiSidCategory } = useC64ConfigItems(
        'UltiSID Configuration',
        [...HOME_ULTISID_ITEMS],
        isConnected,
    );
    const { data: sidAddressingCategory } = useC64ConfigItems(
        'SID Addressing',
        [...HOME_SID_ADDRESSING_ITEMS],
        isConnected,
    );
    const { data: audioMixerCategory } = useC64ConfigItems(
        'Audio Mixer',
        [...SID_AUDIO_ITEMS],
        isConnected,
    );

    const sidControlEntries = useMemo(() => {
        const entries = buildSidControlEntries(
            audioMixerCategory as Record<string, unknown> | undefined,
            sidAddressingCategory as Record<string, unknown> | undefined,
        );
        return entries.map((entry) => {
            const volumeOverride = configOverrides[buildConfigKey('Audio Mixer', entry.volumeItem)];
            const panOverride = configOverrides[buildConfigKey('Audio Mixer', entry.panItem)];
            const addressOverride = configOverrides[buildConfigKey('SID Addressing', entry.addressItem)];
            return {
                ...entry,
                volume: volumeOverride !== undefined ? String(volumeOverride) : entry.volume,
                pan: panOverride !== undefined ? String(panOverride) : entry.pan,
                addressRaw: addressOverride !== undefined ? String(addressOverride) : entry.addressRaw,
            };
        });
    }, [audioMixerCategory, configOverrides, sidAddressingCategory]);

    const sidSilenceTargets = useMemo(() => buildSidSilenceTargets(sidControlEntries), [sidControlEntries]);

    return {
        sidSocketsCategory,
        ultiSidCategory,
        sidAddressingCategory,
        audioMixerCategory,
        sidControlEntries,
        sidSilenceTargets
    };
}
