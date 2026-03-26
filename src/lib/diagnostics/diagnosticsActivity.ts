/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type ActivitySnapshot = {
  restInFlight: number;
  ftpInFlight: number;
  telnetInFlight: number;
};

let restInFlight = 0;
let ftpInFlight = 0;
let telnetInFlight = 0;

const emitUpdate = () => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("c64u-activity-updated"));
  }
};

const clamp = (value: number) => Math.max(0, value);

export const getDiagnosticsActivitySnapshot = (): ActivitySnapshot => ({
  restInFlight,
  ftpInFlight,
  telnetInFlight,
});

export const incrementRestInFlight = () => {
  restInFlight += 1;
  emitUpdate();
};

export const decrementRestInFlight = () => {
  restInFlight = clamp(restInFlight - 1);
  emitUpdate();
};

export const incrementFtpInFlight = () => {
  ftpInFlight += 1;
  emitUpdate();
};

export const decrementFtpInFlight = () => {
  ftpInFlight = clamp(ftpInFlight - 1);
  emitUpdate();
};

export const incrementTelnetInFlight = () => {
  telnetInFlight += 1;
  emitUpdate();
};

export const decrementTelnetInFlight = () => {
  telnetInFlight = clamp(telnetInFlight - 1);
  emitUpdate();
};

export const resetDiagnosticsActivity = () => {
  restInFlight = 0;
  ftpInFlight = 0;
  telnetInFlight = 0;
  emitUpdate();
};
