const USER_STORAGE_KEY = "kenreal:user";
const THEME_STORAGE_KEY = "kenreal:theme";
const SESSION_META_STORAGE_KEY = "kenreal:session-meta";
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getStoredUser() {
  if (!canUseStorage()) {
    return null;
  }

  const raw = window.localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

export function setStoredUser(user) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(USER_STORAGE_KEY);
}

export function getStoredSessionMeta() {
  if (!canUseStorage()) {
    return {
      timeoutMs: DEFAULT_SESSION_TIMEOUT_MS,
      lastActivityAt: Date.now()
    };
  }

  const raw = window.localStorage.getItem(SESSION_META_STORAGE_KEY);
  if (!raw) {
    return {
      timeoutMs: DEFAULT_SESSION_TIMEOUT_MS,
      lastActivityAt: Date.now()
    };
  }

  try {
    const parsed = JSON.parse(raw);
    const timeoutMs = Number(parsed?.timeoutMs);
    const lastActivityAt = Number(parsed?.lastActivityAt);

    return {
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_SESSION_TIMEOUT_MS,
      lastActivityAt: Number.isFinite(lastActivityAt) && lastActivityAt > 0 ? lastActivityAt : Date.now()
    };
  } catch (_error) {
    return {
      timeoutMs: DEFAULT_SESSION_TIMEOUT_MS,
      lastActivityAt: Date.now()
    };
  }
}

export function setStoredSessionMeta(partialMeta = {}) {
  if (!canUseStorage()) {
    return;
  }

  const current = getStoredSessionMeta();
  const timeoutMs = Number(partialMeta.timeoutMs);
  const lastActivityAt = Number(partialMeta.lastActivityAt);
  const next = {
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : current.timeoutMs,
    lastActivityAt: Number.isFinite(lastActivityAt) && lastActivityAt > 0 ? lastActivityAt : current.lastActivityAt
  };

  window.localStorage.setItem(SESSION_META_STORAGE_KEY, JSON.stringify(next));
}

export function clearStoredSessionMeta() {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(SESSION_META_STORAGE_KEY);
}

export function getStoredTheme() {
  if (!canUseStorage()) {
    return "light";
  }

  const theme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return theme === "dark" ? "dark" : "light";
}

export function setStoredTheme(theme) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, theme === "dark" ? "dark" : "light");
}
