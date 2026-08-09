import type { VicPalette } from "@/generated/vicPalettes";

const PALETTE_SIZE = 16;

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
    const body = line.split("#")[0]!.trim();
    if (!body) continue;
    const channels = body
      .split(/\s+/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 16));
    if (channels.length !== 3 || channels.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error(`${id}: cannot read "${body}" as an RR GG BB triple`);
    }
    rgb.push([channels[0]!, channels[1]!, channels[2]!]);
  }
  if (rgb.length !== PALETTE_SIZE) throw new Error(`${id}: expected ${PALETTE_SIZE} colours, found ${rgb.length}`);
  return { id, name, description, rgb };
};
