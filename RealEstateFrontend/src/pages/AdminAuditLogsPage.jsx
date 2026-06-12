import { useEffect, useMemo, useState } from "react";
import PortalLayout from "../components/PortalLayout";
import { deleteAuthAuditLogs, getAuthAuditLogs } from "../services/authService";
import { notify } from "../utils/notify";

const EVENT_TYPES = [
  "",
  "login_success",
  "login_failed",
  "logout",
  "logout_failed"
];
const AUDIT_PRESETS_STORAGE_KEY = "kenreal:audit-presets";
const EMPTY_FILTERS = {
  eventType: "",
  eventReason: "",
  email: "",
  ipAddress: "",
  sessionId: "",
  unknownIpOnly: "",
  fromDate: "",
  toDate: ""
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-KE");
}

function normalizeDetails(details) {
  if (!details) return "—";
  if (typeof details === "object") return JSON.stringify(details);
  try {
    const parsed = JSON.parse(String(details));
    return JSON.stringify(parsed);
  } catch (_error) {
    return String(details);
  }
}

function toInputDate(date) {
  const dt = new Date(date);
  if (Number.isNaN(dt.getTime())) return "";
  const timezoneOffsetMs = dt.getTimezoneOffset() * 60 * 1000;
  const localDate = new Date(dt.getTime() - timezoneOffsetMs);
  return localDate.toISOString().slice(0, 10);
}

function toCsvValue(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  return `"${raw.replace(/"/g, "\"\"")}"`;
}

function sanitizeFilters(rawFilters) {
  const next = { ...EMPTY_FILTERS };
  Object.keys(EMPTY_FILTERS).forEach((key) => {
    if (rawFilters && Object.prototype.hasOwnProperty.call(rawFilters, key)) {
      next[key] = rawFilters[key];
    }
  });
  return next;
}

function getActiveFilterCount(filters) {
  return Object.keys(EMPTY_FILTERS)
    .filter((key) => String(filters?.[key] || "").trim() !== "")
    .length;
}

function getStoredPresets() {
  try {
    const raw = window.localStorage.getItem(AUDIT_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && item.id && item.name && item.filters)
      .map((item) => ({
        ...item,
        filters: sanitizeFilters(item.filters),
        isFavorite: Boolean(item.isFavorite)
      }));
  } catch (_error) {
    return [];
  }
}

function setStoredPresets(presets) {
  try {
    window.localStorage.setItem(AUDIT_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch (_error) {
    // Ignore storage failures gracefully.
  }
}

function getUserReferenceKey(row) {
  if (row?.user_id) return `id:${row.user_id}`;
  if (row?.email) return `email:${String(row.email).trim().toLowerCase()}`;
  return null;
}

function EventBadge({ type, reason }) {
  const classMap = {
    login_success: "kr-audit-badge kr-audit-badge--success",
    login_failed:  "kr-audit-badge kr-audit-badge--danger",
    logout:        "kr-audit-badge kr-audit-badge--info",
    logout_failed: "kr-audit-badge kr-audit-badge--warning"
  };
  const labelMap = {
    login_success: "Login",
    login_failed:  "Failed Login",
    logout:        "Logout",
    logout_failed: "Logout Failed"
  };
  return (
    <div className="kr-audit-event-cell">
      <span className={classMap[type] || "kr-audit-badge kr-audit-badge--muted"}>
        {labelMap[type] || type || "—"}
      </span>
      {reason && <span className="kr-audit-event-reason">{reason.replace(/_/g, " ")}</span>}
    </div>
  );
}

function StatusBadge({ code }) {
  if (!code) return <span className="kr-audit-status kr-audit-status--muted">—</span>;
  const n = Number(code);
  let cls = "kr-audit-status";
  if (n >= 200 && n < 300) cls += " kr-audit-status--2xx";
  else if (n >= 300 && n < 400) cls += " kr-audit-status--3xx";
  else if (n >= 400 && n < 500) cls += " kr-audit-status--4xx";
  else if (n >= 500) cls += " kr-audit-status--5xx";
  return <span className={cls}>{code}</span>;
}

function IpCell({ ip }) {
  if (!ip) return <span className="kr-audit-ip kr-audit-ip--unknown">unknown</span>;
  return <span className="kr-audit-ip">{ip}</span>;
}

function AdminAuditLogsPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [savedPresets, setSavedPresets] = useState(() => getStoredPresets());
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDeletingLogs, setIsDeletingLogs] = useState(false);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: 25,
    totalPages: 1
  });

  const loadLogs = async (nextPage = 1, activeFilters = filters) => {
    setLoading(true);
    try {
      const response = await getAuthAuditLogs({
        ...activeFilters,
        page: nextPage,
        limit: pagination.limit
      });
      setRows(Array.isArray(response?.data) ? response.data : []);
      setPagination((prev) => ({
        ...prev,
        ...response?.pagination,
        page: Number(response?.pagination?.page || nextPage),
        totalPages: Number(response?.pagination?.totalPages || 1)
      }));
    } catch (error) {
      notify(error.message || "Failed to load audit logs.", "danger");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const favoritePreset = savedPresets.find((item) => item.isFavorite);
    if (favoritePreset) {
      const nextFilters = sanitizeFilters(favoritePreset.filters);
      setSelectedPresetId(favoritePreset.id);
      setFilters(nextFilters);
      void loadLogs(1, nextFilters);
      return;
    }
    void loadLogs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isFilterModalOpen) return undefined;
    const handleEscape = (event) => {
      if (event.key === "Escape") setIsFilterModalOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isFilterModalOpen]);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const applyFiltersAndClose = () => {
    void loadLogs(1, filters);
    setIsFilterModalOpen(false);
  };

  const clearFilters = () => {
    const reset = { ...EMPTY_FILTERS };
    setFilters(reset);
    void loadLogs(1, reset);
  };

  const goToPage = (nextPage) => {
    if (nextPage < 1 || nextPage > pagination.totalPages || nextPage === pagination.page) return;
    void loadLogs(nextPage, filters);
  };

  const applyQuickFilter = (kind) => {
    const now = new Date();
    const previous24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    let nextFilters = { ...filters };
    if (kind === "failed_last_24h") {
      nextFilters = { ...filters, eventType: "login_failed", eventReason: "", fromDate: toInputDate(previous24Hours), toDate: toInputDate(now), unknownIpOnly: "" };
    } else if (kind === "inactivity_logouts") {
      nextFilters = { ...filters, eventType: "logout", eventReason: "inactivity_timeout", fromDate: "", toDate: "", unknownIpOnly: "" };
    } else if (kind === "unknown_ips") {
      nextFilters = { ...filters, eventType: "", eventReason: "", unknownIpOnly: "true" };
    }
    setFilters(nextFilters);
    void loadLogs(1, nextFilters);
  };

  const handleExportCsv = async () => {
    try {
      const firstPage = await getAuthAuditLogs({ ...filters, page: 1, limit: 100 });
      let aggregatedRows = Array.isArray(firstPage?.data) ? [...firstPage.data] : [];
      const totalPages = Number(firstPage?.pagination?.totalPages || 1);
      const maxPages = Math.min(totalPages, 20);
      for (let currentPage = 2; currentPage <= maxPages; currentPage += 1) {
        const nextPageResponse = await getAuthAuditLogs({ ...filters, page: currentPage, limit: 100 });
        const nextRows = Array.isArray(nextPageResponse?.data) ? nextPageResponse.data : [];
        aggregatedRows = aggregatedRows.concat(nextRows);
      }
      if (!aggregatedRows.length) { notify("No rows available for export.", "warning"); return; }
      const exportUserReferenceMap = new Map();
      let exportUserReferenceCounter = 1;
      const getExportUserReference = (row) => {
        const key = getUserReferenceKey(row);
        if (!key) return "—";
        if (!exportUserReferenceMap.has(key)) {
          exportUserReferenceMap.set(key, exportUserReferenceCounter);
          exportUserReferenceCounter += 1;
        }
        return `User ${exportUserReferenceMap.get(key)}`;
      };

      const header = ["id","created_at","event_type","event_reason","email","user_reference","account_type","ip_address","device_type","platform","browser","os","session_id","http_method","request_path","status_code","details"];
      const lines = [header.map(toCsvValue).join(",")];
      aggregatedRows.forEach((row) => {
        lines.push([row.id,row.created_at,row.event_type,row.event_reason,row.email,getExportUserReference(row),row.account_type,row.ip_address,row.device_type,row.platform,row.browser,row.os,row.session_id,row.http_method,row.request_path,row.status_code,normalizeDetails(row.details)].map(toCsvValue).join(","));
      });
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const fileName = `auth-audit-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      notify(`Exported ${aggregatedRows.length} audit records.`, "success");
    } catch (error) {
      notify(error.message || "Failed to export CSV.", "danger");
    }
  };

  const runDeleteAuditLogs = async (payload, confirmText) => {
    const confirmed = window.confirm(confirmText);
    if (!confirmed) return;

    setIsDeletingLogs(true);
    try {
      const response = await deleteAuthAuditLogs(payload);
      notify(response?.message || "Audit logs deleted.", "success");
      void loadLogs(1, filters);
    } catch (error) {
      notify(error.message || "Failed to delete audit logs.", "danger");
    } finally {
      setIsDeletingLogs(false);
    }
  };

  const handleDeleteByPeriod = async () => {
    if (!filters.fromDate && !filters.toDate) {
      notify("Set From Date or To Date first.", "warning");
      return;
    }
    await runDeleteAuditLogs(
      {
        scope: "period",
        fromDate: filters.fromDate || undefined,
        toDate: filters.toDate || undefined
      },
      `Delete audit logs for the selected period?\n\nFrom: ${filters.fromDate || "Any"}\nTo: ${filters.toDate || "Any"}`
    );
  };

  const handleDeleteByUser = async () => {
    const email = String(filters.email || "").trim().toLowerCase();
    if (!email) {
      notify("Enter the user email in filters first.", "warning");
      return;
    }
    await runDeleteAuditLogs(
      {
        scope: "user",
        email
      },
      `Delete all audit logs for user email "${email}"?`
    );
  };

  const handleDeleteAllLogs = async () => {
    await runDeleteAuditLogs(
      { scope: "all" },
      "Delete ALL authentication audit logs permanently?\n\nThis action cannot be undone."
    );
  };

  const handleSavePreset = () => {
    const normalizedName = presetName.trim();
    if (!normalizedName) { notify("Enter a preset name first.", "warning"); return; }
    const nextPreset = { id: `preset-${Date.now()}`, name: normalizedName, filters: { ...filters }, isFavorite: savedPresets.length === 0 };
    const nextPresets = [nextPreset, ...savedPresets].slice(0, 20);
    setSavedPresets(nextPresets);
    setStoredPresets(nextPresets);
    setSelectedPresetId(nextPreset.id);
    setPresetName("");
    notify("Preset saved.", "success");
  };

  const handleApplyPreset = () => {
    const targetPreset = savedPresets.find((item) => item.id === selectedPresetId);
    if (!targetPreset) { notify("Select a preset to apply.", "warning"); return; }
    const nextFilters = sanitizeFilters(targetPreset.filters);
    setFilters(nextFilters);
    void loadLogs(1, nextFilters);
  };

  const handleDeletePreset = () => {
    if (!selectedPresetId) { notify("Select a preset to delete.", "warning"); return; }
    const nextPresets = savedPresets.filter((item) => item.id !== selectedPresetId);
    setSavedPresets(nextPresets);
    setStoredPresets(nextPresets);
    setSelectedPresetId("");
    notify("Preset removed.", "info");
  };

  const handleRenamePreset = () => {
    if (!selectedPresetId) { notify("Select a preset to rename.", "warning"); return; }
    const normalizedName = presetName.trim();
    if (!normalizedName) { notify("Enter the new preset name first.", "warning"); return; }
    const nextPresets = savedPresets.map((item) => item.id === selectedPresetId ? { ...item, name: normalizedName } : item);
    setSavedPresets(nextPresets);
    setStoredPresets(nextPresets);
    setPresetName("");
    notify("Preset renamed.", "success");
  };

  const handleToggleFavoritePreset = () => {
    if (!selectedPresetId) { notify("Select a preset first.", "warning"); return; }
    const selectedPreset = savedPresets.find((item) => item.id === selectedPresetId);
    if (!selectedPreset) { notify("Preset not found.", "warning"); return; }
    const shouldFavorite = !selectedPreset.isFavorite;
    const nextPresets = savedPresets.map((item) => ({ ...item, isFavorite: shouldFavorite ? item.id === selectedPresetId : false }));
    setSavedPresets(nextPresets);
    setStoredPresets(nextPresets);
    notify(shouldFavorite ? "Preset marked as favorite." : "Favorite preset cleared.", "info");
  };

  useEffect(() => {
    const selectedPreset = savedPresets.find((item) => item.id === selectedPresetId);
    if (selectedPreset) setPresetName(selectedPreset.name);
  }, [savedPresets, selectedPresetId]);

  const activeFilterCount = getActiveFilterCount(filters);
  const userReferenceMap = useMemo(() => {
    const map = new Map();
    let counter = 1;
    rows.forEach((row) => {
      const key = getUserReferenceKey(row);
      if (key && !map.has(key)) {
        map.set(key, counter);
        counter += 1;
      }
    });
    return map;
  }, [rows]);

  const getUserReference = (row) => {
    const key = getUserReferenceKey(row);
    if (!key) return "—";
    const number = userReferenceMap.get(key);
    return number ? `User ${number}` : "—";
  };

  const startRecord = rows.length > 0 ? ((pagination.page - 1) * pagination.limit) + 1 : 0;
  const endRecord = startRecord > 0 ? startRecord + rows.length - 1 : 0;

  const pageNumbers = (() => {
    const { page, totalPages } = pagination;
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = new Set([1, totalPages, page]);
    if (page > 1) pages.add(page - 1);
    if (page < totalPages) pages.add(page + 1);
    return [...pages].sort((a, b) => a - b);
  })();

  return (
    <PortalLayout
      title="Auth Audit Logs"
      subtitle="Admin-only visibility into authentication events and security activity."
    >
      {/* ── Toolbar ── */}
      <div className="kr-audit-toolbar">
        <div className="kr-audit-toolbar-left">
          <div className="kr-audit-toolbar-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div>
            <p className="kr-audit-toolbar-count">
              {loading ? "Loading…" : (
                pagination.total > 0
                  ? `Showing ${startRecord}–${endRecord} of ${pagination.total.toLocaleString()} records`
                  : "No records found"
              )}
            </p>
            {activeFilterCount > 0 && (
              <p className="kr-audit-toolbar-filter-hint">
                {activeFilterCount} active filter{activeFilterCount !== 1 ? "s" : ""} applied
              </p>
            )}
          </div>
        </div>
        <div className="kr-audit-toolbar-actions">
          <button
            type="button"
            className={`kr-audit-filter-btn${activeFilterCount > 0 ? " kr-audit-filter-btn--active" : ""}`}
            onClick={() => setIsFilterModalOpen(true)}
            disabled={loading}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="kr-audit-filter-badge">{activeFilterCount}</span>
            )}
          </button>
          <button
            type="button"
            className="kr-audit-export-btn"
            onClick={handleExportCsv}
            disabled={loading || rows.length === 0}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Quick filter chips ── */}
      <div className="kr-audit-chips">
        <button type="button" className="kr-audit-chip kr-audit-chip--danger" onClick={() => applyQuickFilter("failed_last_24h")} disabled={loading}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Failed logins · last 24 h
        </button>
        <button type="button" className="kr-audit-chip kr-audit-chip--warning" onClick={() => applyQuickFilter("inactivity_logouts")} disabled={loading}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Inactivity logouts
        </button>
        <button type="button" className="kr-audit-chip kr-audit-chip--muted" onClick={() => applyQuickFilter("unknown_ips")} disabled={loading}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
          Unknown IPs
        </button>
        {activeFilterCount > 0 && (
          <button type="button" className="kr-audit-chip kr-audit-chip--clear" onClick={clearFilters} disabled={loading}>
            Clear all filters
          </button>
        )}
      </div>

      {/* ── Data table ── */}
      <div className="kr-audit-panel">
        {loading ? (
          <div className="kr-audit-state">
            <div className="kr-audit-spinner" />
            <p className="kr-audit-state-text">Fetching audit records…</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="kr-audit-state">
            <div className="kr-audit-state-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <p className="kr-audit-state-text">No audit records match the current filters.</p>
            {activeFilterCount > 0 && (
              <button type="button" className="kr-audit-state-clear" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="kr-audit-table-wrap">
            <table className="kr-audit-table">
              <thead>
                <tr>
                  <th className="kr-audit-th kr-audit-th--id">ID</th>
                  <th className="kr-audit-th">Timestamp</th>
                  <th className="kr-audit-th">Event</th>
                  <th className="kr-audit-th">User</th>
                  <th className="kr-audit-th">IP Address</th>
                  <th className="kr-audit-th">Device</th>
                  <th className="kr-audit-th">Request</th>
                  <th className="kr-audit-th kr-audit-th--center">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="kr-audit-row">
                    <td className="kr-audit-td kr-audit-td--id">#{row.id}</td>
                    <td className="kr-audit-td">
                      <span className="kr-audit-timestamp">{formatDate(row.created_at)}</span>
                    </td>
                    <td className="kr-audit-td">
                      <EventBadge type={row.event_type} reason={row.event_reason} />
                    </td>
                    <td className="kr-audit-td">
                      <div className="kr-audit-user-email">{row.email || "—"}</div>
                      <div className="kr-audit-user-meta">
                        {getUserReference(row)}
                        {row.account_type && <span className="kr-audit-role-chip">{row.account_type}</span>}
                      </div>
                    </td>
                    <td className="kr-audit-td">
                      <IpCell ip={row.ip_address} />
                    </td>
                    <td className="kr-audit-td">
                      <div className="kr-audit-device-primary">{[row.device_type, row.platform].filter(Boolean).join(" · ") || "—"}</div>
                      <div className="kr-audit-device-secondary">{[row.browser, row.os].filter(Boolean).join(" / ") || ""}</div>
                    </td>
                    <td className="kr-audit-td">
                      {row.http_method && (
                        <span className="kr-audit-method">{row.http_method}</span>
                      )}
                      <div className="kr-audit-path">{row.request_path || "—"}</div>
                    </td>
                    <td className="kr-audit-td kr-audit-td--center">
                      <StatusBadge code={row.status_code} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ── */}
        {!loading && pagination.totalPages > 1 && (
          <div className="kr-audit-pagination">
            <span className="kr-audit-pagination-info">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <div className="kr-audit-pagination-controls">
              <button
                type="button"
                className="kr-audit-page-btn"
                disabled={pagination.page <= 1}
                onClick={() => goToPage(1)}
                aria-label="First page"
              >
                «
              </button>
              <button
                type="button"
                className="kr-audit-page-btn"
                disabled={pagination.page <= 1}
                onClick={() => goToPage(pagination.page - 1)}
                aria-label="Previous page"
              >
                ‹
              </button>
              {pageNumbers.map((pageNum, idx) => {
                const prevPage = pageNumbers[idx - 1];
                const showEllipsis = prevPage !== undefined && pageNum - prevPage > 1;
                return (
                  <span key={pageNum} className="kr-audit-page-group">
                    {showEllipsis && <span className="kr-audit-ellipsis">…</span>}
                    <button
                      type="button"
                      className={`kr-audit-page-btn${pageNum === pagination.page ? " kr-audit-page-btn--active" : ""}`}
                      onClick={() => goToPage(pageNum)}
                    >
                      {pageNum}
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                className="kr-audit-page-btn"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => goToPage(pagination.page + 1)}
                aria-label="Next page"
              >
                ›
              </button>
              <button
                type="button"
                className="kr-audit-page-btn"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => goToPage(pagination.totalPages)}
                aria-label="Last page"
              >
                »
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Filter modal ── */}
      {isFilterModalOpen && (
        <div
          className="kr-portal-filter-modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsFilterModalOpen(false);
          }}
        >
          <div className="kr-portal-filter-modal kr-audit-modal" role="dialog" aria-modal="true" aria-label="Audit log filters">

            {/* Modal header */}
            <div className="kr-portal-filter-modal-head">
              <div className="kr-portal-filter-modal-head-left">
                <span className="kr-portal-filter-modal-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                  </svg>
                </span>
                <div>
                  <h3 className="kr-portal-filter-modal-title">Audit Filters</h3>
                  <p className="kr-portal-filter-modal-subtitle">
                    {activeFilterCount > 0 ? `${activeFilterCount} active filter${activeFilterCount !== 1 ? "s" : ""}` : "No filters applied"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="kr-portal-filter-modal-close"
                onClick={() => setIsFilterModalOpen(false)}
                aria-label="Close filters"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="kr-filter-modal-body" style={{ display: "block", padding: "0" }}>

              {/* Section: Quick filters */}
              <div className="kr-audit-modal-section">
                <div className="kr-audit-modal-section-label">Quick filters</div>
                <div className="kr-audit-modal-chips">
                  <button type="button" className="kr-audit-chip kr-audit-chip--danger" onClick={() => { applyQuickFilter("failed_last_24h"); setIsFilterModalOpen(false); }} disabled={loading}>
                    Failed logins · last 24 h
                  </button>
                  <button type="button" className="kr-audit-chip kr-audit-chip--warning" onClick={() => { applyQuickFilter("inactivity_logouts"); setIsFilterModalOpen(false); }} disabled={loading}>
                    Inactivity logouts
                  </button>
                  <button type="button" className="kr-audit-chip kr-audit-chip--muted" onClick={() => { applyQuickFilter("unknown_ips"); setIsFilterModalOpen(false); }} disabled={loading}>
                    Unknown IPs
                  </button>
                </div>
              </div>

              {/* Section: Filters */}
              <div className="kr-audit-modal-section">
                <div className="kr-audit-modal-section-label">Filter by field</div>
                <div className="kr-audit-modal-grid">
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="eventType">Event Type</label>
                    <select id="eventType" name="eventType" className="kr-form-input kr-form-select" value={filters.eventType} onChange={handleFilterChange}>
                      {EVENT_TYPES.map((et) => (
                        <option key={et || "all"} value={et}>{et || "All events"}</option>
                      ))}
                    </select>
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="eventReasonFilter">Event Reason</label>
                    <input id="eventReasonFilter" name="eventReason" type="text" className="kr-form-input" value={filters.eventReason} onChange={handleFilterChange} placeholder="e.g. invalid_password" />
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="emailFilter">Email</label>
                    <input id="emailFilter" name="email" type="text" className="kr-form-input" value={filters.email} onChange={handleFilterChange} placeholder="e.g. user@email.com" />
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="ipAddressFilter">IP Address</label>
                    <input id="ipAddressFilter" name="ipAddress" type="text" className="kr-form-input" value={filters.ipAddress} onChange={handleFilterChange} placeholder="e.g. 127.0.0.1" />
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="unknownIpOnly">Unknown IP only</label>
                    <select id="unknownIpOnly" name="unknownIpOnly" className="kr-form-input kr-form-select" value={filters.unknownIpOnly} onChange={handleFilterChange}>
                      <option value="">Any</option>
                      <option value="true">Yes</option>
                    </select>
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="sessionIdFilter">Session ID</label>
                    <input id="sessionIdFilter" name="sessionId" type="text" className="kr-form-input" value={filters.sessionId} onChange={handleFilterChange} placeholder="session ID" />
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="fromDateFilter">From Date</label>
                    <input id="fromDateFilter" name="fromDate" type="date" className="kr-form-input" value={filters.fromDate} onChange={handleFilterChange} />
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="toDateFilter">To Date</label>
                    <input id="toDateFilter" name="toDate" type="date" className="kr-form-input" value={filters.toDate} onChange={handleFilterChange} />
                  </div>
                </div>
              </div>

              {/* Section: Presets */}
              <div className="kr-audit-modal-section">
                <div className="kr-audit-modal-section-label">Filter presets</div>
                <div className="kr-audit-preset-row">
                  <input
                    type="text"
                    className="kr-form-input kr-audit-preset-name-input"
                    placeholder="Preset name…"
                    value={presetName}
                    onChange={(event) => setPresetName(event.target.value)}
                  />
                  <select
                    className="kr-form-input kr-form-select kr-audit-preset-select"
                    value={selectedPresetId}
                    onChange={(event) => setSelectedPresetId(event.target.value)}
                  >
                    <option value="">Select a saved preset</option>
                    {savedPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.isFavorite ? `★ ${preset.name}` : preset.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="kr-audit-preset-actions">
                  <button type="button" className="kr-audit-preset-btn kr-audit-preset-btn--save" onClick={handleSavePreset}>
                    Save
                  </button>
                  <button type="button" className="kr-audit-preset-btn kr-audit-preset-btn--apply" onClick={handleApplyPreset} disabled={!selectedPresetId}>
                    Apply
                  </button>
                  <button type="button" className="kr-audit-preset-btn kr-audit-preset-btn--rename" onClick={handleRenamePreset} disabled={!selectedPresetId}>
                    Rename
                  </button>
                  <button type="button" className="kr-audit-preset-btn kr-audit-preset-btn--fav" onClick={handleToggleFavoritePreset} disabled={!selectedPresetId}>
                    ★ Favorite
                  </button>
                  <button type="button" className="kr-audit-preset-btn kr-audit-preset-btn--delete" onClick={handleDeletePreset} disabled={!selectedPresetId}>
                    Delete
                  </button>
                </div>
              </div>

              {/* Section: Data cleanup */}
              <div className="kr-audit-modal-section">
                <div className="kr-audit-modal-section-label">Data cleanup</div>
                <p className="kr-audit-delete-help">
                  Permanently remove logs by date period, by user email, or clear all logs.
                </p>
                <div className="kr-audit-delete-actions">
                  <button
                    type="button"
                    className="kr-audit-delete-btn kr-audit-delete-btn--period"
                    onClick={handleDeleteByPeriod}
                    disabled={isDeletingLogs || loading}
                  >
                    Delete by period
                  </button>
                  <button
                    type="button"
                    className="kr-audit-delete-btn kr-audit-delete-btn--user"
                    onClick={handleDeleteByUser}
                    disabled={isDeletingLogs || loading}
                  >
                    Delete by user email
                  </button>
                  <button
                    type="button"
                    className="kr-audit-delete-btn kr-audit-delete-btn--all"
                    onClick={handleDeleteAllLogs}
                    disabled={isDeletingLogs || loading}
                  >
                    Delete all logs
                  </button>
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="kr-portal-filter-modal-actions">
              <button type="button" className="kr-portal-filter-reset" onClick={clearFilters} disabled={loading}>
                Reset all filters
              </button>
              <button type="button" className="kr-portal-filter-apply" onClick={applyFiltersAndClose} disabled={loading}>
                Apply &amp; close
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}

export default AdminAuditLogsPage;
