/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { resolveDeviceHostFromStorage } from "@/lib/c64api";
import { stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import type { ConfigFileReference } from "@/lib/config/configFileReference";
import {
  applyRemoteConfigFromPath,
  applyRemoteConfigFromTemp,
  saveRemoteConfigFromTemp,
} from "@/lib/config/configTelnetWorkflow";
import { createConfigWorkflow } from "@/lib/config/configWorkflow";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { listFtpDirectory, readFtpFile, writeFtpFile } from "@/lib/ftp/ftpClient";
import { buildLocalPlayFileFromTree, buildLocalPlayFileFromUri } from "@/lib/playback/fileLibraryUtils";
import { getPassword } from "@/lib/secureStorage";
import { base64ToUint8 } from "@/lib/sid/sidUtils";
import { resolveLocalRuntimeFile } from "@/lib/sourceNavigation/localSourceAdapter";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { createTelnetClient } from "@/lib/telnet/telnetClient";
import { getStoredTelnetPort } from "@/lib/telnet/telnetConfig";
import { createTelnetSession } from "@/lib/telnet/telnetSession";
import { resolveTelnetMenuKey } from "@/lib/telnet/telnetTypes";

type LocalEntry = {
  uri?: string | null;
  name: string;
  modifiedAt?: string | null;
  sizeBytes?: number | null;
};

type ApplyConfigFileReferenceOptions = {
  configRef: ConfigFileReference;
  deviceProduct?: string | null;
  localEntriesBySourceId: Map<string, Map<string, LocalEntry>>;
  localSourceTreeUris: Map<string, string | null>;
};

const uint8ToBase64 = (value: Uint8Array) => {
  let binary = "";
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const resolveLocalConfigBytes = async (
  configRef: Extract<ConfigFileReference, { kind: "local" }>,
  localEntriesBySourceId: Map<string, Map<string, LocalEntry>>,
  localSourceTreeUris: Map<string, string | null>,
) => {
  if (configRef.uri) {
    const file = buildLocalPlayFileFromUri(configRef.fileName, configRef.path ?? configRef.fileName, configRef.uri);
    return new Uint8Array(await file.arrayBuffer());
  }

  const normalizedPath = normalizeSourcePath(configRef.path ?? "");
  if (configRef.sourceId && normalizedPath) {
    const runtimeFile = resolveLocalRuntimeFile(configRef.sourceId, normalizedPath);
    if (runtimeFile) {
      return new Uint8Array(await runtimeFile.arrayBuffer());
    }
    const localEntry = localEntriesBySourceId.get(configRef.sourceId)?.get(normalizedPath);
    if (localEntry?.uri) {
      const file = buildLocalPlayFileFromUri(configRef.fileName, normalizedPath, localEntry.uri);
      return new Uint8Array(await file.arrayBuffer());
    }
    const treeUri = localSourceTreeUris.get(configRef.sourceId);
    if (treeUri) {
      const file = buildLocalPlayFileFromTree(configRef.fileName, normalizedPath, treeUri);
      return new Uint8Array(await file.arrayBuffer());
    }
  }

  throw new Error("Local config file unavailable. Re-select the associated .cfg file.");
};

export const applyConfigFileReference = async ({
  configRef,
  deviceProduct,
  localEntriesBySourceId,
  localSourceTreeUris,
}: ApplyConfigFileReferenceOptions) => {
  const host = stripPortFromDeviceHost(resolveDeviceHostFromStorage());
  const password = await getPassword();
  const ftpOptions = {
    host,
    port: getStoredFtpPort(),
    username: "user",
    password: password ?? "",
  };
  const menuKey = resolveTelnetMenuKey(deviceProduct) ?? "F5";
  const workflow = createConfigWorkflow({
    listRemoteTempFiles: async () => {
      const result = await listFtpDirectory({ ...ftpOptions, path: "/Temp" });
      return result.entries
        .filter((entry) => entry.type === "file")
        .map((entry) => ({
          name: entry.name,
          path: entry.path,
          size: entry.size,
          modifiedAt: entry.modifiedAt,
        }));
    },
    readRemoteFile: async (path) => {
      const result = await readFtpFile({ ...ftpOptions, path });
      return base64ToUint8(result.data);
    },
    writeRemoteFile: async (path, bytes) => {
      await writeFtpFile({ ...ftpOptions, path, data: uint8ToBase64(bytes) });
    },
    runSaveRemoteConfig: async () => {
      const transport = createTelnetClient();
      const session = createTelnetSession(transport);
      await session.connect(host, getStoredTelnetPort(), password ?? undefined);
      try {
        await saveRemoteConfigFromTemp(session, menuKey);
      } finally {
        await session.disconnect();
      }
    },
    runApplyRemoteConfig: async (fileName) => {
      const transport = createTelnetClient();
      const session = createTelnetSession(transport);
      await session.connect(host, getStoredTelnetPort(), password ?? undefined);
      try {
        await applyRemoteConfigFromTemp(session, menuKey, fileName);
      } finally {
        await session.disconnect();
      }
    },
    runApplyRemoteConfigByPath: async (path) => {
      const transport = createTelnetClient();
      const session = createTelnetSession(transport);
      await session.connect(host, getStoredTelnetPort(), password ?? undefined);
      try {
        await applyRemoteConfigFromPath(session, menuKey, path);
      } finally {
        await session.disconnect();
      }
    },
  });

  if (configRef.kind === "ultimate") {
    await workflow.applyRemoteSnapshot(configRef.path);
    return;
  }

  const bytes = await resolveLocalConfigBytes(configRef, localEntriesBySourceId, localSourceTreeUris);
  await workflow.applyLocalSnapshot(configRef.fileName, bytes);
};
