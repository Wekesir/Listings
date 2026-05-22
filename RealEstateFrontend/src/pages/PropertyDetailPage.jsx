import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import PortalLayout from "../components/PortalLayout";
import {
  getProperties,
  getPropertyById,
  restoreSoftDeletedListing,
  softDeleteListing,
  submitListingReport
} from "../services/propertyService";
import { notify } from "../utils/notify";
import { useShortlist } from "../hooks/useShortlist";
import { getFallbackImage, hasCustomImage, resolvePropertyImageUrl } from "../utils/propertyMedia";
import PropertyMediaBadge from "../components/PropertyMediaBadge";
import { createListingInquiry } from "../services/messageService";
import { getStoredBrowseFilters } from "../utils/recommendationFilters";
import { getStoredUser } from "../utils/session";

/* ── Helpers ── */
function formatPrice(price, type) {
  const value = Number(price);
  if (Number.isNaN(value)) return "Price on request";
  return `KSh ${value.toLocaleString("en-KE")} / mo · ${type === "lease" ? "Lease" : "Rent"}`;
}

function extractCity(location) {
  const raw = String(location || "").trim();
  if (!raw) return "";
  return (raw.split(",")[0] || raw).trim();
}

function getCardFeatures(id) {
  const n = Number(id) || 0;
  const beds = (n % 4) + 1;
  const baths = beds > 2 ? 2 : 1;
  const area = 40 + (n * 17) % 120;
  return { beds, baths, area };
}

function formatCardPrice(price, type) {
  const value = Number(price);
  if (Number.isNaN(value)) return "Price on request";
  const suffix = type === "lease" ? "/ mo (lease)" : "/ mo (rent)";
  return `KSh ${value.toLocaleString("en-KE")} ${suffix}`;
}

function deriveFeatures(property) {
  const features = [];
  const t = (property.title || "").toLowerCase();

  if (t.includes("studio") || t.includes("bedsitter")) {
    features.push({ label: "Bedrooms", value: "Studio" });
    features.push({ label: "Bathrooms", value: "1" });
  } else {
    const m = t.match(/(\d+)\s*bed/);
    if (m) {
      features.push({ label: "Bedrooms", value: m[1] });
      features.push({ label: "Bathrooms", value: String(Math.max(1, Number(m[1]) - 1)) });
    }
  }

  features.push({ label: "Category", value: property.type === "lease" ? "Commercial" : "Residential" });

  if (t.includes("villa") || t.includes("townhouse")) {
    features.push({ label: "Parking", value: "2 bays" });
    features.push({ label: "Garden", value: "Yes" });
  } else if (t.includes("office") || t.includes("warehouse") || t.includes("retail")) {
    features.push({ label: "Parking", value: "Available" });
  } else {
    features.push({ label: "Parking", value: "1 bay" });
  }

  features.push({ label: "Lease term", value: property.type === "lease" ? "Annual" : "Monthly" });
  return features;
}

function getBedroomCountFromListing(item) {
  const title = String(item?.title || "").toLowerCase();
  if (title.includes("studio") || title.includes("bedsitter")) return 0;
  const match = title.match(/(\d+)\s*bed/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function getParkingLevel(item) {
  const text = `${item?.title || ""} ${item?.description || ""}`.toLowerCase();
  const numericMatch = text.match(/(\d+)\s*(?:bay|bays|car|cars|parking)/);
  if (numericMatch) {
    const parsed = Number(numericMatch[1]);
    if (Number.isFinite(parsed) && parsed >= 2) return 2;
    if (Number.isFinite(parsed) && parsed >= 1) return 1;
  }
  if (/(ample parking|spacious parking|multi-?car|2 bays|3 bays|4 bays)/.test(text)) return 2;
  if (/(parking|car park|parking available|secure parking)/.test(text)) return 1;
  return 0;
}

/* ── SVG icons ── */
const Icons = {
  ZoomIn: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  ),
  ZoomOut: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  ),
  Reset: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
    </svg>
  ),
  Share: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  ),
  Download: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  Play: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  ),
  Back: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  ),
  Pin: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  Star: ({ filled }) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  Flag: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
      <line x1="4" y1="22" x2="4" y2="15"/>
    </svg>
  ),
  User: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  Mail: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  ),
  Shield: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
};

const REPORT_REASON_OPTIONS = [
  { value: "false_pricing",                icon: "💰", label: "False or misleading pricing" },
  { value: "misleading_media",             icon: "📷", label: "Misleading photos or description" },
  { value: "unavailable_or_duplicate",     icon: "🔁", label: "Already let, unavailable, or duplicate" },
  { value: "spam_or_scam",                 icon: "⚠️",  label: "Spam, scam, or suspected fraud" },
  { value: "inappropriate_content",        icon: "🚫", label: "Inappropriate or offensive content" },
  { value: "harassment_or_discrimination", icon: "🛑", label: "Harassment or discrimination" },
  { value: "other",                        icon: "✏️",  label: "Other — I'll describe below" }
];

/* ── Media viewer sub-component (images + videos) ── */
function MediaViewer({
  media,
  selectedIndex,
  onSelect,
  title,
  isCustomImage,
  onImgError,
  showSoftDeletedOverlay = false
}) {
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // lightboxIndex is the index being shown inside the lightbox (may differ from
  // the main stage selectedIndex until the user closes the lightbox).
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [imgLoading, setImgLoading] = useState(true);
  const dragRef = useRef(null);
  const stageRef = useRef(null);
  const lastTouchDist = useRef(null);
  const stripRef = useRef(null);
  const lbStripRef = useRef(null);

  const safeMedia = media.length > 0 ? media : [];
  const current = safeMedia[selectedIndex] || safeMedia[0];
  const isVideo = current?.type === "video";
  const imageCount = safeMedia.filter((m) => m.type === "image").length;
  const videoCount = safeMedia.filter((m) => m.type === "video").length;
  const totalMedia = safeMedia.length;
  const hasMultiple = totalMedia > 1;

  const lbCurrent = safeMedia[lightboxIndex] || safeMedia[0];
  const lbIsVideo = lbCurrent?.type === "video";

  const goPrev = useCallback(() => {
    if (!hasMultiple) return;
    onSelect((selectedIndex - 1 + totalMedia) % totalMedia);
  }, [hasMultiple, onSelect, selectedIndex, totalMedia]);

  const goNext = useCallback(() => {
    if (!hasMultiple) return;
    onSelect((selectedIndex + 1) % totalMedia);
  }, [hasMultiple, onSelect, selectedIndex, totalMedia]);

  const lbGoPrev = useCallback(() => {
    setLightboxIndex((i) => (i - 1 + totalMedia) % totalMedia);
  }, [totalMedia]);
  const lbGoNext = useCallback(() => {
    setLightboxIndex((i) => (i + 1) % totalMedia);
  }, [totalMedia]);

  // Open lightbox at current stage index
  const openLightbox = useCallback(() => {
    setLightboxIndex(selectedIndex);
    setLightboxOpen(true);
  }, [selectedIndex]);

  // Reset image-loading indicator on media change
  useEffect(() => { setImgLoading(true); }, [selectedIndex]);

  // Arrow-key nav on the main stage (disabled when lightbox is open)
  useEffect(() => {
    if (!hasMultiple || lightboxOpen) return undefined;
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.target?.isContentEditable) return;
      if (e.key === "ArrowLeft")  { e.preventDefault(); goPrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext, hasMultiple, lightboxOpen]);

  // Zoom helpers
  const zoomIn = useCallback(() => setZoom((z) => Math.min(+(z + 0.3).toFixed(2), 4)), []);
  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const next = Math.max(+(z - 0.3).toFixed(2), 1);
      if (next <= 1) { setPanX(0); setPanY(0); }
      return next;
    });
  }, []);
  const resetZoom = useCallback(() => { setZoom(1); setPanX(0); setPanY(0); }, []);

  // Reset zoom on media change
  useEffect(() => { setZoom(1); setPanX(0); setPanY(0); }, [selectedIndex]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || isVideo) return undefined;
    const onWheel = (e) => { e.preventDefault(); e.deltaY < 0 ? zoomIn() : zoomOut(); };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomIn, zoomOut, isVideo]);

  // Lightbox: lock scroll, keyboard nav
  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") { setLightboxOpen(false); }
      if (e.key === "ArrowLeft")  { e.preventDefault(); lbGoPrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); lbGoNext(); }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [lightboxOpen, lbGoPrev, lbGoNext]);

  // Auto-scroll the thumbnail strip so the active thumb is always visible
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.children[selectedIndex];
    if (active) active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [selectedIndex]);

  useEffect(() => {
    const strip = lbStripRef.current;
    if (!strip) return;
    const active = strip.children[lightboxIndex];
    if (active) active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [lightboxIndex]);

  // Pan handlers
  const handleMouseDown = (e) => {
    if (isVideo || zoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, originPanX: panX, originPanY: panY };
  };
  const handleMouseMove = (e) => {
    if (!isDragging || !dragRef.current) return;
    setPanX(dragRef.current.originPanX + (e.clientX - dragRef.current.startX) / zoom);
    setPanY(dragRef.current.originPanY + (e.clientY - dragRef.current.startY) / zoom);
  };
  const stopDrag = () => { setIsDragging(false); dragRef.current = null; };

  const handleTouchStart = (e) => {
    if (isVideo) return;
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist.current = Math.hypot(dx, dy);
    }
  };
  const handleTouchMove = (e) => {
    if (isVideo || e.touches.length !== 2 || !lastTouchDist.current) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    setZoom((z) => Math.min(Math.max(+(z + (dist - lastTouchDist.current) * 0.01).toFixed(2), 1), 4));
    lastTouchDist.current = dist;
  };

  const handleDownload = (url, type) => {
    if (!url) return;
    const ext = type === "video" ? "mp4" : "jpg";
    const filename = `${title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.${ext}`;
    fetch(url)
      .then((r) => r.blob())
      .then((blob) => {
        const a = Object.assign(document.createElement("a"), {
          href: URL.createObjectURL(blob), download: filename,
        });
        a.click();
        URL.revokeObjectURL(a.href);
        notify(`${type === "video" ? "Video" : "Image"} download started.`, "success");
      })
      .catch(() => {
        Object.assign(document.createElement("a"), {
          href: url, download: filename, target: "_blank", rel: "noopener",
        }).click();
        notify(`Opening in a new tab.`, "info");
      });
  };

  const handleShare = async () => {
    const shareUrl = window.location.href;
    const text = `Check out this property on KenReal Estates: ${title}`;
    if (navigator.share) {
      try { await navigator.share({ title, text, url: shareUrl }); } catch { /* cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        notify("URL copied to clipboard!", "success");
      } catch {
        notify("Could not copy the URL.", "warning");
      }
    }
  };

  if (!current) {
    return (
      <div className="kr-gal">
        <div className="kr-gal-stage">
          <p style={{ color: "rgba(255,255,255,0.5)", margin: 0 }}>No media to display.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="kr-gal">

      {/* ── Main stage ── */}
      <div
        ref={stageRef}
        className={`kr-gal-stage${zoom > 1 ? " zoomed" : ""}${isDragging ? " dragging" : ""}${isVideo ? " is-video" : ""}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        {/* Gradient vignette for text legibility */}
        <div className="kr-gal-vignette" />

        {showSoftDeletedOverlay && (
          <div className="kr-detail-soft-delete-overlay">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            This listing is soft deleted
          </div>
        )}

        {/* Loading shimmer */}
        {imgLoading && !isVideo && <div className="kr-gal-shimmer" />}

        {isVideo ? (
          <video
            key={current.url}
            src={current.url}
            controls
            playsInline
            className="kr-gal-video"
            poster={current.poster || undefined}
          >
            Your browser does not support video.
          </video>
        ) : (
          <img
            key={current.url}
            src={current.url}
            alt={title}
            className="kr-gal-img"
            draggable={false}
            onLoad={() => setImgLoading(false)}
            onError={() => { setImgLoading(false); onImgError(); }}
            style={{ transform: `scale(${zoom}) translate(${panX}px, ${panY}px)` }}
          />
        )}

        {/* Top-left badges */}
        <div className="kr-gal-top-left">
          {!isCustomImage && !isVideo && (
            <span className="kr-gal-badge kr-gal-badge--illustrative">Illustrative</span>
          )}
          {isVideo && (
            <span className="kr-gal-badge kr-gal-badge--video">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              Video tour
            </span>
          )}
        </div>

        {/* Top-right: zoom controls + share */}
        {!isVideo && (
          <div className="kr-gal-top-right">
            <button type="button" className="kr-gal-ctrl-btn" onClick={zoomOut} disabled={zoom <= 1} title="Zoom out" aria-label="Zoom out">
              <Icons.ZoomOut />
            </button>
            <span className="kr-gal-zoom-pct">{Math.round(zoom * 100)}%</span>
            <button type="button" className="kr-gal-ctrl-btn" onClick={zoomIn} disabled={zoom >= 4} title="Zoom in" aria-label="Zoom in">
              <Icons.ZoomIn />
            </button>
            <button type="button" className="kr-gal-ctrl-btn" onClick={resetZoom} disabled={zoom === 1} title="Reset zoom" aria-label="Reset zoom">
              <Icons.Reset />
            </button>
          </div>
        )}

        {/* Prev / next arrows */}
        {hasMultiple && (
          <>
            <button type="button" className="kr-gal-arrow kr-gal-arrow--prev" onClick={goPrev} aria-label="Previous">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button type="button" className="kr-gal-arrow kr-gal-arrow--next" onClick={goNext} aria-label="Next">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </>
        )}

        {/* Bottom bar: counter + "View all" + action btns */}
        <div className="kr-gal-bottom-bar">
          {hasMultiple && (
            <span className="kr-gal-counter" aria-live="polite">
              {selectedIndex + 1} <span className="kr-gal-counter-sep">of</span> {totalMedia}
            </span>
          )}
          <div className="kr-gal-bottom-actions">
            <button type="button" className="kr-gal-action" onClick={handleShare} title="Share">
              <Icons.Share />
              <span>Share</span>
            </button>
            <button type="button" className="kr-gal-action" onClick={() => handleDownload(current.url, current.type)} title="Download">
              <Icons.Download />
              <span>Download</span>
            </button>
            {hasMultiple && (
              <button type="button" className="kr-gal-view-all" onClick={openLightbox}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                View all photos
                <span className="kr-gal-view-all-count">{totalMedia}</span>
              </button>
            )}
          </div>
          {!isVideo && (
            <p className="kr-gal-hint">Scroll to zoom · Drag to pan</p>
          )}
        </div>
      </div>

      {/* ── Thumbnail panel (vertical, scrollable) ── */}
      {hasMultiple && (
        <div className="kr-gal-panel">
          <div className="kr-gal-panel-header">
            <span className="kr-gal-panel-count">
              {imageCount} {imageCount === 1 ? "photo" : "photos"}
              {videoCount > 0 && ` · ${videoCount} ${videoCount === 1 ? "video" : "videos"}`}
            </span>
            <span className="kr-gal-panel-hint">Click to view</span>
          </div>
          <div className="kr-gal-panel-list" ref={stripRef}>
            {safeMedia.map((item, index) => {
              const label = item.type === "video" ? "Video tour" : `Photo ${index + 1}`;
              return (
                <button
                  key={`${item.url}-${index}`}
                  type="button"
                  className={`kr-gal-panel-item${index === selectedIndex ? " active" : ""}${item.type === "video" ? " is-video" : ""}`}
                  onClick={() => onSelect(index)}
                  aria-label={label}
                  aria-current={index === selectedIndex ? "true" : undefined}
                >
                  <div className="kr-gal-panel-preview">
                    {item.type === "video" ? (
                      <>
                        <video src={item.url} className="kr-gal-panel-media" muted playsInline preload="metadata" />
                        <span className="kr-gal-panel-play">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </span>
                      </>
                    ) : (
                      <img src={item.url} alt={label} className="kr-gal-panel-media" loading="lazy" />
                    )}
                  </div>
                  <div className="kr-gal-panel-meta">
                    <span className="kr-gal-panel-label">
                      {item.type === "video" ? (
                        <>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: "0.25rem" }} aria-hidden="true">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          Video tour
                        </>
                      ) : (
                        label
                      )}
                    </span>
                    {index === selectedIndex && (
                      <span className="kr-gal-panel-active-tag">Viewing</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Lightbox: full-screen viewer ── */}
      {lightboxOpen && (
        <div
          className="kr-lb"
          role="dialog"
          aria-modal="true"
          aria-label={`Gallery for ${title}`}
          onClick={() => setLightboxOpen(false)}
        >
          <div className="kr-lb-inner" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="kr-lb-header">
              <div className="kr-lb-header-left">
                <h4 className="kr-lb-title">{title}</h4>
                <p className="kr-lb-sub">
                  {imageCount} {imageCount === 1 ? "photo" : "photos"}
                  {videoCount > 0 && ` · ${videoCount} ${videoCount === 1 ? "video" : "videos"}`}
                </p>
              </div>
              <div className="kr-lb-header-right">
                <button type="button" className="kr-lb-icon-btn" onClick={() => handleDownload(lbCurrent.url, lbCurrent.type)} title="Download" aria-label="Download current media">
                  <Icons.Download />
                </button>
                <button type="button" className="kr-lb-icon-btn" onClick={handleShare} title="Share" aria-label="Share listing">
                  <Icons.Share />
                </button>
                <button type="button" className="kr-lb-close" onClick={() => setLightboxOpen(false)} aria-label="Close gallery">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Stage area */}
            <div className="kr-lb-stage-wrap">
              {totalMedia > 1 && (
                <button type="button" className="kr-lb-nav kr-lb-nav--prev" onClick={lbGoPrev} aria-label="Previous">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              )}

              <div className="kr-lb-stage">
                {lbIsVideo ? (
                  <video
                    key={lbCurrent.url}
                    src={lbCurrent.url}
                    controls
                    playsInline
                    className="kr-lb-video"
                  >
                    Your browser does not support video.
                  </video>
                ) : (
                  <img
                    key={lbCurrent.url}
                    src={lbCurrent.url}
                    alt={`${title} — ${lightboxIndex + 1} of ${totalMedia}`}
                    className="kr-lb-img"
                    draggable={false}
                  />
                )}
                {totalMedia > 1 && (
                  <span className="kr-lb-counter">
                    {lightboxIndex + 1} <span style={{ opacity: 0.55 }}>/ {totalMedia}</span>
                  </span>
                )}
              </div>

              {totalMedia > 1 && (
                <button type="button" className="kr-lb-nav kr-lb-nav--next" onClick={lbGoNext} aria-label="Next">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}
            </div>

            {/* Filmstrip */}
            {hasMultiple && (
              <div className="kr-lb-filmstrip-wrap">
                <div className="kr-lb-filmstrip" ref={lbStripRef}>
                  {safeMedia.map((item, index) => (
                    <button
                      key={`lb-${item.url}-${index}`}
                      type="button"
                      className={`kr-lb-film-thumb${index === lightboxIndex ? " active" : ""}${item.type === "video" ? " is-video" : ""}`}
                      onClick={() => setLightboxIndex(index)}
                      aria-label={item.type === "video" ? "Video" : `Photo ${index + 1}`}
                      aria-current={index === lightboxIndex ? "true" : undefined}
                    >
                      {item.type === "video" ? (
                        <>
                          <video src={item.url} className="kr-lb-film-media" muted playsInline preload="metadata" />
                          <span className="kr-lb-film-play">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                          </span>
                        </>
                      ) : (
                        <img src={item.url} alt={`Thumb ${index + 1}`} className="kr-lb-film-media" loading="lazy" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Confirm selection → jump main stage */}
            <div className="kr-lb-footer">
              <p className="kr-lb-kbd-hint">← → to navigate &nbsp;·&nbsp; Esc to close</p>
              <button
                type="button"
                className="kr-lb-select-btn"
                onClick={() => { onSelect(lightboxIndex); setLightboxOpen(false); }}
              >
                View this {lbIsVideo ? "video" : "photo"} →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main page ── */
function PropertyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.accountType === "admin";
  const { shortlistedLookup, toggleShortlist } = useShortlist();
  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allProperties, setAllProperties] = useState([]);
  const [imgError, setImgError] = useState(false);
  // Initial selected index comes from ?media=N (1-based in URL → 0-based internally).
  const initialMediaIndex = (() => {
    const raw = Number(searchParams.get("media"));
    return Number.isFinite(raw) && raw >= 1 ? raw - 1 : 0;
  })();
  const [selectedImageIndex, setSelectedImageIndex] = useState(initialMediaIndex);
  const [isModerating, setIsModerating] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("false_pricing");
  const [reportCustom, setReportCustom] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  // Guest-mode gate: "choice" shows sign-in vs email options; "email" shows
  // the email input alongside the normal reason picker.
  const [guestStage, setGuestStage] = useState("choice");
  const [reportEmail, setReportEmail] = useState("");
  const [inquiryMessage, setInquiryMessage] = useState("");
  const [inquirySubmitting, setInquirySubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    setImgError(false);
    // Keep index from URL when arriving on this id; reset otherwise.
    const raw = Number(searchParams.get("media"));
    setSelectedImageIndex(Number.isFinite(raw) && raw >= 1 ? raw - 1 : 0);
    getPropertyById(id)
      .then(setProperty)
      .catch(() => {
        notify("Property not found.", "warning");
        navigate("/browse", { replace: true });
      })
      .finally(() => setLoading(false));
    // Intentionally exclude searchParams from deps — we only read it on id change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate]);

  useEffect(() => {
    let cancelled = false;
    getProperties()
      .then((data) => {
        if (!cancelled) setAllProperties(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        // Silent — similar-properties strip is purely additive.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mirror the selected media index to the URL (`?media=N`, 1-based) so
  // users can share deep links to a specific photo/video.
  useEffect(() => {
    if (!property) return;
    const next = new URLSearchParams(searchParams);
    if (selectedImageIndex > 0) {
      next.set("media", String(selectedImageIndex + 1));
    } else {
      next.delete("media");
    }
    const currentQuery = searchParams.toString();
    const nextQuery = next.toString();
    if (currentQuery !== nextQuery) {
      setSearchParams(next, { replace: true });
    }
    // Only react to changes in the selected index and the resolved property id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImageIndex, property?.id]);

  const similarProperties = useMemo(() => {
    if (!property || allProperties.length === 0) return [];

    const browseFilters = getStoredBrowseFilters();
    const maxPriceRaw = String(browseFilters?.maxPrice || "").trim();
    const activeBrowseFilters = {
      searchTerm: String(browseFilters?.searchTerm || "").trim().toLowerCase(),
      propertyType: String(browseFilters?.propertyType || "all").toLowerCase(),
      location: String(browseFilters?.location || "all").trim().toLowerCase(),
      maxPrice: /^\d+$/.test(maxPriceRaw) ? Number(maxPriceRaw) : null
    };
    const hasUserDefinedFilters =
      activeBrowseFilters.searchTerm.length > 0 ||
      activeBrowseFilters.propertyType !== "all" ||
      (activeBrowseFilters.location !== "" && activeBrowseFilters.location !== "all") ||
      Number.isFinite(activeBrowseFilters.maxPrice);

    const currentId = Number(property.id);
    const currentCity = extractCity(property.location).toLowerCase();
    const currentType = String(property.type || "").toLowerCase();
    const currentPrice = Number(property.price);
    const currentBedrooms = getBedroomCountFromListing(property);
    const currentParkingLevel = getParkingLevel(property);

    const scored = allProperties
      .filter((item) => {
        if (!item || Number(item.id) === currentId) return false;
        if (item.isSoftDeleted) return false;
        return true;
      })
      .map((item) => {
        const itemCity = extractCity(item.location).toLowerCase();
        const itemType = String(item.type || "").toLowerCase();
        const itemPrice = Number(item.price);
        const itemBedrooms = getBedroomCountFromListing(item);
        const itemParkingLevel = getParkingLevel(item);
        const sameCity = currentCity && itemCity === currentCity;
        let score = 0;

        if (hasUserDefinedFilters) {
          const listingText = `${item.title || ""} ${item.location || ""} ${item.description || ""}`.toLowerCase();

          if (
            activeBrowseFilters.location &&
            activeBrowseFilters.location !== "all" &&
            listingText.includes(activeBrowseFilters.location)
          ) {
            score += 12;
          }

          if (
            activeBrowseFilters.propertyType !== "all" &&
            activeBrowseFilters.propertyType === itemType
          ) {
            score += 9;
          }

          if (Number.isFinite(activeBrowseFilters.maxPrice) && activeBrowseFilters.maxPrice > 0) {
            if (Number.isFinite(itemPrice) && itemPrice <= activeBrowseFilters.maxPrice) {
              score += 8;
            } else {
              const overflowRatio = Number.isFinite(itemPrice)
                ? (itemPrice - activeBrowseFilters.maxPrice) / activeBrowseFilters.maxPrice
                : 1;
              if (overflowRatio <= 0.2) score += 3;
            }
          }

          if (activeBrowseFilters.searchTerm) {
            const terms = activeBrowseFilters.searchTerm.split(/\s+/).filter(Boolean);
            const termMatches = terms.reduce(
              (total, term) => (listingText.includes(term) ? total + 1 : total),
              0
            );
            score += Math.min(8, termMatches * 3);
          }

          if (sameCity) score += 2;
        } else {
          const sameType = currentType && itemType === currentType;
          const priceDelta =
            Number.isFinite(currentPrice) && Number.isFinite(itemPrice) && currentPrice > 0
              ? Math.abs(itemPrice - currentPrice) / currentPrice
              : 1;
          const priceBonus =
            priceDelta <= 0.1 ? 8 :
            priceDelta <= 0.2 ? 6 :
            priceDelta <= 0.35 ? 4 :
            priceDelta <= 0.5 ? 2 : 0;

          let roomsBonus = 0;
          if (Number.isFinite(currentBedrooms) && Number.isFinite(itemBedrooms)) {
            const roomGap = Math.abs(itemBedrooms - currentBedrooms);
            roomsBonus = roomGap === 0 ? 6 : roomGap === 1 ? 3 : 0;
          }

          const parkingGap = Math.abs(itemParkingLevel - currentParkingLevel);
          const parkingBonus = parkingGap === 0 ? 4 : parkingGap === 1 ? 2 : 0;

          score += (sameCity ? 12 : 0) + (sameType ? 8 : 0) + priceBonus + roomsBonus + parkingBonus;
        }

        const promotedBonus = String(item.paymentStatus || "").toLowerCase() === "paid" ? 0.5 : 0;
        score += promotedBonus;
        return { item, score, sameCity };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        const aPaid = String(a.item.paymentStatus || "").toLowerCase() === "paid" ? 1 : 0;
        const bPaid = String(b.item.paymentStatus || "").toLowerCase() === "paid" ? 1 : 0;
        if (bPaid !== aPaid) return bPaid - aPaid;
        if (b.score !== a.score) return b.score - a.score;
        return Number(b.item.id) - Number(a.item.id);
      });

    return scored.slice(0, 3).map((entry) => entry.item);
  }, [property, allProperties]);

  const similarCity = useMemo(
    () => (property ? extractCity(property.location) : ""),
    [property]
  );

  const hasSameCityMatch = useMemo(
    () =>
      similarProperties.some(
        (item) =>
          extractCity(item.location).toLowerCase() ===
          similarCity.toLowerCase()
      ),
    [similarProperties, similarCity]
  );

  if (loading) {
    return (
      <PortalLayout title="Loading…" subtitle="Fetching property details.">
        <div className="kr-portal-state">
          <span className="kr-portal-state-spinner"></span>
          <span>Loading property…</span>
        </div>
      </PortalLayout>
    );
  }

  if (!property) return null;

  const isShortlisted = shortlistedLookup.has(property.id);
  const sourceImages = Array.isArray(property.imageUrls)
    ? property.imageUrls.filter((value) => String(value || "").trim())
    : [];
  const fallbackResolvedImage = resolvePropertyImageUrl(property.imageUrl, property.type);
  const resolvedImageUrls = sourceImages.length > 0
    ? sourceImages.map((url) => resolvePropertyImageUrl(url, property.type))
    : [fallbackResolvedImage];
  const rawVideoUrl = String(property.videoUrl || "").trim();
  const imageMedia = resolvedImageUrls.map((url) => ({ type: "image", url }));
  const videoMedia = rawVideoUrl ? [{ type: "video", url: rawVideoUrl }] : [];
  const mediaItems = [...imageMedia, ...videoMedia];
  const clampedMediaIndex = Math.min(
    Math.max(selectedImageIndex, 0),
    Math.max(mediaItems.length - 1, 0)
  );
  const customImage = (sourceImages.length > 0 || hasCustomImage(property.imageUrl)) && !imgError;
  // When the image errors out, fall back to the type placeholder for the stage.
  const stageMedia = mediaItems.map((item, idx) => {
    if (item.type !== "image") return item;
    if (imgError && idx === clampedMediaIndex) {
      return { ...item, url: getFallbackImage(property.type) };
    }
    return item;
  });
  const features = deriveFeatures(property);
  const isSoftDeleted = Boolean(property?.isSoftDeleted);
  const ownerId = property.ownerId != null ? Number(property.ownerId) : null;
  const isOwnListing =
    ownerId != null &&
    Number.isFinite(ownerId) &&
    Number(currentUser?.id) === ownerId;
  const canReportListing =
    ownerId != null &&
    Number.isFinite(ownerId) &&
    ownerId > 0 &&
    !isOwnListing &&
    !isSoftDeleted;

  const isGuest = !currentUser;
  const needsEmailInput = isGuest && guestStage === "email";

  const closeReportModal = () => {
    if (reportSubmitting) return;
    setReportOpen(false);
    setGuestStage("choice");
  };

  const isValidEmailClient = (value) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

  const handleSubmitReport = async () => {
    if (reportReason === "other" && !String(reportCustom).trim()) {
      notify("Please add a short description when you choose “Other”.", "warning");
      return;
    }
    const trimmedEmail = String(reportEmail || "").trim();
    if (isGuest) {
      if (!trimmedEmail) {
        notify("Please enter your email so we can follow up.", "warning");
        return;
      }
      if (!isValidEmailClient(trimmedEmail)) {
        notify("Please enter a valid email address.", "warning");
        return;
      }
    }
    setReportSubmitting(true);
    try {
      await submitListingReport(property.id, {
        reasonCode: reportReason,
        customDetail: String(reportCustom || "").trim(),
        ...(isGuest ? { email: trimmedEmail } : {})
      });
      notify(
        isGuest
          ? `Thanks — your report was sent. We'll follow up at ${trimmedEmail}.`
          : "Thanks — your report was sent to our team.",
        "success"
      );
      setReportOpen(false);
      setReportCustom("");
      setReportReason("false_pricing");
      setReportEmail("");
      setGuestStage("choice");
    } catch (error) {
      notify(error.message || "Could not submit report.", "danger");
    } finally {
      setReportSubmitting(false);
    }
  };

  const goToAuth = (mode) => {
    const returnTo = encodeURIComponent(`/listings/${property.id}`);
    navigate(`/${mode}?returnTo=${returnTo}`);
  };

  const handleSendInquiry = async () => {
    if (!currentUser) {
      notify("Please create an account or log in to send inquiries.", "warning");
      goToAuth("register");
      return;
    }
    if (isOwnListing) {
      notify("You cannot inquire about your own listing.", "warning");
      return;
    }
    const trimmedMessage = String(inquiryMessage || "").trim();
    if (trimmedMessage.length < 2) {
      notify("Please type at least 2 characters.", "warning");
      return;
    }
    setInquirySubmitting(true);
    try {
      const response = await createListingInquiry(property.id, {
        message: trimmedMessage
      });
      setInquiryMessage("");
      notify("Inquiry sent successfully. Opening your conversation…", "success");
      navigate(`/messages?conversation=${encodeURIComponent(response.conversationId)}`);
    } catch (error) {
      notify(error.message || "Could not send inquiry right now.", "danger");
    } finally {
      setInquirySubmitting(false);
    }
  };

  const handleSoftDelete = async () => {
    const confirmed = window.confirm(
      `Soft delete "${property.title}"? This listing will be hidden from users until restored.`
    );
    if (!confirmed) return;

    setIsModerating(true);
    try {
      const response = await softDeleteListing(property.id, { reason: "reported_false_listing" });
      const updatedProperty = response?.property || {};
      setProperty((prev) => ({
        ...prev,
        isSoftDeleted: true,
        deletedAt: updatedProperty.deletedAt || new Date().toISOString(),
        deletionReason: updatedProperty.deletionReason || "reported_false_listing"
      }));
      notify("Listing soft deleted successfully.", "success");
    } catch (error) {
      notify(error.message || "Failed to soft delete listing.", "danger");
    } finally {
      setIsModerating(false);
    }
  };

  const handleRestore = async () => {
    setIsModerating(true);
    try {
      await restoreSoftDeletedListing(property.id);
      setProperty((prev) => ({
        ...prev,
        isSoftDeleted: false,
        deletedAt: null,
        deletionReason: null
      }));
      notify("Listing restored successfully.", "success");
    } catch (error) {
      notify(error.message || "Failed to restore listing.", "danger");
    } finally {
      setIsModerating(false);
    }
  };

  return (
    <PortalLayout title={property.title} subtitle={property.location}>
      {/* Back breadcrumb */}
      <button
        type="button"
        className="kr-detail-back-btn"
        onClick={() => navigate("/browse")}
      >
        <Icons.Back /> Back to listings
      </button>

      {/* Split-screen body */}
      <div className="kr-detail-page-body">

        {/* LEFT: Media viewer (images + video) */}
        <MediaViewer
          media={stageMedia}
          selectedIndex={clampedMediaIndex}
          onSelect={setSelectedImageIndex}
          title={property.title}
          isCustomImage={customImage}
          onImgError={() => setImgError(true)}
          showSoftDeletedOverlay={isAdmin && isSoftDeleted}
        />

        {/* RIGHT: Info */}
        <div className="kr-detail-info kr-detail-info--page">
          <div className="kr-detail-info-scroll">
            <span className={`kr-listing-type-badge kr-listing-type-badge--${property.type} kr-detail-type-badge`}>
              {property.type}
            </span>

            <h2 className="kr-detail-title">{property.title}</h2>

            <p className="kr-detail-location">
              <Icons.Pin /> {property.location}
            </p>

            {/* Price */}
            <div className="kr-detail-price-block">
              <span className="kr-detail-price-label">Monthly price</span>
              <p className="kr-detail-price">{formatPrice(property.price, property.type)}</p>
            </div>

            {/* Description */}
            {property.description && (
              <div className="kr-detail-section">
                <p className="kr-detail-section-label">About this property</p>
                <p className="kr-detail-description">{property.description}</p>
              </div>
            )}

            {/* Features */}
            <div className="kr-detail-section">
              <p className="kr-detail-section-label">Key details</p>
              <div className="kr-detail-features-grid">
                {features.map((f) => (
                  <div key={f.label} className="kr-detail-feature">
                    <span className="kr-detail-feature-label">{f.label}</span>
                    <span className="kr-detail-feature-value">{f.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Shortlist */}
            <button
              type="button"
              className={`kr-detail-shortlist-btn${isShortlisted ? " active" : ""}`}
              onClick={() => toggleShortlist(property.id)}
            >
              <Icons.Star filled={isShortlisted} />
              {isShortlisted ? "Saved to shortlist" : "Save to shortlist"}
            </button>

            {canReportListing ? (
              <button
                type="button"
                className="kr-detail-report-btn"
                onClick={() => setReportOpen(true)}
              >
                <span className="kr-detail-report-btn-ico"><Icons.Flag /></span>
                <span>Report this listing</span>
              </button>
            ) : null}

            {isAdmin && (
              <div className={`kr-detail-admin-moderation${isSoftDeleted ? " is-soft-deleted" : ""}`}>
                <div className="kr-detail-admin-moderation-head">
                  <span className="kr-detail-admin-moderation-title">Admin moderation</span>
                  <span className={`kr-detail-admin-moderation-status${isSoftDeleted ? " is-soft-deleted" : ""}`}>
                    {isSoftDeleted ? "Soft deleted" : "Live"}
                  </span>
                </div>

                {isSoftDeleted && (
                  <p className="kr-detail-admin-moderation-meta">
                    Hidden {property.deletedAt ? `on ${new Date(property.deletedAt).toLocaleString("en-KE")}` : ""}.
                    {property.deletionReason ? ` Reason: ${property.deletionReason.replace(/_/g, " ")}` : ""}
                  </p>
                )}

                <div className="kr-detail-admin-moderation-actions">
                  {isSoftDeleted ? (
                    <button
                      type="button"
                      className="kr-listing-admin-btn kr-listing-admin-btn--restore"
                      onClick={handleRestore}
                      disabled={isModerating}
                    >
                      {isModerating ? "Restoring..." : "Undo soft delete"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="kr-listing-admin-btn kr-listing-admin-btn--soft-delete"
                      onClick={handleSoftDelete}
                      disabled={isModerating}
                    >
                      {isModerating ? "Deleting..." : "Soft delete listing"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {reportOpen ? (
              <div
                className="kr-detail-modal-overlay"
                role="presentation"
                onClick={closeReportModal}
              >
                <div
                  className="kr-detail-modal kr-report-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="kr-detail-report-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="kr-report-modal-header">
                    <div className="kr-report-modal-icon-wrap">
                      <Icons.Flag />
                    </div>
                    <div>
                      <h3 id="kr-detail-report-title" className="kr-report-modal-title">
                        Report this listing
                      </h3>
                      <p className="kr-report-modal-sub">
                        Our team reviews every report privately.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="kr-report-modal-close"
                      onClick={closeReportModal}
                      aria-label="Close"
                    >✕</button>
                  </div>

                  {isGuest && guestStage === "choice" ? (
                    <div className="kr-report-gate">
                      <div className="kr-report-gate-intro">
                        <p className="kr-report-gate-intro-text">
                          You&apos;re not signed in. Choose how you&apos;d like to submit this
                          report — we&apos;ll keep you updated either way.
                        </p>
                      </div>

                      {/* Primary: sign in */}
                      <div className="kr-report-gate-row kr-report-gate-row--primary">
                        <div className="kr-report-gate-row-icon kr-report-gate-row-icon--blue">
                          <Icons.User />
                        </div>
                        <div className="kr-report-gate-row-body">
                          <div className="kr-report-gate-row-head">
                            <h5 className="kr-report-gate-row-title">
                              Sign in or create an account
                            </h5>
                            <span className="kr-report-gate-row-pill">Recommended</span>
                          </div>
                          <p className="kr-report-gate-row-copy">
                            Track this report and get notified as soon as our team acts on it.
                          </p>
                          <div className="kr-report-gate-row-actions">
                            <button
                              type="button"
                              className="kr-report-gate-btn kr-report-gate-btn--primary"
                              onClick={() => goToAuth("login")}
                            >
                              Sign in
                            </button>
                            <button
                              type="button"
                              className="kr-report-gate-btn kr-report-gate-btn--ghost"
                              onClick={() => goToAuth("register")}
                            >
                              Create account
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="kr-report-gate-divider">
                        <span className="kr-report-gate-divider-label">or</span>
                      </div>

                      {/* Secondary: email */}
                      <div className="kr-report-gate-row">
                        <div className="kr-report-gate-row-icon kr-report-gate-row-icon--muted">
                          <Icons.Mail />
                        </div>
                        <div className="kr-report-gate-row-body">
                          <div className="kr-report-gate-row-head">
                            <h5 className="kr-report-gate-row-title">
                              Leave your email only
                            </h5>
                          </div>
                          <p className="kr-report-gate-row-copy">
                            No account needed — just drop your email and we&apos;ll follow up
                            once we&apos;ve reviewed your complaint.
                          </p>
                          <button
                            type="button"
                            className="kr-report-gate-btn kr-report-gate-btn--secondary"
                            onClick={() => setGuestStage("email")}
                          >
                            Continue with email
                          </button>
                        </div>
                      </div>

                      <div className="kr-report-modal-footer kr-report-modal-footer--gate">
                        <button
                          type="button"
                          className="kr-report-btn-cancel"
                          onClick={closeReportModal}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {needsEmailInput ? (
                        <div className="kr-report-email-block">
                          <div className="kr-report-email-block-head">
                            <div className="kr-report-email-block-label-row">
                              <span className="kr-report-email-block-icon">
                                <Icons.Mail />
                              </span>
                              <span className="kr-report-email-block-label">Contact email</span>
                            </div>
                            <button
                              type="button"
                              className="kr-report-email-block-switch"
                              onClick={() => goToAuth("login")}
                            >
                              Sign in instead →
                            </button>
                          </div>
                          <input
                            type="email"
                            className="kr-report-email-input"
                            value={reportEmail}
                            onChange={(e) => setReportEmail(e.target.value)}
                            placeholder="you@example.com"
                            autoComplete="email"
                            disabled={reportSubmitting}
                          />
                          <p className="kr-report-email-help">
                            <Icons.Shield /> We&apos;ll only use this address to update you about
                            this specific report — nothing else.
                          </p>
                        </div>
                      ) : null}

                      <p className="kr-report-modal-hint">
                        Select the reason that best fits. You can add more detail below.
                      </p>

                      <div
                        className="kr-report-reason-grid"
                        role="radiogroup"
                        aria-label="Reason for report"
                      >
                        {REPORT_REASON_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={reportReason === opt.value}
                            className={`kr-report-reason-chip${reportReason === opt.value ? " is-selected" : ""}`}
                            onClick={() => setReportReason(opt.value)}
                          >
                            <span className="kr-report-reason-emoji">{opt.icon}</span>
                            <span>{opt.label}</span>
                          </button>
                        ))}
                      </div>

                      <label className="kr-report-detail-label">
                        <span className="kr-report-detail-label-text">
                          {reportReason === "other"
                            ? "Describe the issue *"
                            : "Additional context (optional)"}
                        </span>
                        <textarea
                          className="kr-report-detail-textarea"
                          rows={3}
                          value={reportCustom}
                          onChange={(e) => setReportCustom(e.target.value)}
                          placeholder={
                            reportReason === "other"
                              ? "Please describe what is wrong with this listing…"
                              : "Add any detail that will help our moderators…"
                          }
                        />
                      </label>

                      <div className="kr-report-modal-footer">
                        {isGuest ? (
                          <button
                            type="button"
                            className="kr-report-btn-cancel"
                            onClick={() => setGuestStage("choice")}
                            disabled={reportSubmitting}
                          >
                            ← Back
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="kr-report-btn-cancel"
                            onClick={closeReportModal}
                            disabled={reportSubmitting}
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          type="button"
                          className="kr-report-btn-submit"
                          onClick={handleSubmitReport}
                          disabled={reportSubmitting}
                        >
                          {reportSubmitting ? (
                            <><span className="kr-report-spinner" />Submitting…</>
                          ) : (
                            <><Icons.Flag />Submit report</>
                          )}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : null}

            {/* Contact */}
            <div className="kr-detail-contact-card">
              <p className="kr-detail-contact-title">Interested in this property?</p>
              <p className="kr-detail-contact-sub">
                Send a private in-app inquiry directly to the lister. The thread stays visible only
                to you, the lister, and platform admins for moderation.
              </p>
              {isOwnListing ? (
                <div className="kr-detail-contact-note">
                  This is your listing. Viewer inquiries will appear in your Messages inbox.
                </div>
              ) : (
                <>
                  {!currentUser && (
                    <div className="kr-detail-contact-note">
                      Create an account to message listers and keep your inquiry history.
                    </div>
                  )}
                  <textarea
                    className="kr-detail-contact-textarea"
                    rows={4}
                    placeholder={
                      currentUser
                        ? "Hi, I’m interested in this listing. Is it still available?"
                        : "Sign up or log in to send an inquiry…"
                    }
                    value={inquiryMessage}
                    onChange={(event) => setInquiryMessage(event.target.value)}
                    disabled={inquirySubmitting || !currentUser}
                  />
                  <div className="kr-detail-contact-actions">
                    {!currentUser ? (
                      <>
                        <button
                          type="button"
                          className="kr-detail-contact-btn kr-detail-contact-btn--secondary"
                          onClick={() => goToAuth("login")}
                        >
                          Log in
                        </button>
                        <button
                          type="button"
                          className="kr-detail-contact-btn"
                          onClick={() => goToAuth("register")}
                        >
                          Create account
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="kr-detail-contact-btn"
                        onClick={handleSendInquiry}
                        disabled={inquirySubmitting}
                      >
                        {inquirySubmitting ? "Sending inquiry…" : "Send Inquiry"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

      </div>{/* end kr-detail-page-body */}

      {/* Similar Properties — full-width section below the split-screen viewer */}
      {similarProperties.length > 0 && (
        <section className="kr-similar-section" aria-labelledby="similarPropertiesTitle">
          <div className="kr-similar-header">
            <div>
              <p className="kr-similar-eyebrow">You might also like</p>
              <h3 className="kr-similar-title" id="similarPropertiesTitle">
                {hasSameCityMatch && similarCity
                  ? <>More in <span className="kr-similar-title-accent">{similarCity}</span></>
                  : <>Similar properties you may like</>}
              </h3>
              <p className="kr-similar-sub">
                {hasSameCityMatch
                  ? `Hand-picked listings close to ${similarCity || "this area"} to keep your options open.`
                  : "Other listings that share the vibe — same type, comparable price."}
              </p>
            </div>
            <button
              type="button"
              className="kr-similar-see-all"
              onClick={() => navigate(`/browse${similarCity ? `?location=${encodeURIComponent(similarCity)}` : ""}`)}
            >
              Browse all in {similarCity || "catalog"} →
            </button>
          </div>

          <div className="kr-similar-grid">
            {similarProperties.map((item) => {
              const features = getCardFeatures(item.id);
              const isPromoted = String(item?.paymentStatus || "").toLowerCase() === "paid";
              const saved = shortlistedLookup.has(item.id);
              return (
                <div className="kr-similar-grid-item" key={`similar-${item.id}`}>
                  <div className={`kr-property-card kr-similar-card ${isPromoted ? "kr-property-card--promoted" : ""}`}>
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
                      {isPromoted && (
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
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleShortlist(item.id);
                        }}
                      >
                        {saved ? "★" : "☆"}
                      </button>
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
                        <p className="kr-card-price">{formatCardPrice(item.price, item.type)}</p>
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
    </PortalLayout>
  );
}

export default PropertyDetailPage;
