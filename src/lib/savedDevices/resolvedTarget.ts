import { buildDeviceHostWithHttpPort } from "@/lib/c64api/hostConfig";
import type { SavedDevice } from "@/lib/savedDevices/store";

/**
 * Build the runtime device host (`host[:port]`) for a saved device.
 *
 * Hostnames are passed through verbatim and resolved by the platform's own
 * resolver (system/router DNS on every platform; `.local` mDNS natively on
 * iOS). The app does not perform any custom name resolution — the Ultimate
 * firmware registers its hostname via DHCP option 12, so DHCP-aware routers
 * make `http://<hostname>/…` reachable directly.
 */
export const buildSavedDevicePreferredRuntimeHost = (device: Pick<SavedDevice, "host" | "httpPort">) =>
  buildDeviceHostWithHttpPort(device.host, device.httpPort);
