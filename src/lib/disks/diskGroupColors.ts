/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const diskGroupColors = [
  { chip: "bg-category-1/20 border-category-1/40", text: "text-category-1" },
  { chip: "bg-category-2/20 border-category-2/40", text: "text-category-2" },
  { chip: "bg-category-3/20 border-category-3/40", text: "text-category-3" },
  { chip: "bg-category-4/20 border-category-4/40", text: "text-category-4" },
];

export const pickDiskGroupColor = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash + value.charCodeAt(i) * (i + 1)) % diskGroupColors.length;
  }
  return diskGroupColors[hash] || diskGroupColors[0];
};
