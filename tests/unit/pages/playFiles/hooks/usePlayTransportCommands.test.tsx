/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { transportCommandBus } from "@/lib/input/latchedCommandBus";
import { usePlayTransportCommands } from "@/pages/playFiles/hooks/usePlayTransportCommands";
import type { TransportCommandHandlers } from "@/pages/playFiles/transportCommands";

const handlersFor = (state: Partial<Pick<TransportCommandHandlers, "isPlaying" | "isPaused">> = {}) => ({
  isPlaying: false,
  isPaused: false,
  play: vi.fn(),
  pauseResume: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  stop: vi.fn(),
  ...state,
});

const Probe = ({ handlers, ready }: { handlers: TransportCommandHandlers; ready: boolean }) => {
  usePlayTransportCommands(handlers, ready);
  return null;
};

describe("usePlayTransportCommands", () => {
  beforeEach(() => transportCommandBus.reset());
  afterEach(() => transportCommandBus.reset());

  it.each([
    ["next", "next"],
    ["previous", "previous"],
    ["stop", "stop"],
  ] as const)("runs the %s handler for a %s command", (command, handlerName) => {
    const handlers = handlersFor({ isPlaying: true });
    render(<Probe handlers={handlers} ready />);

    transportCommandBus.publish(command);

    expect(handlers[handlerName]).toHaveBeenCalledTimes(1);
    expect(handlers.play).not.toHaveBeenCalled();
  });

  it("starts playback for Play when nothing plays, and resumes a paused session instead", () => {
    const idle = handlersFor();
    const first = render(<Probe handlers={idle} ready />);
    transportCommandBus.publish("play");
    expect(idle.play).toHaveBeenCalledTimes(1);
    first.unmount();

    const paused = handlersFor({ isPlaying: true, isPaused: true });
    render(<Probe handlers={paused} ready />);
    transportCommandBus.publish("play");
    expect(paused.pauseResume).toHaveBeenCalledTimes(1);
    expect(paused.play).not.toHaveBeenCalled();
  });

  it("holds a command that arrived early until the page is ready, then runs it once", () => {
    transportCommandBus.publish("next");
    const handlers = handlersFor({ isPlaying: true });
    const view = render(<Probe handlers={handlers} ready={false} />);
    expect(handlers.next).not.toHaveBeenCalled();

    view.rerender(<Probe handlers={handlers} ready />);

    expect(handlers.next).toHaveBeenCalledTimes(1);
  });
});
