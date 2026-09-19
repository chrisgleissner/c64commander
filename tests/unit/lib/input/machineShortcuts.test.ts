import { describe, expect, it, vi } from "vitest";

import { requestMachineCommand, subscribeMachineCommand, type MachineCommand } from "@/lib/input/keypadCommands";

/*
 * What these keys are for. Measured on the handset before they existed: Pause was ten presses from
 * a cold arrival (Down x3, OK, Left x5, OK) and Reset eight, both through Home's Quick Actions
 * grid. The grid stays where it is; these are a second way in that costs one press, or two for the
 * reset that still asks first.
 */
describe("the machine keys a keypad user reaches for", () => {
  it("carries the command to whoever owns the machine controls", () => {
    const seen: MachineCommand[] = [];
    const unsubscribe = subscribeMachineCommand((command) => seen.push(command));

    requestMachineCommand("pauseResume");
    requestMachineCommand("reset");

    expect(seen).toEqual(["pauseResume", "reset"]);
    unsubscribe();
  });

  it("stops carrying them once the listener has gone", () => {
    const handler = vi.fn();
    subscribeMachineCommand(handler)();

    requestMachineCommand("reset");

    expect(handler).not.toHaveBeenCalled();
  });
});
