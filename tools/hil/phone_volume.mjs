/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The phone's media volume for the audible HIL harnesses: read it, hold it at a level no higher
 * than MAX_VOLUME of 25, and put back exactly what was there, mute included.
 *
 * `cmd audio set-volume` is used rather than the volume keys: a key press unmutes a muted stream,
 * and `cmd media_session volume --set` does nothing on the Pixel 4.
 */

export const MAX_VOLUME = 10;

export const readVolume = async (device) => {
  const dump = await device.shell(["sh", "-c", "dumpsys audio | grep -A8 -- '- STREAM_MUSIC:'"]);
  const speaker = /\(speaker\): (\d+)/.exec(dump);
  return { muted: /Muted: true/.test(dump), level: speaker ? Number(speaker[1]) : null };
};

export const setVolume = async (device, target) => {
  if (target > MAX_VOLUME) throw new Error(`refusing media volume ${target}; the ceiling is ${MAX_VOLUME} of 25`);
  await device.shell(["cmd", "audio", "set-volume", "3", String(target)]);
  const after = await readVolume(device);
  if (after.level !== target) throw new Error(`the phone's media volume read ${after.level} after setting ${target}`);
};

/** Put back a reading taken by `readVolume`, never above the ceiling. */
export const restoreVolume = async (device, before, log = console.warn) => {
  if (before.level === null) return;
  await setVolume(device, Math.min(before.level, MAX_VOLUME));
  if (!before.muted) return;
  await device.shell(["cmd", "media_session", "volume", "--stream", "3", "--adj", "mute"]);
  if (!(await readVolume(device)).muted)
    log("the phone's media stream was muted before the run and could not be muted again");
};
