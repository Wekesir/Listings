const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const HEALTH_CACHE_TTL_MS = 10000;

let lastHealthyAt = 0;

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureBackendAvailable() {
  const now = Date.now();
  const recentlyHealthy = now - lastHealthyAt < HEALTH_CACHE_TTL_MS;

  if (recentlyHealthy) {
    return;
  }

  try {
    const healthResponse = await fetchWithTimeout(
      `${API_BASE_URL}/api/health`,
      {
        method: "GET"
      },
      4000
    );

    if (!healthResponse.ok) {
      throw new Error("Health check failed");
    }

    lastHealthyAt = Date.now();
  } catch (_error) {
    throw new Error(
      "Backend is currently unavailable. Please ensure the API server is running."
    );
  }
}

export async function apiRequest(path, options = {}) {
  await ensureBackendAvailable();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...options
  });
  const responseText = await response.text();
  let data = null;

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch (_error) {
      data = null;
    }
  }

  if (!response.ok) {
    throw new Error(data?.message || "Request failed");
  }

  return data;
}
