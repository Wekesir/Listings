import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getProperties } from "../services/propertyService";
import { logoutAccount } from "../services/authService";
import { useShortlist } from "../hooks/useShortlist";
import {
  clearStoredSessionMeta,
  clearStoredUser,
  getStoredUser
} from "../utils/session";
import { notify } from "../utils/notify";
import {
  getFallbackImage,
  hasCustomImage,
  resolvePropertyImageUrl
} from "../utils/propertyMedia";
import { setStoredBrowseFilters } from "../utils/recommendationFilters";
import PropertyMediaBadge from "../components/PropertyMediaBadge";

const LISTINGS_PER_PAGE = 9;
const ALLOWED_TYPES = new Set(["all", "rent", "lease"]);
const ALLOWED_SORTS = new Set(["default", "price-asc", "price-desc", "latest"]);

function formatPrice(price, type) {
  const value = Number(price);
  if (Number.isNaN(value)) return "Price on request";
  const suffix = type === "lease" ? "/ mo (lease)" : "/ mo (rent)";
  return `KSh ${value.toLocaleString("en-KE")} ${suffix}`;
}

function getPropertyFeatures(id) {
  const beds = (id % 4) + 1;
  const baths = beds > 2 ? 2 : 1;
  const area = 40 + (id * 17) % 120;
  return { beds, baths, area };
}

function isPaidListing(item) {
  return String(item?.paymentStatus || "").toLowerCase() === "paid";
}

function parseInitialFilters() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("type") || "all";
  const sort = params.get("sort") || "default";
  const max = params.get("maxPrice") || "";
  const page = Number(params.get("page") || "1");
  return {
    searchTerm: params.get("search") || "",
    propertyType: ALLOWED_TYPES.has(type) ? type : "all",
    location: params.get("location") || "all",
    maxPrice: /^\d+$/.test(max) ? max : "",
    sortBy: ALLOWED_SORTS.has(sort) ? sort : "default",
    currentPage: Number.isInteger(page) && page > 0 ? page : 1
  };
}

function BrowseListingsPage() {
  const navigate = useNavigate();
  const initial = useMemo(() => parseInitialFilters(), []);

  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loggedInUser, setLoggedInUser] = useState(() => getStoredUser());
  const [scrolled, setScrolled] = useState(false);

  const [searchTerm, setSearchTerm] = useState(initial.searchTerm);
  const [propertyType, setPropertyType] = useState(initial.propertyType);
  const [location, setLocation] = useState(initial.location);
  const [maxPrice, setMaxPrice] = useState(initial.maxPrice);
  const [sortBy, setSortBy] = useState(initial.sortBy);
  const [currentPage, setCurrentPage] = useState(initial.currentPage);

  const { shortlistedIds, shortlistedLookup, toggleShortlist } = useShortlist();

  useEffect(() => {
    const handleStorageChange = () => setLoggedInUser(getStoredUser());
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadProperties = async () => {
      try {
        const data = await getProperties();
        if (!cancelled) {
          setProperties(Array.isArray(data) ? data : []);
        }
      } catch (_err) {
        if (!cancelled) {
          const msg = "Unable to load listings right now. Please try again shortly.";
          setError(msg);
          notify(msg, "warning");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadProperties();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (searchTerm.trim()) params.set("search", searchTerm.trim());
    if (propertyType !== "all") params.set("type", propertyType);
    if (location !== "all") params.set("location", location);
    if (maxPrice.trim()) params.set("maxPrice", maxPrice.trim());
    if (sortBy !== "default") params.set("sort", sortBy);
    if (currentPage > 1) params.set("page", String(currentPage));
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [searchTerm, propertyType, location, maxPrice, sortBy, currentPage]);

  useEffect(() => {
    setStoredBrowseFilters({
      searchTerm,
      propertyType,
      location,
      maxPrice
    });
  }, [searchTerm, propertyType, location, maxPrice]);

  const availableLocations = useMemo(() => {
    const seen = new Map();
    properties.forEach((item) => {
      const raw = String(item?.location || "").trim();
      if (!raw) return;
      const firstSegment = raw.split(",")[0]?.trim() || raw;
      if (firstSegment && !seen.has(firstSegment.toLowerCase())) {
        seen.set(firstSegment.toLowerCase(), firstSegment);
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [properties]);

  const filteredProperties = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    const locNeedle = location.toLowerCase();
    return properties.filter((item) => {
      if (item?.isSoftDeleted) return false;
      const title = String(item.title || "").toLowerCase();
      const loc = String(item.location || "").toLowerCase();
      const matchesSearch = needle === "" || title.includes(needle) || loc.includes(needle);
      const matchesType = propertyType === "all" || item.type === propertyType;
      const matchesLocation = location === "all" || loc.includes(locNeedle);
      const matchesPrice = maxPrice.trim() === "" || Number(item.price) <= Number(maxPrice);
      return matchesSearch && matchesType && matchesLocation && matchesPrice;
    });
  }, [properties, searchTerm, propertyType, location, maxPrice]);

  const sortedProperties = useMemo(() => {
    const applyBucketSort = (bucket) => {
      const copy = [...bucket];
      if (sortBy === "price-asc") return copy.sort((a, b) => Number(a.price) - Number(b.price));
      if (sortBy === "price-desc") return copy.sort((a, b) => Number(b.price) - Number(a.price));
      if (sortBy === "latest") return copy.sort((a, b) => Number(b.id) - Number(a.id));
      return copy.sort((a, b) => Number(b.id) - Number(a.id));
    };
    const paid = [];
    const standard = [];
    filteredProperties.forEach((item) => {
      if (isPaidListing(item)) paid.push(item);
      else standard.push(item);
    });
    return [...applyBucketSort(paid), ...applyBucketSort(standard)];
  }, [filteredProperties, sortBy]);

  const totalPages = Math.max(1, Math.ceil(sortedProperties.length / LISTINGS_PER_PAGE));

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const paginatedProperties = useMemo(() => {
    const start = (currentPage - 1) * LISTINGS_PER_PAGE;
    return sortedProperties.slice(start, start + LISTINGS_PER_PAGE);
  }, [sortedProperties, currentPage]);

  const paidCount = useMemo(
    () => filteredProperties.filter(isPaidListing).length,
    [filteredProperties]
  );

  const suggestedWhenEmpty = useMemo(() => {
    if (properties.length === 0) return [];
    const locNeedle = location.toLowerCase();
    const scored = properties
      .filter((item) => !item?.isSoftDeleted)
      .map((item) => {
        const loc = String(item.location || "").toLowerCase();
        const sameLocation = location !== "all" && loc.includes(locNeedle);
        const sameType = propertyType !== "all" && item.type === propertyType;
        const promoted = isPaidListing(item);
        const score = (sameLocation ? 6 : 0) + (sameType ? 3 : 0) + (promoted ? 2 : 0);
        return { item, score };
      })
      .sort((a, b) => b.score - a.score || Number(b.item.id) - Number(a.item.id));
    return scored.slice(0, 3).map((entry) => entry.item);
  }, [properties, location, propertyType]);

  const hasActiveFilters =
    searchTerm.trim() !== "" ||
    propertyType !== "all" ||
    location !== "all" ||
    maxPrice.trim() !== "" ||
    sortBy !== "default";

  const clearFilters = useCallback(() => {
    setSearchTerm("");
    setPropertyType("all");
    setLocation("all");
    setMaxPrice("");
    setSortBy("default");
    setCurrentPage(1);
  }, []);

  const handleLogout = async () => {
    try {
      await logoutAccount({ reason: "manual" });
    } catch (_error) {
      // Session may already be invalid.
    }
    clearStoredUser();
    clearStoredSessionMeta();
    setLoggedInUser(null);
  };

  const startIndex = sortedProperties.length === 0 ? 0 : (currentPage - 1) * LISTINGS_PER_PAGE + 1;
  const endIndex = Math.min(currentPage * LISTINGS_PER_PAGE, sortedProperties.length);

  const pageNumbers = useMemo(() => {
    const max = totalPages;
    const cur = currentPage;
    if (max <= 7) return Array.from({ length: max }, (_, i) => i + 1);
    const pages = new Set([1, 2, max - 1, max, cur - 1, cur, cur + 1]);
    return Array.from(pages)
      .filter((n) => n >= 1 && n <= max)
      .sort((a, b) => a - b);
  }, [currentPage, totalPages]);

  return (
    <div className="kr-browse-page">
      {/* ─────────── Navbar ─────────── */}
      <nav className={`navbar navbar-expand-lg site-navbar sticky-top ${scrolled ? "site-navbar--scrolled" : ""}`}>
        <div className="container py-1">
          <Link className="navbar-brand-logo" to="/">
            <span className="brand-icon">
              <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
                <rect width="64" height="64" rx="14" fill="#1e3a5f" />
                <circle cx="47" cy="17" r="7" fill="#e8a020" />
                <text x="14" y="42" fontFamily="Arial, sans-serif" fontSize="24" fontWeight="700" fill="#ffffff">KR</text>
              </svg>
            </span>
            KenReal<span className="brand-dot"></span>Estates
          </Link>
          <button
            className="navbar-toggler border-0"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#browseNav"
            aria-controls="browseNav"
            aria-expanded="false"
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon"></span>
          </button>
          <div className="collapse navbar-collapse" id="browseNav">
            <ul className="navbar-nav mx-auto mb-2 mb-lg-0 gap-1">
              <li className="nav-item">
                <Link className="nav-link kr-nav-link" to="/">Home</Link>
              </li>
              <li className="nav-item">
                <Link className="nav-link kr-nav-link active" to="/browse">Listings</Link>
              </li>
              <li className="nav-item">
                <Link className="nav-link kr-nav-link" to="/#why-us">Why KenReal</Link>
              </li>
              <li className="nav-item">
                <Link className="nav-link kr-nav-link" to="/#shortlist">
                  My Shortlist
                  {shortlistedIds.length > 0 && (
                    <span className="kr-nav-badge">{shortlistedIds.length}</span>
                  )}
                </Link>
              </li>
            </ul>
            <div className="d-flex gap-2 ms-lg-2 align-items-center flex-wrap">
              {loggedInUser ? (
                <button type="button" className="kr-logout-btn" onClick={handleLogout}>
                  Logout
                </button>
              ) : (
                <>
                  <Link to="/login" className="kr-nav-login-btn">Login</Link>
                  <Link to="/register" className="kr-nav-signup-btn">Sign Up Free</Link>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* ─────────── Browse hero ─────────── */}
      <header className="kr-browse-hero">
        <div className="kr-browse-hero-bg" aria-hidden="true"></div>
        <div className="container">
          <nav aria-label="breadcrumb" className="kr-browse-crumbs">
            <Link to="/">Home</Link>
            <span aria-hidden="true">›</span>
            <span>Listings</span>
          </nav>
          <h1 className="kr-browse-hero-title">Browse all listings</h1>
          <p className="kr-browse-hero-sub">
            Sponsored properties appear first, followed by everything else. Filter by type,
            location or price to narrow your search.
          </p>
          <div className="kr-browse-hero-meta">
            <span className="kr-browse-hero-pill">
              <span className="kr-browse-hero-dot"></span>
              {loading ? "Loading…" : `${properties.length} total`}
            </span>
            <span className="kr-browse-hero-pill kr-browse-hero-pill-promoted">
              ✦ {loading ? "—" : paidCount} promoted
            </span>
          </div>
        </div>
      </header>

      {/* ─────────── Filters + Results ─────────── */}
      <section className="kr-browse-section">
        <div className="container">
          <div className="kr-filter-card kr-browse-filter-card">
            <div className="kr-filter-row kr-browse-filter-row">
              <div className="kr-filter-group kr-filter-group-wide">
                <label className="kr-filter-label" htmlFor="browseSearch">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                  Search
                </label>
                <input
                  id="browseSearch"
                  type="text"
                  className="kr-filter-input"
                  placeholder="Property name or location…"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                />
              </div>

              <div className="kr-filter-group">
                <label className="kr-filter-label" htmlFor="browseType">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                  Type
                </label>
                <select
                  id="browseType"
                  className="kr-filter-select"
                  value={propertyType}
                  onChange={(e) => {
                    setPropertyType(e.target.value);
                    setCurrentPage(1);
                  }}
                >
                  <option value="all">All Types</option>
                  <option value="rent">Rent</option>
                  <option value="lease">Lease</option>
                </select>
              </div>

              <div className="kr-filter-group">
                <label className="kr-filter-label" htmlFor="browseLocation">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  Location
                </label>
                <select
                  id="browseLocation"
                  className="kr-filter-select"
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                    setCurrentPage(1);
                  }}
                >
                  <option value="all">All Locations</option>
                  {availableLocations.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              <div className="kr-filter-group">
                <label className="kr-filter-label" htmlFor="browseMaxPrice">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  Max Price
                </label>
                <input
                  id="browseMaxPrice"
                  type="number"
                  min="0"
                  className="kr-filter-input"
                  placeholder="KSh — any"
                  value={maxPrice}
                  onChange={(e) => {
                    setMaxPrice(e.target.value);
                    setCurrentPage(1);
                  }}
                />
              </div>

              <div className="kr-filter-group">
                <label className="kr-filter-label" htmlFor="browseSort">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                  Sort
                </label>
                <select
                  id="browseSort"
                  className="kr-filter-select"
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value);
                    setCurrentPage(1);
                  }}
                >
                  <option value="default">Featured first</option>
                  <option value="price-asc">Price: Low → High</option>
                  <option value="price-desc">Price: High → Low</option>
                  <option value="latest">Latest first</option>
                </select>
              </div>

              <div className="kr-filter-group kr-filter-reset">
                <button type="button" className="kr-reset-btn" onClick={clearFilters}>
                  Reset
                </button>
              </div>
            </div>
          </div>

          {loading && (
            <div className="kr-loading-state">
              <div className="kr-loading-spinner"></div>
              <p>Fetching listings…</p>
            </div>
          )}

          {!loading && error && (
            <div className="kr-empty-state">
              <div className="kr-empty-state-icon">⚠️</div>
              <h5 className="fw-bold mb-2">Something went wrong</h5>
              <p className="mb-3">{error}</p>
              <button
                type="button"
                className="kr-reset-btn"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && (
            <>
              <div className="kr-results-bar kr-browse-results-bar">
                <p className="kr-results-count mb-0">
                  Showing <strong>{sortedProperties.length === 0 ? 0 : startIndex}–{endIndex}</strong> of{" "}
                  <strong>{sortedProperties.length}</strong>
                  {sortedProperties.length !== properties.length && (
                    <span className="text-muted"> · filtered from {properties.length}</span>
                  )}
                  {searchTerm && <span className="ms-1">for "<em>{searchTerm}</em>"</span>}
                </p>
                {hasActiveFilters && (
                  <button type="button" className="kr-clear-filters-btn" onClick={clearFilters}>
                    ✕ Clear filters
                  </button>
                )}
              </div>

              {sortedProperties.length === 0 ? (
                <>
                  <div className="kr-empty-state">
                    <div className="kr-empty-state-icon">🔍</div>
                    <h5 className="fw-bold mb-2">No properties match your filters</h5>
                    <p className="mb-3">Try widening the price range or changing the location.</p>
                    <button type="button" className="kr-reset-btn" onClick={clearFilters}>
                      Clear filters
                    </button>
                  </div>

                  {suggestedWhenEmpty.length > 0 && (
                    <section className="kr-similar-section kr-similar-section--browse" aria-labelledby="browseSuggestionsTitle">
                      <div className="kr-similar-header">
                        <div>
                          <p className="kr-similar-eyebrow">While you're here</p>
                          <h3 className="kr-similar-title" id="browseSuggestionsTitle">
                            You might still like these
                          </h3>
                          <p className="kr-similar-sub">
                            {location !== "all"
                              ? `Popular picks near ${location} and beyond.`
                              : "A handful of trending listings across our catalog."}
                          </p>
                        </div>
                      </div>

                      <div className="row g-4">
                        {suggestedWhenEmpty.map((item) => {
                          const features = getPropertyFeatures(item.id);
                          const promoted = isPaidListing(item);
                          const saved = shortlistedLookup.has(item.id);
                          return (
                            <div className="col-md-6 col-lg-4" key={`suggest-${item.id}`}>
                              <div className={`kr-property-card kr-similar-card ${promoted ? "kr-property-card--promoted" : ""}`}>
                                <div
                                  className={`kr-card-image kr-card-image-${item.type} ${
                                    hasCustomImage(item.imageUrl) ? "" : "kr-has-fallback-image"
                                  }`}
                                >
                                  <img
                                    src={resolvePropertyImageUrl(item.imageUrl, item.type)}
                                    alt={item.title}
                                    className="kr-card-image-photo"
                                    loading="lazy"
                                    onError={(event) => {
                                      event.currentTarget.onerror = null;
                                      event.currentTarget.src = getFallbackImage(item.type);
                                      event.currentTarget
                                        .closest(".kr-card-image")
                                        ?.classList.add("kr-has-fallback-image");
                                    }}
                                  />
                                  <span className="kr-fallback-badge">Illustrative image</span>
                                  {promoted && (
                                    <span className="kr-promoted-badge" title="Sponsored listing">
                                      ✦ Promoted
                                    </span>
                                  )}
                                  <PropertyMediaBadge item={item} />
                                  <span className={`kr-card-image-badge kr-badge-${item.type}`}>{item.type}</span>
                                </div>
                                <div className="kr-card-features">
                                  <span className="kr-card-feature">🛏 {features.beds} bed{features.beds > 1 ? "s" : ""}</span>
                                  <span className="kr-card-feature-sep">·</span>
                                  <span className="kr-card-feature">🚿 {features.baths} bath{features.baths > 1 ? "s" : ""}</span>
                                  <span className="kr-card-feature-sep">·</span>
                                  <span className="kr-card-feature">📐 {features.area} m²</span>
                                </div>
                                <div className="kr-card-body">
                                  <h5 className="kr-card-title">{item.title}</h5>
                                  <p className="kr-card-location">📍 {item.location}</p>
                                  <div className="kr-card-price-box">
                                    <p className="kr-card-price-label">Monthly Rate</p>
                                    <p className="kr-card-price">{formatPrice(item.price, item.type)}</p>
                                  </div>
                                  <div className="kr-card-actions">
                                    <button
                                      type="button"
                                      className="kr-card-btn-view"
                                      onClick={() => navigate(`/listings/${item.id}`)}
                                    >
                                      View Details
                                    </button>
                                    <button
                                      type="button"
                                      className={`kr-card-btn-shortlist ${saved ? "active" : ""}`}
                                      onClick={() => toggleShortlist(item.id)}
                                    >
                                      {saved ? "★ Saved" : "☆ Save"}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </>
              ) : (
                <div className="row g-4">
                  {paginatedProperties.map((item) => {
                    const features = getPropertyFeatures(item.id);
                    const promoted = isPaidListing(item);
                    const saved = shortlistedLookup.has(item.id);
                    return (
                      <div className="col-md-6 col-lg-4" key={item.id}>
                        <div className={`kr-property-card ${promoted ? "kr-property-card--promoted" : ""}`}>
                          <div
                            className={`kr-card-image kr-card-image-${item.type} ${
                              hasCustomImage(item.imageUrl) ? "" : "kr-has-fallback-image"
                            }`}
                          >
                            <img
                              src={resolvePropertyImageUrl(item.imageUrl, item.type)}
                              alt={item.title}
                              className="kr-card-image-photo"
                              loading="lazy"
                              onError={(event) => {
                                event.currentTarget.onerror = null;
                                event.currentTarget.src = getFallbackImage(item.type);
                                event.currentTarget
                                  .closest(".kr-card-image")
                                  ?.classList.add("kr-has-fallback-image");
                              }}
                            />
                            <span className="kr-fallback-badge">Illustrative image</span>
                            {promoted && (
                              <span className="kr-promoted-badge" title="Sponsored listing">
                                ✦ Promoted
                              </span>
                            )}
                            <PropertyMediaBadge item={item} />
                            <span className={`kr-card-image-badge kr-badge-${item.type}`}>
                              {item.type}
                            </span>
                            <button
                              type="button"
                              className={`kr-card-shortlist-btn ${saved ? "active" : ""}`}
                              title={saved ? "Remove from shortlist" : "Add to shortlist"}
                              onClick={() => toggleShortlist(item.id)}
                            >
                              {saved ? "★" : "☆"}
                            </button>
                          </div>

                          <div className="kr-card-features">
                            <span className="kr-card-feature">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2 4v16" /><path d="M2 8h18a2 2 0 0 1 2 2v10" /><path d="M2 17h20" /><path d="M6 8v9" />
                              </svg>
                              {features.beds} bed{features.beds > 1 ? "s" : ""}
                            </span>
                            <span className="kr-card-feature-sep">·</span>
                            <span className="kr-card-feature">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 6 6.5 3.5a1.5 1.5 0 0 0-1-.5C4.683 3 4 3.683 4 4.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
                                <line x1="10" y1="5" x2="8" y2="7" />
                              </svg>
                              {features.baths} bath{features.baths > 1 ? "s" : ""}
                            </span>
                            <span className="kr-card-feature-sep">·</span>
                            <span className="kr-card-feature">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                              </svg>
                              {features.area} m²
                            </span>
                          </div>

                          <div className="kr-card-body">
                            <h5 className="kr-card-title">{item.title}</h5>
                            <p className="kr-card-location">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                <circle cx="12" cy="10" r="3" />
                              </svg>
                              {item.location}
                            </p>
                            {item.description && (
                              <p className="kr-card-description">{item.description}</p>
                            )}

                            <div className="kr-card-price-box">
                              <p className="kr-card-price-label">Monthly Rate</p>
                              <p className="kr-card-price">{formatPrice(item.price, item.type)}</p>
                            </div>

                            <div className="kr-card-actions">
                              <button
                                type="button"
                                className="kr-card-btn-view"
                                onClick={() => navigate(`/listings/${item.id}`)}
                              >
                                View Details
                              </button>
                              <button
                                type="button"
                                className={`kr-card-btn-shortlist ${saved ? "active" : ""}`}
                                onClick={() => toggleShortlist(item.id)}
                              >
                                {saved ? "★ Saved" : "☆ Save"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {sortedProperties.length > 0 && totalPages > 1 && (
                <nav aria-label="Listings pagination" className="kr-pagination-wrapper">
                  <ul className="pagination mb-0">
                    <li className={`page-item ${currentPage === 1 ? "disabled" : ""}`}>
                      <button
                        type="button"
                        className="page-link kr-page-btn"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      >
                        ‹ Prev
                      </button>
                    </li>
                    {pageNumbers.map((n, idx) => {
                      const prev = pageNumbers[idx - 1];
                      const showGap = prev && n - prev > 1;
                      return (
                        <Fragment key={n}>
                          {showGap && (
                            <li className="page-item disabled" aria-hidden="true">
                              <span className="page-link kr-page-btn">…</span>
                            </li>
                          )}
                          <li className={`page-item ${currentPage === n ? "active" : ""}`}>
                            <button
                              type="button"
                              className="page-link kr-page-btn"
                              onClick={() => setCurrentPage(n)}
                            >
                              {n}
                            </button>
                          </li>
                        </Fragment>
                      );
                    })}
                    <li className={`page-item ${currentPage === totalPages ? "disabled" : ""}`}>
                      <button
                        type="button"
                        className="page-link kr-page-btn"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      >
                        Next ›
                      </button>
                    </li>
                  </ul>
                </nav>
              )}
            </>
          )}
        </div>
      </section>

      {/* ─────────── Footer (compact) ─────────── */}
      <footer className="kr-footer kr-browse-footer">
        <div className="container">
          <div className="kr-footer-bottom">
            <small>© {new Date().getFullYear()} KenReal Estates. All rights reserved.</small>
            <div className="kr-footer-bottom-links">
              <Link to="/">Home</Link>
              <a href="/#why-us">Why KenReal</a>
              <a href="/#contact">Contact</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default BrowseListingsPage;
