/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getC64API, resolveDeviceHostFromStorage } from "@/lib/c64api";
import { stripPortFromDeviceHost } from "@/lib/c64api/hostConfig";
import type { ConfigFileReference } from "@/lib/config/configFileReference";
import type { ConfigValueOverride } from "@/lib/config/playbackConfig";
import { applyRemoteConfigFromTemp, saveRemoteConfigFromTemp } from "@/lib/config/configTelnetWorkflow";
import { createConfigWorkflow } from "@/lib/config/configWorkflow";
import { getStoredFtpPort } from "@/lib/ftp/ftpConfig";
import { listFtpDirectory, readFtpFile, writeFtpFile } from "@/lib/ftp/ftpClient";
import { addErrorLog, addLog } from "@/lib/logging";
import { withTelnetInteraction } from "@/lib/deviceInteraction/deviceInteractionManager";
import { buildLocalPlayFileFromTree, buildLocalPlayFileFromUri } from "@/lib/playback/fileLibraryUtils";
import { getParentPath } from "@/lib/playback/localFileBrowser";
import { getPassword } from "@/lib/secureStorage";
import { base64ToUint8 } from "@/lib/sid/sidUtils";
import { resolveLocalRuntimeFile } from "@/lib/sourceNavigation/localSourceAdapter";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { createTelnetClient } from "@/lib/telnet/telnetClient";
import { getStoredTelnetPort } from "@/lib/telnet/telnetConfig";
import { createTelnetSession } from "@/lib/telnet/telnetSession";
import { resolveTelnetMenuKey } from "@/lib/telnet/telnetTypes";
import { runWithImplicitAction } from "@/lib/tracing/actionTrace";

type LocalEntry = {
  uri?: string | null;
  name: string;
  modifiedAt?: string | null;
  sizeBytes?: number | null;
};

type ApplyConfigFileReferenceOptions = {
  configRef?: ConfigFileReference | null;
  configOverrides?: ConfigValueOverride[] | null;
  deviceProduct?: string | null;
  localEntriesBySourceId: Map<string, Map<string, LocalEntry>>;
  localSourceTreeUris: Map<string, string | null>;
};

export class ConfigReferenceUnavailableError extends Error {
  readonly c64uConfigUnavailable = true;

  constructor(message: string) {
    super(message);
    this.name = "ConfigReferenceUnavailableError";
  }
}

export const isConfigReferenceUnavailableError = (error: unknown): error is ConfigReferenceUnavailableError =>
  error instanceof ConfigReferenceUnavailableError ||
  (error instanceof Error && Boolean((error as Error & { c64uConfigUnavailable?: boolean }).c64uConfigUnavailable));

/**
 * How long the whole application of a settings file may take before it is treated as stuck.
 *
 * There is no REST endpoint that loads a `.cfg`, so the app drives the device's own menu over
 * Telnet: connect, walk the file browser to the file, load it. Every step has its own read timeout
 * and the browser walk is bounded in steps, but the sequence as a whole had no deadline, and a
 * device whose menu stops answering part-way through leaves it waiting forever. The Play page is
 * disabled while a launch is in flight, so on this rig that showed up as every control on the page
 * dead, with nothing on screen saying why, until the app was restarted. Rebooting the machine from
 * elsewhere while a settings file is being applied is enough to produce it.
 *
 * A successful application takes about 18 seconds against a C64 Ultimate on 1.2RC over this rig's
 * Wi-Fi, measured from "Applying playback config base file" to "Config workflow complete" in the
 * app's own log, so this is generous enough not to cut a slow one short.
 */
export const CONFIG_APPLICATION_DEADLINE_MS = 90_000;

export class ConfigApplicationStalledError extends Error {
  constructor(fileName: string) {
    super(
      `Applying ${fileName} did not finish in ` +
        `${Math.round(CONFIG_APPLICATION_DEADLINE_MS / 1000)}s. The device stopped answering its menu.`,
    );
    this.name = "ConfigApplicationStalledError";
  }
}

/**
 * Whichever settles first, the work or the deadline.
 *
 * The Telnet session behind a timed-out application is left to its own idle timeout rather than
 * being torn down here: what matters is that the caller stops waiting, so the page it disabled
 * becomes usable again and says what went wrong.
 */
const withDeadline = async <T>(work: Promise<T>, fileName: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ConfigApplicationStalledError(fileName)), CONFIG_APPLICATION_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const buildOverridePayload = (overrides: ConfigValueOverride[]) => {
  return overrides.reduce<Record<string, Record<string, string | number>>>((payload, override) => {
    const categoryUpdates = payload[override.category] ?? (payload[override.category] = {});
    categoryUpdates[override.item] = override.value;
    return payload;
  }, {});
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
    try {
      const file = buildLocalPlayFileFromUri(configRef.fileName, configRef.path ?? configRef.fileName, configRef.uri);
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      throw new ConfigReferenceUnavailableError(
        `Local config file ${configRef.fileName} is unavailable. Re-select the associated .cfg file.`,
      );
    }
  }

  const normalizedPath = normalizeSourcePath(configRef.path ?? "");
  if (configRef.sourceId && normalizedPath) {
    const runtimeFile = resolveLocalRuntimeFile(configRef.sourceId, normalizedPath);
    if (runtimeFile) {
      return new Uint8Array(await runtimeFile.arrayBuffer());
    }
    const localEntry = localEntriesBySourceId.get(configRef.sourceId)?.get(normalizedPath);
    if (localEntry?.uri) {
      try {
        const file = buildLocalPlayFileFromUri(configRef.fileName, normalizedPath, localEntry.uri);
        return new Uint8Array(await file.arrayBuffer());
      } catch (error) {
        throw new ConfigReferenceUnavailableError(
          `Local config file ${configRef.fileName} is unavailable. Re-select the associated .cfg file.`,
        );
      }
    }
    const treeUri = localSourceTreeUris.get(configRef.sourceId);
    if (treeUri) {
      try {
        const file = buildLocalPlayFileFromTree(configRef.fileName, normalizedPath, treeUri);
        return new Uint8Array(await file.arrayBuffer());
      } catch (error) {
        throw new ConfigReferenceUnavailableError(
          `Local config file ${configRef.fileName} is unavailable. Re-select the associated .cfg file.`,
        );
      }
    }
  }

  throw new ConfigReferenceUnavailableError(
    `Local config file ${configRef.fileName} is unavailable. Re-select the associated .cfg file.`,
  );
};

export const ensureConfigFileReferenceAccessible = async ({
  configRef,
  localEntriesBySourceId,
  localSourceTreeUris,
}: Pick<ApplyConfigFileReferenceOptions, "configRef" | "localEntriesBySourceId" | "localSourceTreeUris">) => {
  if (!configRef) return;

  if (configRef.kind === "local") {
    await resolveLocalConfigBytes(configRef, localEntriesBySourceId, localSourceTreeUris);
    return;
  }

  const host = stripPortFromDeviceHost(resolveDeviceHostFromStorage());
  const password = await getPassword();
  const parentPath = getParentPath(configRef.path);
  const result = await listFtpDirectory({
    host,
    port: getStoredFtpPort(),
    username: "user",
    password: password ?? "",
    path: parentPath,
  });
  const exists = result.entries.some(
    (entry) => entry.type === "file" && normalizeSourcePath(entry.path) === normalizeSourcePath(configRef.path),
  );
  if (!exists) {
    throw new ConfigReferenceUnavailableError(`Config file ${configRef.fileName} is unavailable.`);
  }
};

export const applyConfigFileReference = async ({
  configRef,
  configOverrides,
  deviceProduct,
  localEntriesBySourceId,
  localSourceTreeUris,
}: ApplyConfigFileReferenceOptions) => {
  if (!configRef && !(configOverrides?.length ?? 0)) {
    return;
  }

  const host = stripPortFromDeviceHost(resolveDeviceHostFromStorage());
  const password = await getPassword();
  const ftpOptions = {
    host,
    port: getStoredFtpPort(),
    username: "user",
    password: password ?? "",
  };
  const menuKey = resolveTelnetMenuKey(deviceProduct) ?? "F5";
  const telnetPort = getStoredTelnetPort();
  const runTelnetWorkflow = async (
    actionId: string,
    callback: (session: ReturnType<typeof createTelnetSession>) => Promise<void>,
  ) =>
    runWithImplicitAction(`config-reference.${actionId}`, (action) =>
      withTelnetInteraction({ action, actionId, intent: "user", host, port: telnetPort }, async () => {
        const transport = createTelnetClient();
        const session = createTelnetSession(transport);
        await session.connect(host, telnetPort, password ?? undefined);
        try {
          await callback(session);
        } finally {
          await session.disconnect();
        }
      }),
    );
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
      await runTelnetWorkflow("config-reference-save-remote", (session) => saveRemoteConfigFromTemp(session, menuKey));
    },
    runApplyRemoteConfig: async (fileName) => {
      await runTelnetWorkflow("config-reference-apply-temp", (session) => applyRemoteConfigFromTemp(session, fileName));
    },
  });

  try {
    if (configRef) {
      if (configRef.kind === "ultimate") {
        addLog("info", "Applying playback config base file", {
          transport: "ultimate",
          path: configRef.path,
          fileName: configRef.fileName,
        });
        await withDeadline(workflow.applyRemoteSnapshot(configRef.path), configRef.fileName);
      } else {
        addLog("info", "Applying playback config base file", {
          transport: "local",
          path: configRef.path ?? configRef.fileName,
          fileName: configRef.fileName,
          sourceId: configRef.sourceId ?? null,
        });
        const bytes = await resolveLocalConfigBytes(configRef, localEntriesBySourceId, localSourceTreeUris);
        await withDeadline(workflow.applyLocalSnapshot(configRef.fileName, bytes), configRef.fileName);
      }
    }

    if (configOverrides?.length) {
      const payload = buildOverridePayload(configOverrides);
      addLog("info", "Applying playback config overrides", {
        categories: Object.keys(payload),
        overrideCount: configOverrides.length,
      });
      await getC64API().updateConfigBatch(payload);
    }
  } catch (error) {
    addErrorLog("Playback config application failed", {
      fileName: configRef?.fileName ?? null,
      configKind: configRef?.kind ?? null,
      overrideCount: configOverrides?.length ?? 0,
      error: (error as Error).message,
    });
    throw error;
  }
};
