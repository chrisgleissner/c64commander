import { describe, expect, it } from 'vitest';
import { applySavedDeviceDraftHostInput, buildSavedDeviceEditorDraft } from '@/lib/savedDevices/deviceEditor';

describe('deviceEditor', () => {
  it('builds inferred names from normalized hosts without the http port', () => {
    expect(
      buildSavedDeviceEditorDraft({
        name: '',
        nameSource: 'INFERRED',
        host: 'u64:8080',
        type: '',
        typeSource: 'INFERRED',
        httpPort: 8080,
        ftpPort: 21,
        telnetPort: 64,
      }),
    ).toMatchObject({
      host: 'u64:8080',
      name: 'u64',
      nameSource: 'INFERRED',
    });
  });

  it('recomputes inferred names from the normalized host while editing', () => {
    expect(
      applySavedDeviceDraftHostInput(
        {
          name: 'c64u',
          nameSource: 'INFERRED',
          host: 'c64u',
          type: '',
          typeSource: 'INFERRED',
          httpPort: '80',
          ftpPort: '21',
          telnetPort: '64',
        },
        'u64:8080',
      ),
    ).toMatchObject({
      host: 'u64:8080',
      name: 'u64',
      nameSource: 'INFERRED',
      type: '',
      typeSource: 'INFERRED',
    });
  });
});