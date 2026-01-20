export type AudioMixerVolumeItem = {
  name: string;
  value: string | number;
  options?: string[];
};

export type SoloState = {
  soloItem: string | null;
};

export type SoloAction =
  | { type: 'toggle'; item: string }
  | { type: 'reset' };

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export const isSidVolumeName = (name: string) =>
  /^vol\s+(ultisid|socket)\s+[12]$/i.test(normalizeName(name));

const normalizeOption = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

const parseNumeric = (option: string) => {
  const match = option.trim().match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
};

export const resolveAudioMixerMuteValue = (options?: string[]) => {
  if (!options || options.length === 0) return 'OFF';
  const offOption = options.find((option) => {
    const normalized = normalizeOption(option);
    return normalized === 'off' || normalized === 'mute' || normalized === 'muted';
  });
  if (offOption) return offOption;

  const numericOptions = options
    .map((option) => ({ option, numeric: parseNumeric(option) }))
    .filter((entry) => entry.numeric !== undefined) as Array<{ option: string; numeric: number }>;

  if (numericOptions.length > 0) {
    const lowest = numericOptions.reduce((min, entry) => (entry.numeric < min.numeric ? entry : min));
    return lowest.option;
  }

  return options[0] ?? 'OFF';
};

export const soloReducer = (state: SoloState, action: SoloAction): SoloState => {
  if (action.type === 'reset') {
    return { soloItem: null };
  }
  const nextSolo = state.soloItem === action.item ? null : action.item;
  return { soloItem: nextSolo };
};

export const buildSoloRoutingUpdates = (
  items: AudioMixerVolumeItem[],
  soloItem: string | null,
) => {
  const updates: Record<string, string | number> = {};
  items.forEach((item) => {
    if (!isSidVolumeName(item.name)) return;
    const target = soloItem && item.name !== soloItem
      ? resolveAudioMixerMuteValue(item.options)
      : item.value;
    updates[item.name] = target;
  });
  return updates;
};
