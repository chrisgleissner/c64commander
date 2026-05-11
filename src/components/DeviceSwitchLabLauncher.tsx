import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function DeviceSwitchLabLauncher() {
  const location = useLocation();
  const navigate = useNavigate();
  const open = location.pathname === "/__device-switch__";

  const handleClick = useCallback(() => {
    if (open) {
      navigate("/settings");
      return;
    }
    navigate("/__device-switch__");
  }, [navigate, open]);

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="switch-lab-launcher"
      aria-label={open ? "Close Switch Lab" : "Open Switch Lab"}
      className="fixed bottom-4 left-4 z-[2147483646] rounded-full border border-emerald-700/70 bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-black shadow-lg shadow-emerald-950/25"
    >
      {open ? "Close Lab" : "Switch Lab"}
    </button>
  );
}
