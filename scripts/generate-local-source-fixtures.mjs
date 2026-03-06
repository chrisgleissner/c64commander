import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const outDir = path.join(rootDir, 'tests', 'fixtures', 'local-source-assets');

const D64_TRACKS = [
  ...new Array(17).fill(21),
  ...new Array(7).fill(19),
  ...new Array(6).fill(18),
  ...new Array(5).fill(17),
];

const D71_TRACKS = [...D64_TRACKS, ...D64_TRACKS];
const D81_TRACKS = new Array(80).fill(40);

const writeFile = (name, content) => {
  const outputPath = path.join(outDir, name);
  fs.writeFileSync(outputPath, content);
  return { name, size: content.length };
};

const toPetsciiPadded = (text, length) => {
  const out = Buffer.alloc(length, 0xa0);
  const normalized = text.toUpperCase().slice(0, length);
  for (let index = 0; index < normalized.length; index += 1) {
    out[index] = normalized.charCodeAt(index) & 0x7f;
  }
  return out;
};

const getSectorOffset = (sectorsPerTrack, track, sector) => {
  const sectorsInTrack = sectorsPerTrack[track - 1];
  let sectorsBeforeTrack = 0;
  for (let index = 0; index < track - 1; index += 1) {
    sectorsBeforeTrack += sectorsPerTrack[index];
  }
  return (sectorsBeforeTrack + sector) * 256;
};

const writeDirectoryEntry = (
  buffer,
  offset,
  fileName,
  startTrack,
  startSector,
) => {
  buffer[offset] = 0x82;
  buffer[offset + 1] = startTrack;
  buffer[offset + 2] = startSector;
  toPetsciiPadded(fileName, 16).copy(buffer, offset + 3);
  buffer[offset + 30] = 1;
  buffer[offset + 31] = 0;
};

const writeSingleBlockPrgData = (buffer, sectorsPerTrack, track, sector) => {
  const dataOffset = getSectorOffset(sectorsPerTrack, track, sector);
  buffer[dataOffset] = 0x00;
  buffer[dataOffset + 1] = 0x03;
  buffer[dataOffset + 2] = 0x01;
};

const createPrg = () => {
  return Buffer.from([
    0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0x00,
    0x00, 0x00,
  ]);
};

const createSid = () => {
  const header = Buffer.alloc(0x7c, 0x00);
  header.write('PSID', 0, 'ascii');
  header.writeUInt16BE(0x0002, 4);
  header.writeUInt16BE(0x007c, 6);
  header.writeUInt16BE(0x1000, 8);
  header.writeUInt16BE(0x1000, 10);
  header.writeUInt16BE(0x1003, 12);
  header.writeUInt16BE(1, 14);
  header.writeUInt16BE(1, 16);
  header.writeUInt32BE(0, 18);
  header.write('C64 Commander Demo SID', 22, 'ascii');
  header.write('GitHub Copilot', 54, 'ascii');
  header.write('2026', 86, 'ascii');
  const data = Buffer.from([0xa9, 0x00, 0x8d, 0x18, 0xd4, 0x60, 0x60]);
  return Buffer.concat([header, data]);
};

const createMod = () => {
  const patternDataSize = 1024;
  const sampleDataSize = 2;
  const buffer = Buffer.alloc(1084 + patternDataSize + sampleDataSize, 0x00);
  buffer.write('C64 COMMANDER DEMO MOD', 0, 'ascii');
  buffer.writeUInt16BE(1, 20 + 22);
  buffer[20 + 25] = 64;
  buffer[950] = 1;
  buffer[951] = 127;
  buffer[952] = 0;
  buffer.write('M.K.', 1080, 'ascii');
  return buffer;
};

const createCrt = () => {
  const romSize = 0x2000;
  const header = Buffer.alloc(0x40, 0x00);
  header.write('C64 CARTRIDGE   ', 0, 'ascii');
  header.writeUInt32BE(0x40, 0x10);
  header.writeUInt16BE(0x0100, 0x14);
  header.writeUInt16BE(0x0000, 0x16);
  header[0x18] = 0;
  header[0x19] = 0;
  toPetsciiPadded('C64 COMMANDER DEMO CRT', 32).copy(header, 0x20);

  const chipPacket = Buffer.alloc(0x10 + romSize, 0xff);
  chipPacket.write('CHIP', 0, 'ascii');
  chipPacket.writeUInt32BE(0x10 + romSize, 4);
  chipPacket.writeUInt16BE(0x0000, 8);
  chipPacket.writeUInt16BE(0x0000, 10);
  chipPacket.writeUInt16BE(0x8000, 12);
  chipPacket.writeUInt16BE(romSize, 14);
  chipPacket[0x10] = 0x4c;
  chipPacket[0x11] = 0x00;
  chipPacket[0x12] = 0x80;

  return Buffer.concat([header, chipPacket]);
};

const initializeCbmDirectory = (
  buffer,
  sectorsPerTrack,
  bamTrack,
  bamSector,
  directorySector,
  diskLabel,
  dosType,
) => {
  const bamOffset = getSectorOffset(sectorsPerTrack, bamTrack, bamSector);
  buffer[bamOffset] = bamTrack;
  buffer[bamOffset + 1] = directorySector;
  buffer[bamOffset + 2] = 0x41;
  toPetsciiPadded(diskLabel, 16).copy(buffer, bamOffset + 0x90);
  toPetsciiPadded('64', 2).copy(buffer, bamOffset + 0xa2);
  toPetsciiPadded(dosType, 2).copy(buffer, bamOffset + 0xa5);

  const directoryOffset = getSectorOffset(
    sectorsPerTrack,
    bamTrack,
    directorySector,
  );
  buffer[directoryOffset] = 0x00;
  buffer[directoryOffset + 1] = 0xff;
  writeDirectoryEntry(buffer, directoryOffset + 2, 'DEMO', 1, 0);
};

const createD64 = () => {
  const sectorCount = D64_TRACKS.reduce((sum, value) => sum + value, 0);
  const buffer = Buffer.alloc(sectorCount * 256, 0x00);
  initializeCbmDirectory(
    buffer,
    D64_TRACKS,
    18,
    0,
    1,
    'C64COMMANDER D64',
    '2A',
  );
  writeSingleBlockPrgData(buffer, D64_TRACKS, 1, 0);
  return buffer;
};

const createD71 = () => {
  const sectorCount = D71_TRACKS.reduce((sum, value) => sum + value, 0);
  const buffer = Buffer.alloc(sectorCount * 256, 0x00);
  initializeCbmDirectory(
    buffer,
    D71_TRACKS,
    18,
    0,
    1,
    'C64COMMANDER D71',
    '2A',
  );

  const bamSecondSideOffset = getSectorOffset(D71_TRACKS, 53, 0);
  buffer[bamSecondSideOffset] = 53;
  buffer[bamSecondSideOffset + 1] = 1;
  buffer[bamSecondSideOffset + 2] = 0x41;

  writeSingleBlockPrgData(buffer, D71_TRACKS, 1, 0);
  return buffer;
};

const createD81 = () => {
  const sectorCount = D81_TRACKS.reduce((sum, value) => sum + value, 0);
  const buffer = Buffer.alloc(sectorCount * 256, 0x00);

  const headerOffset = getSectorOffset(D81_TRACKS, 40, 0);
  buffer[headerOffset] = 40;
  buffer[headerOffset + 1] = 3;
  buffer[headerOffset + 2] = 0x44;
  toPetsciiPadded('C64COMMANDER D81', 16).copy(buffer, headerOffset + 0x04);
  toPetsciiPadded('81', 2).copy(buffer, headerOffset + 0x16);
  toPetsciiPadded('3D', 2).copy(buffer, headerOffset + 0x19);

  const bamOffset = getSectorOffset(D81_TRACKS, 40, 1);
  buffer[bamOffset] = 40;
  buffer[bamOffset + 1] = 2;

  const directoryOffset = getSectorOffset(D81_TRACKS, 40, 3);
  buffer[directoryOffset] = 0x00;
  buffer[directoryOffset + 1] = 0xff;
  writeDirectoryEntry(buffer, directoryOffset + 2, 'DEMO', 1, 0);

  writeSingleBlockPrgData(buffer, D81_TRACKS, 1, 0);
  return buffer;
};

const createSonglengths = () => {
  return Buffer.from(
    '; /MUSICIANS/C/C64_COMMANDER/DEMO.SID\n0123456789abcdef0123456789abcdef=0:30\n',
    'utf8',
  );
};

const main = () => {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [
    writeFile('demo.prg', createPrg()),
    writeFile('demo.sid', createSid()),
    writeFile('demo.mod', createMod()),
    writeFile('demo.crt', createCrt()),
    writeFile('demo.d64', createD64()),
    writeFile('demo.d71', createD71()),
    writeFile('demo.d81', createD81()),
    writeFile('Songlengths.md5', createSonglengths()),
  ];

  for (const file of written) {
    console.log(`${file.name}\t${file.size} bytes`);
  }
};

main();
