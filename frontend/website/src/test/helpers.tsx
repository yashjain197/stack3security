import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render } from "@testing-library/react";
import type { ApiClient, RequestOptions } from "../lib/api";
import { SessionProvider } from "../lib/session";

export const me = {
  user: { id: "user-1", email: "tester@example.test" },
  plan: "free",
  status: "active",
  features: ["repo_scan"],
  limits: { repo_scan: 20 },
  team: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FakeRequest = (path: string, options?: RequestOptions) => Promise<any>;

export function makeApi(request: FakeRequest, overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    user: me.user,
    signedIn: true,
    initialize: async () => {},
    refresh: async () => ({ accessToken: "token", user: me.user, expiresIn: 1800 }),
    request,
    requestCode: async () => ({ status: "sent", expiresInSeconds: 600, retryAfterSeconds: 60 }),
    verifyCode: async () => ({ accessToken: "token", user: me.user, expiresIn: 1800 }),
    logout: async () => {},
    revokeSession: async () => {},
    subscribe: () => () => {},
    dispose: () => {},
    ...overrides,
  } as ApiClient;
}

export function renderPage(path: string, element: ReactNode, api: ApiClient, route: string) {
  return render(
    <SessionProvider api={api}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={element} />
          <Route path="*" element={<div data-testid="other-route" />} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}
