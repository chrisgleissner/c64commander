/*
 * C64 Commander - C64 Scope
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Bench hardware is addressed by host name, never by address. Name resolution is
 * whatever the machine running the test already uses, so a device that moves under
 * DHCP keeps working. A baked address does not: 192.168.1.13 was the default here
 * and had stopped pointing at either machine.
 */
export const DEVICE_HOSTS = {
  /** Commodore 64 Ultimate. */
  c64u: "c64u",
  /** Ultimate 64. */
  u64: "u64",
  /** Ultimate-II. */
  u2: "u2",
} as const;

export type DeviceHostName = keyof typeof DEVICE_HOSTS;

/** Overridable with C64U_HOST, which accepts a host name or an address. */
export const DEFAULT_C64U_HOST = DEVICE_HOSTS.c64u;

export const resolveDeviceHost = (env: NodeJS.ProcessEnv = process.env): string =>
  (env["C64U_HOST"] ?? "").trim() || DEFAULT_C64U_HOST;
