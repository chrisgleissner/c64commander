export const diskGroupColors = [
  { chip: 'bg-blue-500/20 border-blue-500/40', text: 'text-blue-700' },
  { chip: 'bg-emerald-500/20 border-emerald-500/40', text: 'text-emerald-700' },
  { chip: 'bg-indigo-500/20 border-indigo-500/40', text: 'text-indigo-700' },
  { chip: 'bg-teal-500/20 border-teal-500/40', text: 'text-teal-700' },
];

export const pickDiskGroupColor = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash + value.charCodeAt(i) * (i + 1)) % diskGroupColors.length;
  }
  return diskGroupColors[hash] || diskGroupColors[0];
};
