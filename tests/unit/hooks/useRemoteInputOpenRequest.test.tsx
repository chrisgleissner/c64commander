/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScreenActivityProvider } from "@/hooks/useScreenActivity";
import { useRemoteInputOpenRequest } from "@/hooks/useRemoteInputOpenRequest";
import { remoteInputRequestBus } from "@/lib/input/latchedCommandBus";

const Host = ({ onOpen }: { onOpen: () => void }) => {
  useRemoteInputOpenRequest(onOpen);
  return null;
};

const Slots = ({
  homeActive,
  onHomeOpen,
  onPlayOpen,
}: {
  homeActive: boolean;
  onHomeOpen: () => void;
  onPlayOpen: () => void;
}) => (
  <>
    <ScreenActivityProvider active={homeActive}>
      <Host onOpen={onHomeOpen} />
    </ScreenActivityProvider>
    <ScreenActivityProvider active={!homeActive}>
      <Host onOpen={onPlayOpen} />
    </ScreenActivityProvider>
  </>
);

describe("useRemoteInputOpenRequest", () => {
  afterEach(() => {
    remoteInputRequestBus.reset();
  });

  it("opens only the sheet of the page on screen when Home and Play are both mounted", () => {
    const onHomeOpen = vi.fn();
    const onPlayOpen = vi.fn();
    render(<Slots homeActive={false} onHomeOpen={onHomeOpen} onPlayOpen={onPlayOpen} />);

    act(() => remoteInputRequestBus.publish("open"));

    expect(onPlayOpen).toHaveBeenCalledTimes(1);
    expect(onHomeOpen).not.toHaveBeenCalled();
  });

  it("leaves a request raised while no host page is on screen for the host page that is shown next", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <ScreenActivityProvider active={false}>
        <Host onOpen={onOpen} />
      </ScreenActivityProvider>,
    );

    act(() => remoteInputRequestBus.publish("open"));
    expect(onOpen).not.toHaveBeenCalled();

    rerender(
      <ScreenActivityProvider active>
        <Host onOpen={onOpen} />
      </ScreenActivityProvider>,
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(remoteInputRequestBus.takePending()).toBeNull();
  });

  it("claims a request outstanding when the page mounts on screen", () => {
    const onOpen = vi.fn();
    remoteInputRequestBus.publish("open");

    render(<Host onOpen={onOpen} />);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
