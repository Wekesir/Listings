const PREFS_KEY = "kenreal:preferences";

const DEFAULT_PREFERENCES = {
  emailUpdates: true,
  inquiryAlerts: true,
  profileVisible: true,
  incomingMessageTone: true
};

export function getStoredPreferences() {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw);
    return {
      emailUpdates: parsed?.emailUpdates !== undefined
        ? Boolean(parsed.emailUpdates)
        : DEFAULT_PREFERENCES.emailUpdates,
      inquiryAlerts: parsed?.inquiryAlerts !== undefined
        ? Boolean(parsed.inquiryAlerts)
        : DEFAULT_PREFERENCES.inquiryAlerts,
      profileVisible: parsed?.profileVisible !== undefined
        ? Boolean(parsed.profileVisible)
        : DEFAULT_PREFERENCES.profileVisible,
      incomingMessageTone: parsed?.incomingMessageTone !== undefined
        ? Boolean(parsed.incomingMessageTone)
        : DEFAULT_PREFERENCES.incomingMessageTone
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function setStoredPreferences(preferences) {
  const merged = {
    ...DEFAULT_PREFERENCES,
    ...(preferences || {})
  };
  window.localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
}

export function isIncomingMessageToneEnabled() {
  return Boolean(getStoredPreferences().incomingMessageTone);
}

export { PREFS_KEY, DEFAULT_PREFERENCES };
