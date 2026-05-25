function createUnreadEmailScheduler({ delayMs, handler }) {
  const normalizedDelayMs = Math.max(0, Number(delayMs) || 0);
  const callback = typeof handler === "function" ? handler : async () => {};
  const timers = new Map();

  function schedule(key, payload) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return;

    const existingTimer = timers.get(normalizedKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timeout = setTimeout(() => {
      timers.delete(normalizedKey);
      void Promise.resolve(callback(payload)).catch(() => {});
    }, normalizedDelayMs);

    if (typeof timeout.unref === "function") {
      timeout.unref();
    }
    timers.set(normalizedKey, timeout);
  }

  function clear(key) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return;
    const existingTimer = timers.get(normalizedKey);
    if (!existingTimer) return;
    clearTimeout(existingTimer);
    timers.delete(normalizedKey);
  }

  function clearAll() {
    timers.forEach((timeout) => clearTimeout(timeout));
    timers.clear();
  }

  function pendingCount() {
    return timers.size;
  }

  return {
    schedule,
    clear,
    clearAll,
    pendingCount
  };
}

module.exports = {
  createUnreadEmailScheduler
};
