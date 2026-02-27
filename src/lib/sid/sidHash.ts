/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import SparkMD5 from 'spark-md5';

export const computeSidMd5 = async (data: ArrayBuffer) => {
  return SparkMD5.ArrayBuffer.hash(data);
};
