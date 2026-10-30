import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ApiClient } from "./api";
import { ApiError } from "./api";
import type { User } from "../types";

type SessionContextValue = {
  api: ApiClient;
  flash: string;
  setFlash: (text: string) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const [flash, setFlash] = useState("");
  return <SessionContext.Provider value={{ api, flash, setFlash }}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider is missing.");
  return value;
}

export function useApi(): ApiClient {
  return useSessionContext().api;
}

export function useSession(): { signedIn: boolean; user: User | null } {
  const api = useApi();
  const signedIn = useSyncExternalStore(api.subscribe, () => api.signedIn);
  const user = useSyncExternalStore(api.subscribe, () => api.user);
  return { signedIn, user };
}

export function errorMessage(error: ApiError | Error): string {
  let text = error.message;
  if (error instanceof ApiError) {
    if (error.fields?.length) text += ` ${error.fields.map((item) => `${item.field}: ${item.message}`).join("; ")}`;
    if (error.retryAfter > 0) text += ` Try again in ${error.retryAfter} seconds.`;
    if (error.requestId) text += ` Reference: ${error.requestId}.`;
  }
  return text;
}

export function externalRedirect(value: string) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError("The billing provider returned an invalid redirect URL.", { code: "invalid_response" });
  }
  if (url.protocol !== "https:") {
    throw new ApiError("The billing provider returned an unsafe redirect URL.", { code: "invalid_response" });
  }
  window.location.assign(url.href);
}

export const formatDateTime = (value: string | number | null | undefined): string =>
  value ? new Date(value).toLocaleString() : "Not set";
