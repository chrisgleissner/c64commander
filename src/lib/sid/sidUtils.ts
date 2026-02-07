import SparkMD5 from 'spark-md5';

export const computeSidMd5 = async (data: ArrayBuffer) => {
  return SparkMD5.ArrayBuffer.hash(data);
};

export const createSslPayload = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.min(99, Math.floor(totalSeconds / 60));
  const seconds = Math.min(59, totalSeconds % 60);
  const bcd = (value: number) => ((Math.floor(value / 10) & 0xf) << 4) | (value % 10);
  return new Uint8Array([bcd(minutes), bcd(seconds)]);
};

export const base64ToUint8 = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const getSidSongCount = (buffer: ArrayBuffer) => {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 18) return 1;
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3),
    );
    if (magic !== 'PSID' && magic !== 'RSID') return 1;
    const songs = view.getUint16(14, false);
    return songs > 0 ? songs : 1;
  } catch {
    return 1;
  }
};
