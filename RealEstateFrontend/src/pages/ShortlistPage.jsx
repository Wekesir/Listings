import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PortalLayout from "../components/PortalLayout";
import { useShortlist } from "../hooks/useShortlist";
import { getProperties, getPropertiesForAdmin } from "../services/propertyService";
import { notify } from "../utils/notify";
import { getStoredUser } from "../utils/session";
import {
  getFallbackImage,
  hasCustomImage,
  resolvePropertyImageUrl
} from "../utils/propertyMedia";
import PropertyMediaBadge from "../components/PropertyMediaBadge";

function formatPrice(price, type) {
  const value = Number(price);
  if (Number.isNaN(value)) return "Price on request";
  const suffix = type === "lease" ? "/mo · Lease" : "/mo · Rent";
  return `KSh ${value.toLocaleString("en-KE")} ${suffix}`;
}

function getNumericPrice(price) {
  const value = Number(price);
  return Number.isFinite(value) ? value : null;
}

function getBedroomCount(item) {
  const title = String(item?.title || "").toLowerCase();
  if (title.includes("studio") || title.includes("bedsitter")) return 0;
  const match = title.match(/(\d+)\s*bed/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function buildRecommendationPool(shortlisted, allProperties, maxCount = 5) {
  if (shortlisted.length === 0 || allProperties.length === 0) return [];

  const shortlistedIdSet = new Set(shortlisted.map((item) => Number(item.id)));
  const preferredLocations = new Set(shortlisted.map((item) => normalizeText(item.location)).filter(Boolean));
  const preferredTypes = new Set(shortlisted.map((item) => normalizeText(item.type)).filter(Boolean));
  const preferredBedrooms = new Set(
    shortlisted
      .map((item) => getBedroomCount(item))
      .filter((value) => value !== null)
      .map((value) => Number(value))
  );
  const targetPrice = median(
    shortlisted
      .map((item) => getNumericPrice(item.price))
      .filter((value) => value !== null)
  );

  const candidates = allProperties
    .filter((item) => !shortlistedIdSet.has(Number(item.id)))
    .map((item) => {
      const location = normalizeText(item.location);
      const type = normalizeText(item.type);
      const bedrooms = getBedroomCount(item);
      const price = getNumericPrice(item.price);
      const hasLocationMatch = preferredLocations.has(location);
      const hasTypeMatch = preferredTypes.has(type);
      const hasBedroomMatch = bedrooms !== null && preferredBedrooms.has(Number(bedrooms));
      const priceDelta = Number.isFinite(targetPrice) && Number.isFinite(price)
        ? Math.abs(price - targetPrice)
        : Number.MAX_SAFE_INTEGER;

      let score = 0;
      if (hasLocationMatch) score += 6;
      if (hasTypeMatch) score += 3;
      if (hasBedroomMatch) score += 2;
      if (Number.isFinite(priceDelta) && priceDelta <= (targetPrice || 0) * 0.25) score += 1;

      return {
        item,
        score,
        priceDelta
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.priceDelta - b.priceDelta;
    })
    .slice(0, maxCount)
    .map((entry) => entry.item);

  return candidates;
}

function ShortlistPage() {
  const navigate = useNavigate();
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.accountType === "admin";
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const { shortlistedIds, shortlistedLookup, toggleShortlist } = useShortlist();

  useEffect(() => {
    const loadProperties = async () => {
      setLoading(true);
      try {
        const data = isAdmin
          ? await getPropertiesForAdmin(true)
          : await getProperties();
        setProperties(Array.isArray(data) ? data : []);
      } catch (_error) {
        notify("Unable to load listings right now.", "warning");
        setProperties([]);
      } finally {
        setLoading(false);
      }
    };
    void loadProperties();
  }, [isAdmin]);

  const shortlistedProperties = useMemo(() => {
    if (!Array.isArray(properties) || properties.length === 0) return [];
    const shortlistSet = new Set(shortlistedIds.map((id) => Number(id)));
    return properties.filter((item) => shortlistSet.has(Number(item.id)));
  }, [properties, shortlistedIds]);

  const suggestedProperties = useMemo(() => {
    return buildRecommendationPool(shortlistedProperties, properties, 5);
  }, [shortlistedProperties, properties]);

  const shortlistLocationHint = useMemo(() => {
    const locations = [...new Set(shortlistedProperties.map((item) => item.location).filter(Boolean))];
    if (locations.length === 0) return "";
    if (locations.length === 1) return `Based on your shortlist in ${locations[0]}`;
    return `Based on your shortlist across ${locations.length} locations`;
  }, [shortlistedProperties]);

  const renderPropertyCard = (item, { showRemoveAction = false } = {}) => {
    const isShortlisted = shortlistedLookup.has(item.id);
    const customImage = hasCustomImage(item.imageUrl);
    const isSoftDeleted = Boolean(item.isSoftDeleted);

    return (
      <div className="col-md-6 col-xl-4" key={item.id}>
        <div
          className={`kr-portal-listing-card${isSoftDeleted ? " kr-portal-listing-card--soft-deleted" : ""}`}
          onClick={() => navigate(`/listings/${item.id}`)}
          style={{ cursor: "pointer" }}
        >
          <div className={`kr-portal-listing-media kr-portal-listing-media-${item.type}${customImage ? "" : " kr-has-fallback-image"}`}>
            <img
              src={resolvePropertyImageUrl(item.imageUrl, item.type)}
              alt={item.title}
              className="kr-portal-listing-image"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = getFallbackImage(item.type);
                e.currentTarget
                  .closest(".kr-portal-listing-media")
                  ?.classList.add("kr-has-fallback-image");
              }}
            />
            <span className="kr-fallback-badge">Illustrative image</span>
            <PropertyMediaBadge item={item} />
            <span className={`kr-listing-type-badge kr-listing-type-badge--${item.type}`}>
              {item.type}
            </span>
            {isSoftDeleted && (
              <span className="kr-listing-soft-delete-badge">Soft deleted</span>
            )}
            <button
              type="button"
              className={`kr-portal-star-btn${isShortlisted ? " active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleShortlist(item.id);
              }}
              aria-label={isShortlisted ? "Remove from shortlist" : "Add to shortlist"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={isShortlisted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </button>
          </div>

          <div className="kr-portal-listing-body">
            <h3 className="kr-portal-listing-title">{item.title}</h3>
            <p className="kr-portal-listing-location">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px", flexShrink: 0 }}>
                <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              {item.location}
            </p>
            {item.description && <p className="kr-portal-listing-desc">{item.description}</p>}
            <p className="kr-portal-listing-price">{formatPrice(item.price, item.type)}</p>
            {showRemoveAction && (
              <button
                type="button"
                className="kr-remove-shortlist-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  void toggleShortlist(item.id);
                }}
              >
                Remove from shortlist
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <PortalLayout
      title="My Shortlist"
      subtitle="Review saved listings and discover similar properties you may like."
    >
      <div className="kr-shortlist-toolbar">
        <div className="kr-shortlist-metrics">
          <span className="kr-shortlist-metric">
            <strong>{shortlistedProperties.length}</strong> saved
          </span>
          <span className="kr-shortlist-metric">
            <strong>{suggestedProperties.length}</strong> suggested
          </span>
        </div>
        <button
          type="button"
          className="kr-shortlist-browse-btn"
          onClick={() => navigate("/listings")}
        >
          Browse all listings
        </button>
      </div>

      {loading ? (
        <div className="kr-portal-state">
          <span className="kr-portal-state-spinner"></span>
          <span>Loading your shortlist…</span>
        </div>
      ) : shortlistedProperties.length === 0 ? (
        <div className="kr-portal-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.35, marginBottom: "10px" }}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          <p style={{ margin: 0 }}>You have not shortlisted any listings yet.</p>
          <button type="button" className="kr-shortlist-browse-btn" onClick={() => navigate("/listings")}>
            Explore listings
          </button>
        </div>
      ) : (
        <>
          <section className="kr-shortlist-section">
            <div className="kr-shortlist-section-head">
              <h3 className="kr-shortlist-section-title">Saved listings</h3>
              <p className="kr-shortlist-section-sub">Properties you marked for quick access.</p>
            </div>
            <div className="row g-4">
              {shortlistedProperties.map((item) => renderPropertyCard(item, { showRemoveAction: true }))}
            </div>
          </section>

          <section className="kr-shortlist-section">
            <div className="kr-shortlist-section-head">
              <h3 className="kr-shortlist-section-title">Suggested for you</h3>
              <p className="kr-shortlist-section-sub">
                {shortlistLocationHint || "Similar listings based on your shortlist preferences"}
              </p>
            </div>
            {suggestedProperties.length === 0 ? (
              <div className="kr-shortlist-empty-suggestions">
                Add more listings to your shortlist to improve recommendations.
              </div>
            ) : (
              <div className="row g-4">
                {suggestedProperties.map((item) => renderPropertyCard(item))}
              </div>
            )}
          </section>
        </>
      )}
    </PortalLayout>
  );
}

export default ShortlistPage;
