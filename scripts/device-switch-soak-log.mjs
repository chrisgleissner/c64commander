export const DEVICE_SWITCH_SOAK_RUNNER_RESULT_MARKER = 'C64_SWITCH_LAB_RUNNER_RESULT';

export const parseDeviceSwitchSoakRunnerResult = (logcat) => {
  let lastParseError = null;
  for (const rawLine of logcat.split(/\r?\n/).reverse()) {
    const line = rawLine.trim();
    if (!line.startsWith(DEVICE_SWITCH_SOAK_RUNNER_RESULT_MARKER)) {
      continue;
    }

    const payload = line.slice(DEVICE_SWITCH_SOAK_RUNNER_RESULT_MARKER.length).trim();
    if (!payload.startsWith('{')) {
      continue;
    }

    try {
      return JSON.parse(payload);
    } catch (error) {
      lastParseError = error;
    }
  }

  if (lastParseError) {
    throw lastParseError;
  }

  return null;
};
