import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { registerFetchTrace } from "./lib/tracing/fetchTrace";
import "./index.css";

registerFetchTrace();

createRoot(document.getElementById("root")!).render(<App />);
