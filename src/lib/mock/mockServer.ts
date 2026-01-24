import { addErrorLog } from '@/lib/logging';
import { MockC64U } from '@/lib/native/mockC64u';

let activeMockBaseUrl: string | null = null;
let activeFtpPort: number | null = null;
let startPromise: Promise<{ baseUrl: string; ftpPort?: number }> | null = null;

const loadMockConfigPayload = async () => {
  const module = await import('@/lib/mock/mockConfig');
  return module.getMockConfigPayload();
};

export const getActiveMockBaseUrl = () => activeMockBaseUrl;
export const getActiveMockFtpPort = () => activeFtpPort;

export const startMockServer = async (): Promise<{ baseUrl: string; ftpPort?: number }> => {
  if (activeMockBaseUrl) return { baseUrl: activeMockBaseUrl, ftpPort: activeFtpPort || undefined };
  if (startPromise) return startPromise;

  startPromise = (async () => {
    try {
      const config = await loadMockConfigPayload();
      const response = await MockC64U.startServer({ config });
      activeMockBaseUrl = response.baseUrl;
      activeFtpPort = response.ftpPort ?? null;
      return { baseUrl: response.baseUrl, ftpPort: response.ftpPort };
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
    activeFtpPort = null;
  }
};
