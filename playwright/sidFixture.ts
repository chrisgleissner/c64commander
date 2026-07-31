const MINIMAL_SID_BYTE_LENGTH = 0x77;

/** Where each text field sits in a PSID header, and how long it may be. */
const NAME_OFFSET = 0x16;
const AUTHOR_OFFSET = 0x36;
const RELEASED_OFFSET = 0x56;
const TEXT_FIELD_LENGTH = 0x20;
const FLAGS_OFFSET = 0x76;

/** What a tune says about itself, as the app reads it back out of the header. */
export type SidFixtureMetadata = {
  /** Title, composer and "year publisher", exactly as the header carries them. */
  name: string;
  author: string;
  released: string;
  songCount: number;
  startSong: number;
  /** `pal` and `ntsc` are the two television standards the C64 was sold for. */
  clock: "pal" | "ntsc";
  /** The two revisions of the SID chip. */
  sidModel: "6581" | "8580";
};

const writeLatin1 = (bytes: Uint8Array, offset: number, value: string) => {
  // PSID text fields are fixed-width and NUL-padded, so anything longer is cut
  // rather than allowed to run into the next field.
  const truncated = value.slice(0, TEXT_FIELD_LENGTH - 1);
  for (let i = 0; i < truncated.length; i += 1) {
    bytes[offset + i] = truncated.charCodeAt(i) & 0xff;
  }
};

const createMinimalSidBytes = (songCount = 1) => {
  const bytes = new Uint8Array(MINIMAL_SID_BYTE_LENGTH);
  bytes.set([0x50, 0x53, 0x49, 0x44], 0);
  bytes[4] = 0x00;
  bytes[5] = 0x02;
  bytes[6] = 0x00;
  bytes[7] = 0x76;
  const normalizedSongCount = Math.max(1, Math.min(0xffff, Math.floor(songCount || 1)));
  bytes[14] = (normalizedSongCount >> 8) & 0xff;
  bytes[15] = normalizedSongCount & 0xff;
  bytes[16] = 0x00;
  bytes[17] = 0x01;
  bytes[0x76] = 0x60;
  return bytes;
};

/**
 * A complete version 2 header, which is what the app's parser insists on.
 *
 * `parseSidHeaderMetadata` rejects anything under 124 bytes and reads the flags
 * word at offset 118, so the cut-down 119-byte fixture above — fine for tests
 * that only need *a* SID — yields no credits at all. A version 2 header is 124
 * bytes and the music starts at 0x7C.
 */
const V2_HEADER_LENGTH = 0x7c;

const createSidBytesWithMetadata = (metadata: SidFixtureMetadata) => {
  const bytes = new Uint8Array(V2_HEADER_LENGTH + 4);
  bytes.set([0x50, 0x53, 0x49, 0x44], 0);
  bytes[4] = 0x00;
  bytes[5] = 0x02; // version 2
  bytes[6] = (V2_HEADER_LENGTH >> 8) & 0xff;
  bytes[7] = V2_HEADER_LENGTH & 0xff;

  const songCount = Math.max(1, Math.min(0xffff, Math.floor(metadata.songCount || 1)));
  bytes[14] = (songCount >> 8) & 0xff;
  bytes[15] = songCount & 0xff;
  const startSong = Math.max(1, Math.min(songCount, Math.floor(metadata.startSong || 1)));
  bytes[16] = (startSong >> 8) & 0xff;
  bytes[17] = startSong & 0xff;

  writeLatin1(bytes, NAME_OFFSET, metadata.name);
  writeLatin1(bytes, AUTHOR_OFFSET, metadata.author);
  writeLatin1(bytes, RELEASED_OFFSET, metadata.released);

  // Bits 2-3 carry the television standard and bits 4-5 the first chip's model,
  // which is what the app reads to show "PAL" and "6581" under the title.
  const clockBits = metadata.clock === "ntsc" ? 0b10 : 0b01;
  const modelBits = metadata.sidModel === "8580" ? 0b10 : 0b01;
  const flags = (clockBits << 2) | (modelBits << 4);
  bytes[FLAGS_OFFSET] = (flags >> 8) & 0xff;
  bytes[FLAGS_OFFSET + 1] = flags & 0xff;

  return bytes;
};

const looksLikeValidSid = (bytes: Uint8Array) => {
  if (bytes.length < MINIMAL_SID_BYTE_LENGTH) {
    return false;
  }
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  if (magic !== "PSID" && magic !== "RSID") {
    return false;
  }
  const dataOffset = ((bytes[6] ?? 0) << 8) | (bytes[7] ?? 0);
  const songs = ((bytes[14] ?? 0) << 8) | (bytes[15] ?? 0);
  const startSong = ((bytes[16] ?? 0) << 8) | (bytes[17] ?? 0);
  return dataOffset < bytes.length && songs >= 1 && startSong >= 1 && startSong <= songs;
};

export const ensureValidSidBase64 = (value: string, songCount = 1) => {
  const bytes = Buffer.from(value, "base64");
  if (looksLikeValidSid(bytes)) {
    return value;
  }
  return Buffer.from(createMinimalSidBytes(songCount)).toString("base64");
};

/**
 * A playable stand-in that describes itself exactly as a real tune does.
 *
 * The app reads the composer, the year, the publisher, the chip, the television
 * standard and the tune count straight out of the PSID header, so a fixture with
 * an empty header produces a screenshot of a nameless tune. This writes real
 * values into a synthetic file: no music is copied, only the facts a tune states
 * about itself.
 */
export const createSidBase64WithMetadata = (metadata: SidFixtureMetadata) =>
  Buffer.from(createSidBytesWithMetadata(metadata)).toString("base64");
