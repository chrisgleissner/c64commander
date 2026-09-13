/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatefulButton, StatelessButton } from "@/components/ui/button";

describe("StatefulButton", () => {
  it("renders a native button and forwards clicks", () => {
    const onClick = vi.fn();

    render(<StatefulButton onClick={onClick}>Press</StatefulButton>);

    fireEvent.click(screen.getByRole("button", { name: "Press" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders the child element when asChild is enabled", () => {
    render(
      <StatefulButton asChild variant="link">
        <a href="/docs">Docs</a>
      </StatefulButton>,
    );

    const link = screen.getByRole("link", { name: "Docs" });

    expect(link).toHaveAttribute("href", "/docs");
    expect(link.className).toContain("underline-offset-4");
  });
});

describe("StatelessButton", () => {
  it("activates on touch pointer up and suppresses the follow-up click", () => {
    const onClick = vi.fn();

    render(<StatelessButton onClick={onClick}>Pause</StatelessButton>);

    const button = screen.getByRole("button", { name: "Pause" });
    fireEvent.pointerUp(button, { pointerType: "touch" });
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not let the tap that opened a dialog press the dialog's button under the finger", () => {
    const onChoose = vi.fn();
    const Opener = () => {
      const [open, setOpen] = React.useState(false);
      return open ? (
        <StatelessButton key="option" onClick={onChoose}>
          C64U
        </StatelessButton>
      ) : (
        <StatelessButton key="opener" onClick={() => setOpen(true)}>
          Add items
        </StatelessButton>
      );
    };
    render(<Opener />);

    fireEvent.pointerUp(screen.getByRole("button", { name: "Add items" }), {
      pointerType: "touch",
      clientX: 300,
      clientY: 376,
    });
    // The same tap's compatibility click arrives after the dialog has replaced the opener.
    fireEvent.click(screen.getByRole("button", { name: "C64U" }), { detail: 1, clientX: 300, clientY: 376 });

    expect(onChoose).not.toHaveBeenCalled();
  });

  it("still lets a separate tap elsewhere press the dialog's button", () => {
    const onChoose = vi.fn();
    const Opener = () => {
      const [open, setOpen] = React.useState(false);
      return open ? (
        <StatelessButton key="option" onClick={onChoose}>
          C64U
        </StatelessButton>
      ) : (
        <StatelessButton key="opener" onClick={() => setOpen(true)}>
          Add items
        </StatelessButton>
      );
    };
    render(<Opener />);

    fireEvent.pointerUp(screen.getByRole("button", { name: "Add items" }), {
      pointerType: "touch",
      clientX: 300,
      clientY: 376,
    });
    fireEvent.click(screen.getByRole("button", { name: "C64U" }), { detail: 1, clientX: 200, clientY: 290 });

    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it("keeps mouse clicks single-fired", () => {
    const onClick = vi.fn();

    render(<StatelessButton onClick={onClick}>Stop</StatelessButton>);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
