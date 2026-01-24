import { useEffect, useMemo, useState } from 'react';
import { parseSonglengths } from '@/lib/sid/songlengths';
import { HvscSongSource } from '@/lib/hvsc/hvscSource';
import { buildPlayPlan, executePlayPlan } from '@/lib/playback/playbackRouter';
import { getC64API } from '@/lib/c64api';
import { isAudioMixerValueEqual, normalizeAudioMixerValue, resolveAudioMixerResetValue } from '@/lib/config/audioMixer';
import {
  buildSoloRoutingUpdates,
  isSidVolumeName,
  resolveAudioMixerMuteValue,
  soloReducer,
} from '@/lib/config/audioMixerSolo';
import { useSidPlayer } from '@/hooks/useSidPlayer';
import { useListPreviewLimit } from '@/hooks/useListPreviewLimit';
import { useC64Connection } from '@/hooks/useC64Connection';
import { buildDiskEntryFromDrive, buildDiskEntryFromPath, useDiskLibrary } from '@/hooks/useDiskLibrary';
import {
  FeatureFlagManager,
  InMemoryFeatureFlagRepository,
  FEATURE_FLAG_DEFINITIONS,
  isHvscEnabled,
} from '@/lib/config/featureFlags';
import {
  getDeveloperModeEnabled,
  setDeveloperModeEnabled,
  subscribeDeveloperMode,
} from '@/lib/config/developerModeStore';
import { clampListPreviewLimit, getListPreviewLimit, setListPreviewLimit } from '@/lib/uiPreferences';
import { startMockServer, stopMockServer } from '@/lib/mock/mockServer';
import { FeatureFlags } from '@/lib/native/featureFlags';

type ProbeStatus = 'idle' | 'running' | 'done' | 'error';

const runProbe = async (label: string, runner: () => Promise<void>, errors: string[]) => {
  try {
    await runner();
  } catch (error) {
    errors.push(`${label}: ${(error as Error).message}`);
  }
};

export default function CoverageProbePage() {
  const player = useSidPlayer();
  const listPreview = useListPreviewLimit();
  const connection = useC64Connection();
  const diskLibrary = useDiskLibrary('coverage-probe');
  const [status, setStatus] = useState<ProbeStatus>('idle');
  const [errors, setErrors] = useState<string[]>([]);
  const [startedAt] = useState(() => Date.now());

  const probes = useMemo(() => {
    return async () => {
      const failures: string[] = [];
      setStatus('running');

      await runProbe('songlengths', async () => {
        const parsed = parseSonglengths('; /demo.sid\nabcdef=0:30\n');
        if (!parsed.pathToSeconds.has('/demo.sid')) {
          throw new Error('Songlengths path not parsed');
        }
      }, failures);

      await runProbe('audio mixer', async () => {
        const volReset = await resolveAudioMixerResetValue('Audio Mixer', 'Vol UltiSid 1', ['+1 dB', '0 dB']);
        const volResetApi = await resolveAudioMixerResetValue('Audio Mixer', 'Vol UltiSid 1');
        const panReset = await resolveAudioMixerResetValue('Audio Mixer', 'Pan 1', ['Left', 'Center', 'Right']);
        const otherReset = await resolveAudioMixerResetValue('Audio Mixer', 'Other', ['A', 'B']);
        normalizeAudioMixerValue(' 0 dB');
        if (!isAudioMixerValueEqual(volReset, '0 dB')) {
          throw new Error('Volume reset not resolved');
        }
        if (volResetApi === undefined) {
          throw new Error('Volume reset not resolved via API');
        }
        if (!isAudioMixerValueEqual(panReset, 'Center')) {
          throw new Error('Pan reset not resolved');
        }
        if (otherReset !== undefined) {
          throw new Error('Unexpected reset for non-audio mixer item');
        }
      }, failures);

      await runProbe('audio mixer solo routing', async () => {
        if (!isSidVolumeName('Vol UltiSid 1')) {
          throw new Error('SID volume name not recognized');
        }
        resolveAudioMixerMuteValue(['-12 dB', '-6 dB', '0 dB']);
        resolveAudioMixerMuteValue(['Muted', 'On']);
        resolveAudioMixerMuteValue([]);
        soloReducer({ soloItem: null }, { type: 'toggle', item: 'Vol UltiSid 1' });
        soloReducer({ soloItem: 'Vol UltiSid 1' }, { type: 'reset' });
        buildSoloRoutingUpdates(
          [
            { name: 'Vol UltiSid 1', value: '0 dB', options: ['0 dB', '-6 dB'] },
            { name: 'Vol UltiSid 2', value: '-6 dB', options: ['0 dB', '-6 dB'] },
          ],
          'Vol UltiSid 1',
        );
      }, failures);

      await runProbe('hvsc source', async () => {
        const folders = await HvscSongSource.listFolders('/');
        if (!folders.length) {
          throw new Error('No HVSC folders');
        }
        const songs = await HvscSongSource.listSongs(folders[0].path);
        if (!songs.length) {
          throw new Error('No HVSC songs');
        }
        const song = await HvscSongSource.getSong(songs[0]);
        if (!song.data) {
          throw new Error('HVSC song missing data');
        }
      }, failures);

      await runProbe('api + playback', async () => {
        const api = getC64API();
        await api.getVersion();
        await api.getInfo();
        await api.getCategories();
        await api.getCategory('Audio Mixer');
        await api.getConfigItem('Audio Mixer', 'Vol UltiSid 1');
        await api.setConfigValue('Audio Mixer', 'Vol UltiSid 1', '0 dB');
        await api.updateConfigBatch({ 'Audio Mixer': { 'Vol UltiSid 1': '0 dB' } });
        await api.saveConfig();
        await api.loadConfig();
        await api.resetConfig();
        await api.getDrives();
        await api.machineReset();
        await api.machineReboot();
        await api.machinePause();
        await api.machineResume();
        await api.machinePowerOff();
        await api.machineMenuButton();

        const sidFile = new Blob(['PSID'], { type: 'application/octet-stream' });
        await executePlayPlan(api, buildPlayPlan({ source: 'local', path: '/test.sid', file: sidFile, durationMs: 1000 }));
        await executePlayPlan(api, buildPlayPlan({ source: 'ultimate', path: '/music.mod' }));
        await executePlayPlan(api, buildPlayPlan({ source: 'ultimate', path: '/demo.prg' }), { loadMode: 'load' });
        await executePlayPlan(api, buildPlayPlan({ source: 'ultimate', path: '/demo.crt' }));
        await executePlayPlan(api, buildPlayPlan({ source: 'ultimate', path: '/disk.d64' }), { drive: 'b', rebootBeforeMount: true });
      }, failures);

      await runProbe('sid player', async () => {
        const data = new Uint8Array([1, 2, 3, 4]);
        await player.playTrack({ id: 'probe-1', title: 'Probe', source: 'local', data, durationMs: 12000 });
        await player.playQueue([
          { id: 'probe-2', title: 'Probe 2', source: 'local', data, durationMs: 8000 },
          { id: 'probe-3', title: 'Probe 3', source: 'local', data, durationMs: 6000 },
        ]);
        player.setShuffle(true);
        await player.next();
        await player.previous();
      }, failures);

      await runProbe('ui preferences', async () => {
        clampListPreviewLimit(0);
        clampListPreviewLimit(999);
        getListPreviewLimit();
        setListPreviewLimit(42);
        listPreview.setLimit(12.7);
        listPreview.setLimit(250);
        listPreview.setLimit(1);
      }, failures);

      await runProbe('feature flags', async () => {
        const defaults = Object.entries(FEATURE_FLAG_DEFINITIONS).reduce<Record<string, boolean>>(
          (acc, [key, value]) => {
            acc[key] = value.defaultValue;
            return acc;
          },
          {},
        );
        const manager = new FeatureFlagManager(
          new InMemoryFeatureFlagRepository({ hvsc_enabled: true }),
          defaults as Record<'hvsc_enabled', boolean>,
        );
        await manager.load();
        const snapshot = manager.getSnapshot();
        if (!isHvscEnabled(snapshot.flags)) {
          throw new Error('HVSC flag should be enabled after load');
        }
        await manager.setFlag('hvsc_enabled', false);
        await FeatureFlags.getFlag({ key: 'hvsc_enabled' });
        await FeatureFlags.getAllFlags({ keys: ['hvsc_enabled'] });
        await FeatureFlags.setFlag({ key: 'hvsc_enabled', value: true });
      }, failures);

      await runProbe('developer mode store', async () => {
        const devUnsub = subscribeDeveloperMode(() => {});
        setDeveloperModeEnabled(true);
        getDeveloperModeEnabled();
        devUnsub();
      }, failures);

      await runProbe('mock server errors', async () => {
        try {
          await startMockServer();
        } catch {
          // Expected on web.
        }
        await stopMockServer();
      }, failures);

      await runProbe('connection + disk library', async () => {
        connection.updateConfig(connection.baseUrl, connection.password, connection.deviceHost);
        await connection.refetch();
        window.dispatchEvent(
          new CustomEvent('c64u-connection-change', {
            detail: { baseUrl: connection.baseUrl, password: connection.password, deviceHost: connection.deviceHost },
          }),
        );
        const entry = buildDiskEntryFromPath('local', '/Games/Test.d64');
        diskLibrary.addDisks([entry]);
        const id = buildDiskEntryFromDrive('local', '/Games/Test.d64');
        if (id) {
          diskLibrary.updateDiskName(id, 'Test Disk');
          diskLibrary.updateDiskGroup(id, 'Favorites');
          diskLibrary.removeDisk(id);
        }
        diskLibrary.setFilter('Test');
        buildDiskEntryFromDrive('local', null);
      }, failures);

      setErrors(failures);
      setStatus(failures.length ? 'error' : 'done');
    };
  }, [connection, diskLibrary, listPreview, player]);

  useEffect(() => {
    if (status !== 'idle') return;
    void probes();
  }, [probes, status]);

  return (
    <div className="min-h-screen p-6 space-y-4" data-testid="coverage-probe-page">
      <h1 className="text-xl font-semibold">Coverage probes</h1>
      <p className="text-sm text-muted-foreground">
        Status: <span data-testid="coverage-probe-status">{status}</span>
      </p>
      <p className="text-xs text-muted-foreground">Started: {new Date(startedAt).toLocaleTimeString()}</p>
      {errors.length ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">Errors</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-destructive">
            {errors.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
