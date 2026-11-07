import type { WorkspaceState } from "@/lib/server/state";
import type { RunEvent, Run } from "@/db/schema";

export type State = WorkspaceState;
export type MandateView = State["mandates"][number];
export type PurchaseView = State["purchases"][number];
export type RunView = Run;
export type EventView = RunEvent;

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly missing?: string[]) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { body?: string }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body.missing);
  return body as T;
}
