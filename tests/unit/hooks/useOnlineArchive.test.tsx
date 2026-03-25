import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useOnlineArchive } from "@/hooks/useOnlineArchive";
import { createAssembly64Mock } from "../../mocks/assembly64Mock";
import { createCommoserveMock } from "../../mocks/commoserveMock";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(closers.splice(0).map((close) => close()));
});

describe("useOnlineArchive", () => {
  it("switches backends at runtime without stale requests or config leakage", async () => {
    const commodore = await createCommoserveMock();
    const assembly = await createAssembly64Mock();
    closers.push(commodore.close, assembly.close);

    const { result, rerender } = renderHook(
      (props: Parameters<typeof useOnlineArchive>[0]) => useOnlineArchive(props),
      {
        initialProps: {
          backend: "commodore" as const,
          hostOverride: commodore.host,
          clientIdOverride: "",
          userAgentOverride: "",
        },
      },
    );

    await waitFor(() => expect(result.current.presetsLoading).toBe(false));
    expect(result.current.clientType).toBe("CommoserveClient");
    expect(result.current.resolvedConfig.host).toBe(commodore.host);

    await act(async () => {
      await result.current.search({ name: "joyride", category: "apps" });
    });
    await waitFor(() => expect(result.current.state.phase).toBe("results"));
    expect(result.current.state.phase === "results" && result.current.state.results[0]?.name).toBe("Joyride");

    rerender({
      backend: "assembly64" as const,
      hostOverride: assembly.host,
      clientIdOverride: "",
      userAgentOverride: "",
    });

    await waitFor(() => expect(result.current.presetsLoading).toBe(false));
    expect(result.current.clientType).toBe("Assembly64Client");
    expect(result.current.resolvedConfig.host).toBe(assembly.host);

    await act(async () => {
      await result.current.search({ name: "wizball", category: "games" });
    });
    await waitFor(() => expect(result.current.state.phase).toBe("results"));
    expect(result.current.state.phase === "results" && result.current.state.results[0]?.name).toBe("Wizball");
    expect(commodore.requests.some((request) => request.url.includes("wizball"))).toBe(false);
    expect(assembly.requests.some((request) => request.url.includes("wizball"))).toBe(true);
  });
});
