/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render } from "@testing-library/react";
import React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useCurrentPathReader, useStableNavigate, type StableNavigate } from "@/hooks/useStableNavigate";

const handles: { navigate?: StableNavigate; readPath?: () => string; renders: number; path?: string } = {
  renders: 0,
};

const Navigator = React.memo(function Navigator() {
  handles.renders += 1;
  handles.navigate = useStableNavigate();
  handles.readPath = useCurrentPathReader();
  return null;
});

const PathProbe = () => {
  handles.path = useLocation().pathname;
  return null;
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Navigator />
      <PathProbe />
    </MemoryRouter>,
  );

describe("useStableNavigate", () => {
  it("navigates to an absolute path, replaces, and goes back, without re-rendering the caller", () => {
    handles.renders = 0;
    renderAt("/");
    const rendersBefore = handles.renders;

    act(() => handles.navigate!("/play"));
    expect(handles.path).toBe("/play");
    act(() => handles.navigate!("/disks", { replace: true }));
    expect(handles.path).toBe("/disks");
    act(() => handles.navigate!(-1));
    expect(handles.path).toBe("/");

    expect(handles.renders).toBe(rendersBefore);
  });

  it("reads the route the router is on when asked", () => {
    renderAt("/config");
    expect(handles.readPath!()).toBe("/config");
    act(() => handles.navigate!("/settings"));
    expect(handles.readPath!()).toBe("/settings");
  });
});
