import { buildDeviceHostWithHttpPort } from "@/lib/c64api/hostConfig";
import { isBareHostname, isMdnsAvailable } from "@/lib/native/mdnsResolver";
import type { DeviceSwitchSummary, SavedDevice } from "@/lib/savedDevices/store";

export const getSavedDeviceResolvedAddress = (summary?: Pick<DeviceSwitchSummary, "lastResolvedAddress"> | null) => {
    const resolvedAddress = summary?.lastResolvedAddress?.trim() ?? "";
    return resolvedAddress.length > 0 ? resolvedAddress : null;
};

export const buildSavedDevicePreferredRuntimeHost = (
    device: Pick<SavedDevice, "host" | "httpPort">,
    summary?: Pick<DeviceSwitchSummary, "lastResolvedAddress"> | null,
) => {
    const rawDeviceHost = buildDeviceHostWithHttpPort(device.host, device.httpPort);
    if (!isMdnsAvailable() || !isBareHostname(device.host)) {
        return rawDeviceHost;
    }
    const resolvedAddress = getSavedDeviceResolvedAddress(summary);
    return resolvedAddress ? buildDeviceHostWithHttpPort(resolvedAddress, device.httpPort) : rawDeviceHost;
};

export const shouldWarnAboutAndroidHostnameResolution = (
    device: Pick<SavedDevice, "host">,
    summary?: Pick<DeviceSwitchSummary, "lastResolvedAddress"> | null,
) => isMdnsAvailable() && isBareHostname(device.host) && !getSavedDeviceResolvedAddress(summary);
