export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiResult<T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; data: T }> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.assign("/login");
    throw new ApiError(401, "unauthorized");
  }
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : res.statusText;
    throw new ApiError(res.status, message);
  }
  return { status: res.status, data: data as T };
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await apiResult<T>(path, init);
  return data;
}
