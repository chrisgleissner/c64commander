/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { installAsyncContextPropagation } from "./lib/tracing/traceActionContextStore";
import { registerFetchTrace } from "./lib/tracing/fetchTrace";
import { registerUserInteractionCapture } from "./lib/tracing/userInteractionCapture";
import { registerTraceBridge } from "./lib/tracing/traceBridge";
import { primeStoredPassword } from "./lib/secureStorage";
import "./index.css";

const loadFonts = () => {
	if (import.meta.env.VITE_ENABLE_TEST_PROBES === "1") return;
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap";
	document.head.appendChild(link);
};

loadFonts();
// Install async context propagation first - must be before any tracing setup
installAsyncContextPropagation();
registerTraceBridge();
registerFetchTrace();
registerUserInteractionCapture();
void primeStoredPassword();

createRoot(document.getElementById("root")!).render(<App />);
