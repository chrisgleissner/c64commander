/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";

export type C64NativeHttpRequest = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  data?: BodyInit;
  connectTimeout: number;
  readTimeout: number;
  responseType: "json" | "arraybuffer";
  requestId: string;
  correlationId: string;
};

export type C64NativeHttpResponse = {
  status: number;
  headers?: Record<string, string>;
  data?: unknown;
};

type C64HttpPlugin = {
  request: (options: C64NativeHttpRequest) => Promise<C64NativeHttpResponse>;
};

const C64Http = registerPlugin<C64HttpPlugin>("C64Http");

export const requestC64NativeHttp = async (options: C64NativeHttpRequest) => {
  if (Capacitor.getPlatform() !== "android") {
    return await CapacitorHttp.request(options);
  }
  return await C64Http.request(options);
};
