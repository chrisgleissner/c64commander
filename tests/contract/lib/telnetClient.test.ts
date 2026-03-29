import { afterEach, describe, expect, it } from "vitest";
import { TelnetClient } from "./telnetClient.js";
import { createMockTelnetServer, type MockTelnetServer } from "../mockTelnetServer.js";

describe("TelnetClient", () => {
  let server: MockTelnetServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("connects without a password and captures the action menu tree", async () => {
    server = await createMockTelnetServer();
    const client = new TelnetClient({ host: server.host, port: server.port, timeoutMs: 200 });

    await client.connect();
    const initialScreen = await client.readScreen();
    await client.sendKey("F5");
    const menuScreen = await client.readScreen();

    expect(client.promptedForPassword).toBe(false);
    expect(initialScreen.titleLine).toContain("C64 Ultimate");
    expect(menuScreen.menus[0]?.items.map((item) => item.label)).toContain("Power & Reset");

    await client.close();
  });

  it("requires the configured password before entering the first Telnet page", async () => {
    server = await createMockTelnetServer({ password: "secret" });

    const missingPasswordClient = new TelnetClient({ host: server.host, port: server.port, timeoutMs: 200 });
    await expect(missingPasswordClient.connect()).rejects.toMatchObject({
      code: "AUTH_FAILED",
    });

    const client = new TelnetClient({ host: server.host, port: server.port, password: "secret", timeoutMs: 200 });
    await client.connect();
    const initialScreen = await client.readScreen();

    expect(client.promptedForPassword).toBe(true);
    expect(initialScreen.screenType).toBe("action_menu");

    await client.close();
  });

  it("shows the selected-directory action menu after navigating into the USB browser", async () => {
    server = await createMockTelnetServer();
    const client = new TelnetClient({ host: server.host, port: server.port, timeoutMs: 200 });

    await client.connect();
    await client.readScreen();
    await selectEntry(client, "USB1");
    await client.sendKey("RIGHT");
    await client.readScreen();
    await client.sendKey("F1");
    const menuScreen = await client.readScreen();

    expect(menuScreen.menus[0]?.items.map((item) => item.label)).toContain("Create");
    expect(menuScreen.menus[0]?.items.map((item) => item.label)).toContain("UltiCopy");

    await client.close();
  });

  it("opens the REU snapshot context menu with the expected actions", async () => {
    server = await createMockTelnetServer();
    const client = new TelnetClient({ host: server.host, port: server.port, timeoutMs: 200 });

    await client.connect();
    await client.readScreen();
    await selectEntry(client, "USB1");
    await client.sendKey("RIGHT");
    await client.readScreen();
    await enterDirectory(client, "test-data");
    await enterDirectory(client, "snapshots");
    await selectEntry(client, "reu.reu");
    await client.sendKey("ENTER");
    const contextMenuScreen = await client.readScreen();

    expect(contextMenuScreen.menus.at(-1)?.items.map((item) => item.label)).toEqual([
      "Load into REU",
      "Preload on Startup",
      "Rename",
      "Delete",
    ]);

    await client.close();
  });
});

async function selectEntry(client: TelnetClient, entryName: string): Promise<void> {
  let screen = await client.readScreen();
  for (let attempts = 0; attempts < 40; attempts += 1) {
    if (normalizeSelectedItem(screen.selectedItem) === entryName.toLowerCase()) {
      return;
    }
    await client.sendKey("DOWN");
    screen = await client.readScreen();
  }
  throw new Error(`Unable to select entry ${entryName}`);
}

async function enterDirectory(client: TelnetClient, directoryName: string): Promise<void> {
  await selectEntry(client, directoryName);
  await client.sendKey("ENTER");
  await client.readScreen();
  await client.sendKey("ENTER");
  await client.readScreen();
}

function normalizeSelectedItem(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}
