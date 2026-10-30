import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError, createApiClient } from "./lib/api";
import { App } from "./App";
import "./styles.css";

const container = document.querySelector("#app")!;

async function start() {
  container.innerHTML = '<div class="account-loading" role="status">Connecting to Stack3…</div>';
  try {
    const response = await fetch("/config.json", {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Unable to load webpage API configuration.");
    const config = await response.json();
    const base = new URL(config.apiBaseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
      throw new Error("Invalid API base URL.");
    }
    const api = createApiClient({
      baseUrl: base.href.replace(/\/$/, ""),
    });
    let startupError: ApiError | null = null;
    try {
      await api.initialize();
    } catch (error) {
      startupError = error as ApiError;
    }
    container.innerHTML = "";
    createRoot(container).render(
      <StrictMode>
        <App api={api} startupError={startupError} />
      </StrictMode>,
    );
  } catch (error) {
    container.textContent = `Unable to initialize Stack3: ${(error as Error).message} Reload to try again.`;
  }
}

void start();
