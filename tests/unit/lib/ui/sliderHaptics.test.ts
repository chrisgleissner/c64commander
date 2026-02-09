import { triggerSliderHaptic } from '@/lib/ui/sliderHaptics';
import { Capacitor } from '@capacitor/core';
import { addErrorLog } from '@/lib/logging';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core');
vi.mock('@/lib/logging');

describe('sliderHaptics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing if not native platform', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    await triggerSliderHaptic();
    // No explicit expectation, just ensures no error and coverage lines hit
  });

  it('triggers haptics impact on native', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    
    // Valid mocking of Capacitor.Plugins structure is tricky as it is accessed somewhat dynamically in the code
    // The code casts `Capacitor as unknown as { Plugins ... }`
    
    // We can try to mock the dynamically accessed property if possible, 
    // or we might need to rely on how vitest mocks module exports.
    
    // Let's assume we can mock the module export 'Capacitor' to have Plugins.
    // However, `vi.mock` creates the mock object.
    
    const mockImpact = vi.fn();
    (Capacitor as any).Plugins = {
        Haptics: {
            impact: mockImpact,
            ImpactStyle: { Light: 'LIGHT' }
        }
    };
    
    await triggerSliderHaptic();
    expect(mockImpact).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('logs error if probe fails', async () => {
     vi.mocked(Capacitor.isNativePlatform).mockImplementation(() => {
         throw new Error('Probe error');
     });
     
     await triggerSliderHaptic();
     expect(addErrorLog).toHaveBeenCalledWith('Haptics availability probe failed', expect.anything());
  });

    it('logs error if impact fails', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);

    const mockImpact = vi.fn().mockRejectedValue(new Error('Impact failed'));
     (Capacitor as any).Plugins = {
        Haptics: {
            impact: mockImpact,
            ImpactStyle: { Light: 'LIGHT' }
        }
    };

    await triggerSliderHaptic();
    expect(addErrorLog).toHaveBeenCalledWith('Haptics impact failed', expect.anything());
  });
});
