/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { VicPalette } from "@/generated/vicPalettes";

const PALETTE_SIZE = 16;
const VPL_COMPONENT = /^[0-9a-f]{1,2}$/i;

export const parseVpl = (text: string, id: string): VicPalette => {
  let name = id;
  let description = "";
  const rgb: Array<readonly [number, number, number]> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("#")) {
      const tag = line.replace(/^#\s*/, "");
      if (tag.startsWith("NAME:")) name = tag.slice(5).trim() || name;
      else if (tag.startsWith("DESC:")) description = tag.slice(5).trim();
      continue;
    }
    const body = line.split("#")[0].trim();
    if (!body) continue;
    const components = body.split(/\s+/).slice(0, 3);
    if (components.length !== 3 || components.some((component) => !VPL_COMPONENT.test(component))) {
      throw new Error(`${id}: cannot read "${body}" as an RR GG BB triple`);
    }
    const channels = components.map((component) => Number.parseInt(component, 16));
    rgb.push([channels[0], channels[1], channels[2]]);
  }
  if (rgb.length !== PALETTE_SIZE) throw new Error(`${id}: expected ${PALETTE_SIZE} colours, found ${rgb.length}`);
  return { id, name, description, rgb };
};
