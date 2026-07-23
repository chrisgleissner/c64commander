/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability F — create a formatted blank disk image on the device.
 *
 * Pure URL/param builder for the firmware create endpoints so it is fully unit
 * testable without the whole C64API:
 *   PUT /v1/files/<folder>/<name>:create_d64?diskname=<label>&tracks=<n>
 *   PUT /v1/files/<folder>/<name>:create_d71?diskname=<label>
 *   PUT /v1/files/<folder>/<name>:create_d81?diskname=<label>
 *   PUT /v1/files/<folder>/<name>:create_dnp?diskname=<label>&tracks=<n>
 */

export type CreateDiskKind = "d64" | "d71" | "d81" | "dnp";

export const CREATE_DISK_KINDS: readonly CreateDiskKind[] = ["d64", "d71", "d81", "dnp"];

export interface CreateDiskArgs {
  /** e.g. "/USB0/Games" — must not be the virtual top-level "/". */
  folder: string;
  /** File name only, no path; the extension is appended if missing. */
  name: string;
  kind: CreateDiskKind;
  /** On-disk label, <=16 chars; defaults to the name stem. */
  diskLabel?: string;
  /** d64: 35-41 (default 35); dnp: required 1-255. Ignored for d71/d81. */
  tracks?: number;
}

export const DISK_LABEL_MAX = 16;
export const D64_MIN_TRACKS = 35;
export const D64_MAX_TRACKS = 41;
export const D64_DEFAULT_TRACKS = 35;
export const DNP_MIN_TRACKS = 1;
export const DNP_MAX_TRACKS = 255;

/** Percent-encode each path segment but keep `/` as the separator (firmware wants %20, not +). */
export const encodeC64uPath = (path: string): string =>
  path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const normalizeFolder = (folder: string) => "/" + folder.replace(/^\/+|\/+$/g, "");

const ensureExtension = (name: string, kind: CreateDiskKind) =>
  name.toLowerCase().endsWith("." + kind) ? name : `${name}.${kind}`;

const stemOf = (name: string) => name.replace(/\.[^.]+$/, "");

export interface CreateDiskPlan {
  /** Relative request path incl. query, e.g. "/v1/files/USB0/x.d64:create_d64?diskname=X&tracks=35". */
  path: string;
  /** The resolved disk file name (with extension). */
  fileName: string;
  /** The full device path (unencoded), e.g. "/USB0/x.d64". */
  filePath: string;
  /** The resolved, clamped disk label. */
  label: string;
  kind: CreateDiskKind;
  tracks?: number;
}

/**
 * Validate the args and build the create request plan. Throws a user-facing Error
 * on any invalid input (virtual root, path in the name, out-of-range tracks).
 */
export const buildCreateDiskPlan = (args: CreateDiskArgs): CreateDiskPlan => {
  const folder = normalizeFolder(args.folder);
  if (folder === "/") {
    throw new Error("Pick a storage folder (e.g. USB0) — the top-level / is virtual and cannot hold files.");
  }

  const rawName = (args.name ?? "").trim();
  if (!rawName || rawName.includes("/") || rawName.includes("\\") || rawName === "." || rawName === "..") {
    throw new Error("Enter a file name, not a path.");
  }
  const fileName = ensureExtension(rawName, args.kind);

  const label = (args.diskLabel && args.diskLabel.length > 0 ? args.diskLabel : stemOf(fileName)).slice(
    0,
    DISK_LABEL_MAX,
  );

  const params: Array<[string, string]> = [["diskname", label]];
  let tracks: number | undefined;
  if (args.kind === "d64") {
    tracks = args.tracks ?? D64_DEFAULT_TRACKS;
    if (tracks < D64_MIN_TRACKS || tracks > D64_MAX_TRACKS) {
      throw new Error(`D64 tracks must be ${D64_MIN_TRACKS}–${D64_MAX_TRACKS}.`);
    }
    params.push(["tracks", String(tracks)]);
  } else if (args.kind === "dnp") {
    if (!args.tracks || args.tracks < DNP_MIN_TRACKS || args.tracks > DNP_MAX_TRACKS) {
      throw new Error(`DNP needs a track count (${DNP_MIN_TRACKS}–${DNP_MAX_TRACKS}).`);
    }
    tracks = args.tracks;
    params.push(["tracks", String(tracks)]);
  }

  const filePath = `${folder}/${fileName}`;
  const qs = params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  const path = `/v1/files${encodeC64uPath(filePath)}:create_${args.kind}?${qs}`;

  return { path, fileName, filePath, label, kind: args.kind, tracks };
};
