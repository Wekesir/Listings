const BROWSE_FILTERS_KEY = "kenreal:last-browse-filters";

function normalizeString(value) {
  return String(value || "").trim();
}

export function getStoredBrowseFilters() {
  try {
    const raw = window.localStorage.getItem(BROWSE_FILTERS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      searchTerm: normalizeString(parsed.searchTerm),
      propertyType: normalizeString(parsed.propertyType || "all").toLowerCase() || "all",
      location: normalizeString(parsed.location || "all"),
      maxPrice: normalizeString(parsed.maxPrice),
      updatedAt: Number(parsed.updatedAt) || Date.now()
    };
  } catch {
    return null;
  }
}

export function setStoredBrowseFilters(filters) {
  try {
    const payload = {
      searchTerm: normalizeString(filters?.searchTerm),
      propertyType: normalizeString(filters?.propertyType || "all").toLowerCase() || "all",
      location: normalizeString(filters?.location || "all"),
      maxPrice: normalizeString(filters?.maxPrice),
      updatedAt: Date.now()
    };
    window.localStorage.setItem(BROWSE_FILTERS_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}
