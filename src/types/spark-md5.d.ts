/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

declare module 'spark-md5' {
  const SparkMD5: {
    ArrayBuffer: {
      hash: (buffer: ArrayBuffer) => string;
    };
  };
  export default SparkMD5;
}
