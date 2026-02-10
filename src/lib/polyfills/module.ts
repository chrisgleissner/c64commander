/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const moduleShim = {};

export const createRequire = () => {
  throw new Error('createRequire is not supported in the browser.');
};

export default moduleShim;
