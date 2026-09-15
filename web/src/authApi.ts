const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export type AuthSession = {
  token: string;
  expiresAt: string;
  identity: {
    userId: string;
    tenantId: string;
    email: string | null;
    username: string | null;
    plan: "beta" | "free" | "pro";
    role: "owner" | "member" | "admin";
    authKind: "account" | "legacy-beta";
  };
};

export type SignupRequestResult = {
  status: "pending";
  request: {
    userId: string;
    email: string;
    username?: string;
    status: "pending" | "active" | "rejected";
    createdAt: string;
    updatedAt: string;
  };
};

export async function authConfig(): Promise<{ signupAvailable: boolean; signupMode?: "approval" }> {
  return request("/api/auth/config", { method: "GET" });
}

export async function loginAccount(identifier: string, password: string): Promise<AuthSession> {
  return request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: identifier, password }) });
}

export async function registerAccount(email: string, password: string): Promise<SignupRequestResult> {
  return request("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
}

export async function logoutAccount(token: string): Promise<void> {
  await request("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers }
  });
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string; issues?: string[] } & T;
  if (!response.ok) throw new Error(body.message ?? body.issues?.join(", ") ?? body.error ?? `HTTP ${response.status}`);
  return body;
}
