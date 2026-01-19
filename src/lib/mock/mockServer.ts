import { addErrorLog } from '@/lib/logging';
import { MockC64U } from '@/lib/native/mockC64u';
import { clearStoredMockBaseUrl, setStoredMockBaseUrl } from '@/lib/config/developerModeStore';

let activeMockBaseUrl: string | null = null;
let startPromise: Promise<string> | null = null;

const loadMockConfigPayload = async () => {
  const module = await import('@/lib/mock/mockConfig');
  return module.getMockConfigPayload();
};

export const getActiveMockBaseUrl = () => activeMockBaseUrl;

export const startMockServer = async (): Promise<string> => {
  if (activeMockBaseUrl) return activeMockBaseUrl;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    try {
      const config = await loadMockConfigPayload();
      const response = await MockC64U.startServer({ config });
      activeMockBaseUrl = response.baseUrl;
      setStoredMockBaseUrl(response.baseUrl);
      return response.baseUrl;
    } catch (error) {
      addErrorLog('Mock C64U server failed to start', {
        error: (error as Error).message,
      });
      throw error;
    } finally {
      startPromise = null;
    }
  })();

  return startPromise;
};

export const stopMockServer = async () => {
  if (!activeMockBaseUrl && !startPromise) {
    clearStoredMockBaseUrl();
    return;
  }

  try {
    if (startPromise) {
      await startPromise;
    }
    await MockC64U.stopServer();
  } catch (error) {
    addErrorLog('Mock C64U server failed to stop', {
      error: (error as Error).message,
    });
    throw error;
  } finally {
    activeMockBaseUrl = null;
    clearStoredMockBaseUrl();
  }
};
