import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER = { lat: -1.286389, lng: 36.817223 };

function isFiniteCoordinate(value) {
  return Number.isFinite(Number(value));
}

function normalizeSelectedPoint(raw) {
  if (!raw) return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const label = String(raw.label || "").trim();
  return { lat, lng, label };
}

function MapClickEvents({ onSelectPoint }) {
  useMapEvents({
    click(event) {
      onSelectPoint({ lat: event.latlng.lat, lng: event.latlng.lng });
    }
  });
  return null;
}

function MapTargetController({ target }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 15), { duration: 0.7 });
  }, [map, target]);
  return null;
}

function buildMarkerIcon() {
  return L.divIcon({
    className: "kr-map-pin-wrap",
    html: `<span class="kr-map-pin-body">
      <svg class="kr-map-pin-svg" viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 0C7.03 0 3 4.03 3 9c0 6.75 9 21 9 21s9-14.25 9-21c0-4.97-4.03-9-9-9z" fill="currentColor"/>
        <circle cx="12" cy="9" r="3.5" fill="white" opacity="0.95"/>
      </svg>
    </span>`,
    iconSize: [32, 40],
    iconAnchor: [16, 40]
  });
}

async function reverseGeocode(lat, lng) {
  const query = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lng),
    zoom: "18",
    addressdetails: "1"
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${query.toString()}`);
  if (!response.ok) throw new Error("Could not resolve location");
  const payload = await response.json();
  return String(payload?.display_name || "").trim();
}

async function searchLocations(searchTerm) {
  const query = new URLSearchParams({
    format: "jsonv2",
    q: String(searchTerm || "").trim(),
    limit: "6",
    addressdetails: "1"
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${query.toString()}`);
  if (!response.ok) throw new Error("Search failed");
  const payload = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => ({
      lat: Number(item?.lat),
      lng: Number(item?.lon),
      label: String(item?.display_name || "").trim()
    }))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng) && item.label);
}

function LocationPickerModal({
  isOpen,
  title = "Choose location on map",
  onClose,
  onApply,
  initialLocationText = "",
  initialLatitude = null,
  initialLongitude = null
}) {
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [activeMapTarget, setActiveMapTarget] = useState(null);
  const [selectionError, setSelectionError] = useState("");

  const markerIcon = useMemo(() => buildMarkerIcon(), []);

  useEffect(() => {
    if (!isOpen) return;
    const canUseInitialCoordinates = isFiniteCoordinate(initialLatitude) && isFiniteCoordinate(initialLongitude);
    const initialPoint = canUseInitialCoordinates
      ? normalizeSelectedPoint({
          lat: Number(initialLatitude),
          lng: Number(initialLongitude),
          label: String(initialLocationText || "").trim()
        })
      : null;
    setSearchValue(String(initialLocationText || "").trim());
    setSearchResults([]);
    setSelectedPoint(initialPoint);
    setActiveMapTarget(initialPoint || DEFAULT_CENTER);
    setSelectionError("");

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, initialLatitude, initialLongitude, initialLocationText]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEscape = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  const handleSearch = async () => {
    const normalized = String(searchValue || "").trim();
    if (!normalized) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    setSelectionError("");
    try {
      const results = await searchLocations(normalized);
      setSearchResults(results);
      if (results.length > 0) setActiveMapTarget(results[0]);
    } catch (_error) {
      setSearchResults([]);
      setSelectionError("Could not search location. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSearch();
    }
  };

  const resolveSelectionLabel = async (lat, lng) => {
    try {
      const resolved = await reverseGeocode(lat, lng);
      return resolved || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    } catch (_error) {
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
  };

  const applySelectedCoordinates = async (coords) => {
    if (!coords) return;
    const lat = Number(coords.lat);
    const lng = Number(coords.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const resolvedLabel = await resolveSelectionLabel(lat, lng);
    const next = { lat, lng, label: resolvedLabel };
    setSelectedPoint(next);
    setActiveMapTarget(next);
    setSearchValue((prev) => prev || resolvedLabel);
  };

  const handleMapClick = (coords) => {
    void applySelectedCoordinates(coords);
  };

  const handlePickSearchResult = (item) => {
    const point = normalizeSelectedPoint(item);
    if (!point) return;
    setSelectedPoint(point);
    setActiveMapTarget(point);
    setSearchResults([]);
    setSearchValue(point.label);
  };

  const handleConfirm = () => {
    if (!selectedPoint) {
      setSelectionError("Select a point on the map first.");
      return;
    }
    onApply?.({
      location: selectedPoint.label || searchValue.trim(),
      latitude: Number(selectedPoint.lat),
      longitude: Number(selectedPoint.lng)
    });
    onClose?.();
  };

  if (!isOpen) return null;

  return (
    <div
      className="kr-portal-filter-modal-overlay kr-map-picker-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="kr-portal-filter-modal kr-map-picker-modal" role="dialog" aria-modal="true" aria-label={title}>

        {/* Header */}
        <div className="kr-portal-filter-modal-head">
          <div className="kr-portal-filter-modal-head-left">
            <div className="kr-portal-filter-modal-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <div>
              <h3 className="kr-portal-filter-modal-title">{title}</h3>
              <p className="kr-portal-filter-modal-subtitle">Search, then tap the exact spot on the map to pin your property.</p>
            </div>
          </div>
          <button type="button" className="kr-portal-filter-modal-close" onClick={onClose} aria-label="Close map picker">
            ×
          </button>
        </div>

        {/* Body */}
        <div className="kr-map-picker-body">

          {/* Search row */}
          <div className="kr-map-picker-search-row">
            <div className="kr-map-picker-search-input-wrap">
              <span className="kr-map-picker-search-icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input
                type="text"
                className="kr-map-picker-search-input"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search area, neighbourhood, or landmark…"
                aria-label="Search location"
              />
            </div>
            <button type="button" className="kr-map-picker-search-btn" onClick={handleSearch} disabled={isSearching}>
              {isSearching ? (
                <span className="kr-map-picker-search-spinner" aria-hidden="true" />
              ) : null}
              {isSearching ? "Searching…" : "Search"}
            </button>
          </div>

          {/* Search results dropdown */}
          {searchResults.length > 0 && (
            <div className="kr-map-picker-results" role="listbox" aria-label="Search results">
              {searchResults.map((item) => (
                <button
                  type="button"
                  key={`${item.lat}-${item.lng}-${item.label}`}
                  className="kr-map-picker-result-btn"
                  role="option"
                  aria-selected="false"
                  onClick={() => handlePickSearchResult(item)}
                >
                  <span className="kr-map-picker-result-icon" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/>
                    </svg>
                  </span>
                  <span className="kr-map-picker-result-text">{item.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Map */}
          <div className="kr-map-picker-map-wrap">
            {!selectedPoint && (
              <div className="kr-map-picker-map-tip" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                Tap the map to place a pin
              </div>
            )}
            <MapContainer
              className="kr-map-picker-map"
              center={[activeMapTarget?.lat || DEFAULT_CENTER.lat, activeMapTarget?.lng || DEFAULT_CENTER.lng]}
              zoom={selectedPoint ? 15 : 11}
              scrollWheelZoom
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapClickEvents onSelectPoint={handleMapClick} />
              <MapTargetController target={activeMapTarget} />
              {selectedPoint && (
                <Marker
                  position={[selectedPoint.lat, selectedPoint.lng]}
                  icon={markerIcon}
                  draggable
                  eventHandlers={{
                    dragend: (event) => {
                      const latlng = event?.target?.getLatLng?.();
                      if (!latlng) return;
                      void applySelectedCoordinates({ lat: latlng.lat, lng: latlng.lng });
                    }
                  }}
                />
              )}
            </MapContainer>
          </div>

          {/* Selection preview */}
          <div className={`kr-map-picker-selection${selectedPoint ? " is-selected" : ""}`}>
            {selectedPoint ? (
              <>
                <span className="kr-map-picker-selection-check" aria-hidden="true">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <div className="kr-map-picker-selection-info">
                  <p className="kr-map-picker-selection-label">{selectedPoint.label || "Selected location"}</p>
                  <p className="kr-map-picker-selection-coords">
                    {selectedPoint.lat.toFixed(6)}, {selectedPoint.lng.toFixed(6)}
                  </p>
                </div>
              </>
            ) : (
              <p className="kr-map-picker-selection-empty">
                No location selected yet — tap the map or pick a search result.
              </p>
            )}
            {selectionError && <p className="kr-map-picker-error" role="alert">{selectionError}</p>}
          </div>
        </div>

        {/* Footer actions */}
        <div className="kr-portal-filter-modal-actions kr-map-picker-actions">
          <button type="button" className="kr-portal-filter-reset" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="kr-portal-filter-apply kr-map-picker-apply-btn"
            onClick={handleConfirm}
            disabled={!selectedPoint}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Use this location
          </button>
        </div>

      </div>
    </div>
  );
}

export default LocationPickerModal;
