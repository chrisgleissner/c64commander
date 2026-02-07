import type { DrivesResponse } from '@/lib/c64api';

export type DriveKey = 'a' | 'b';

const DRIVE_ORDER: DriveKey[] = ['a', 'b'];

export const listConnectedDrives = (payload?: Pick<DrivesResponse, 'drives'> | null): DriveKey[] => {
  if (!payload?.drives?.length) return [];
  return DRIVE_ORDER.filter((drive) => payload.drives.some((entry) => entry[drive] !== undefined));
};

const buildFailureMessage = (failures: Array<{ drive: DriveKey; error: string }>) =>
  failures
    .map(({ drive, error }) => `Drive ${drive.toUpperCase()}: ${error}`)
    .join('; ');

export const resetConnectedDrives = async (
  api: { resetDrive: (drive: DriveKey) => Promise<unknown> },
  payload?: Pick<DrivesResponse, 'drives'> | null,
) => {
  const drives = listConnectedDrives(payload);
  if (!drives.length) {
    throw new Error('No connected drives found.');
  }

  const failures: Array<{ drive: DriveKey; error: string }> = [];

  await Promise.all(
    drives.map(async (drive) => {
      try {
        await api.resetDrive(drive);
      } catch (error) {
        failures.push({
          drive,
          error: (error as Error).message,
        });
      }
    }),
  );

  if (failures.length) {
    throw new Error(`Failed to reset drives: ${buildFailureMessage(failures)}`);
  }

  return { drives };
};

