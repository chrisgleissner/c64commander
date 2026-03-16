const MINIMAL_SID_BYTE_LENGTH = 0x77;

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
