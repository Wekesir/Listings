import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PortalLayout from "../components/PortalLayout";
import { getListingReports, resolveListingReport } from "../services/authService";
import { getStoredUser } from "../utils/session";
import { notify } from "../utils/notify";

const REPORT_REASON_LABELS = {
  false_pricing:                "False or misleading pricing",
  misleading_media:             "Misleading photos or description",
  unavailable_or_duplicate:     "Unavailable, duplicate, or already let",
  spam_or_scam:                 "Spam, scam, or fraud suspicion",
  inappropriate_content:        "Inappropriate content",
  harassment_or_discrimination: "Harassment or discrimination",
  other:                        "Other"
};

const REASON_ICONS = {
  false_pricing:                "💰",
  misleading_media:             "📷",
  unavailable_or_duplicate:     "🔁",
  spam_or_scam:                 "⚠️",
  inappropriate_content:        "🚫",
  harassment_or_discrimination: "🛑",
  other:                        "✏️"
};

const OUTCOME_OPTIONS = [
  { value: "dismissed",         label: "Dismiss",       sub: "No policy violation found",          severity: "neutral", needsSuspendHours: false, icon: "✓" },
  { value: "listing_suspended", label: "Hide listing",  sub: "Soft-delete this listing only",      severity: "warning", needsSuspendHours: false, icon: "🚫" },
  { value: "lister_suspended",  label: "Suspend lister",sub: "Temporary account suspension",       severity: "warning", needsSuspendHours: true,  icon: "⏸" },
  { value: "lister_banned",     label: "Ban lister",    sub: "Permanent account removal",          severity: "danger",  needsSuspendHours: false, icon: "🔴" },
  { value: "both_suspended",    label: "Hide + suspend",sub: "Remove listing & suspend lister",    severity: "warning", needsSuspendHours: true,  icon: "⏸" },
  { value: "both_banned",       label: "Hide + ban",    sub: "Remove listing & ban lister",        severity: "danger",  needsSuspendHours: false, icon: "🔴" }
];

const OUTCOME_LABELS = {
  dismissed:         "Dismissed",
  listing_suspended: "Listing hidden",
  lister_suspended:  "Lister suspended",
  lister_banned:     "Lister banned",
  both_suspended:    "Hidden + suspended",
  both_banned:       "Hidden + banned"
};

const SUSPEND_PRESETS = [
  { label: "1 h",   hours: 1   },
  { label: "6 h",   hours: 6   },
  { label: "12 h",  hours: 12  },
  { label: "24 h",  hours: 24  },
  { label: "3 d",   hours: 72  },
  { label: "7 d",   hours: 168 },
  { label: "30 d",  hours: 720 }
];

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

function timeAgo(value) {
  if (!value) return "";
  const secs = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

function getComplaintSeverityClass(total) {
  if (total >= 5) return "kr-lr-complaint-count--high";
  if (total >= 2) return "kr-lr-complaint-count--mid";
  return "kr-lr-complaint-count--low";
}

function getInitials(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(" ").filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0]?.[0]?.toUpperCase() || "?";
}

function IcoFlag() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
      <line x1="4" y1="22" x2="4" y2="15"/>
    </svg>
  );
}

function IcoCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function IcoRefresh({ spinning }) {
  return (
    <svg
      width="15" height="15"
      viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
      style={spinning ? { animation: "kr-spin 0.8s linear infinite" } : undefined}
    >
      <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-.82-7.27l2.12 2.12"/>
    </svg>
  );
}

function IcoExternal() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  );
}

function IcoChevronRight() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}

function IcoAlertTriangle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  );
}

function StatCard({ value, label, colorClass, icon }) {
  return (
    <div className={`kr-lr-stat ${colorClass}`}>
      <div className="kr-lr-stat-icon-wrap">{icon}</div>
      <div className="kr-lr-stat-body">
        <span className="kr-lr-stat-value">{value}</span>
        <span className="kr-lr-stat-label">{label}</span>
      </div>
    </div>
  );
}

function ReportRow({ row, onResolve }) {
  const totalComplaints = Number(row.listerTotalReports) || 0;
  const openComplaints  = Number(row.listerOpenReports)  || 0;
  const isOpen = row.status === "open";

  return (
    <tr className={`kr-lr-tr${isOpen ? " kr-lr-tr--open" : " kr-lr-tr--closed"}`}>

      {/* ID */}
      <td className="kr-lr-td kr-lr-td--id">
        <span className="kr-lr-row-id">#{row.id}</span>
      </td>

      {/* Status */}
      <td className="kr-lr-td kr-lr-td--status">
        {isOpen ? (
          <span className="kr-lr-badge kr-lr-badge--open">
            <span className="kr-lr-badge-dot" />
            Needs review
          </span>
        ) : (
          <span className="kr-lr-badge kr-lr-badge--closed">
            <IcoCheck />
            {OUTCOME_LABELS[row.outcome] || "Resolved"}
          </span>
        )}
      </td>

      {/* Reason */}
      <td className="kr-lr-td kr-lr-td--reason">
        <div className={`kr-lr-reason-chip kr-lr-reason-chip--${row.reasonCode}`}>
          <span className="kr-lr-reason-emoji">{REASON_ICONS[row.reasonCode] || "🚩"}</span>
          <span className="kr-lr-reason-label">{REPORT_REASON_LABELS[row.reasonCode] || row.reasonCode}</span>
        </div>
        {row.customDetail ? (
          <div className="kr-lr-custom-note" title={row.customDetail}>
            <span className="kr-lr-custom-note-icon">✎</span>
            <span className="kr-lr-custom-note-text">{row.customDetail}</span>
          </div>
        ) : null}
      </td>

      {/* Listing */}
      <td className="kr-lr-td kr-lr-td--listing">
        <Link className="kr-lr-link" to={`/listings/${row.propertyId}`} target="_blank" rel="noopener noreferrer">
          <span className="kr-lr-link-text">{row.propertyTitle}</span>
          <IcoExternal />
        </Link>
        {row.propertyLocation ? (
          <div className="kr-lr-td-sub">
            <span className="kr-lr-td-sub-icon">📍</span>{row.propertyLocation}
          </div>
        ) : null}
      </td>

      {/* Lister */}
      <td className="kr-lr-td kr-lr-td--person">
        <div className="kr-lr-person-row">
          <div className="kr-lr-avatar kr-lr-avatar--lister">{getInitials(row.listerName)}</div>
          <div className="kr-lr-person-info">
            <div className="kr-lr-person-name">{row.listerName || `User #${row.listerUserId}`}</div>
            <span className={`kr-lr-complaint-count ${getComplaintSeverityClass(totalComplaints)}`}>
              {totalComplaints === 0 ? "No complaints" : `${totalComplaints} complaint${totalComplaints === 1 ? "" : "s"}`}
              {openComplaints > 0 ? <strong> · {openComplaints} open</strong> : null}
            </span>
          </div>
        </div>
      </td>

      {/* Reporter */}
      <td className="kr-lr-td kr-lr-td--person">
        <div className="kr-lr-person-row">
          <div className={`kr-lr-avatar${row.isAnonymous ? " kr-lr-avatar--guest" : " kr-lr-avatar--reporter"}`}>
            {row.isAnonymous ? "?" : getInitials(row.reporterName)}
          </div>
          <div className="kr-lr-person-info">
            <div className="kr-lr-person-name">
              {row.isAnonymous
                ? <><span>Anonymous</span><span className="kr-lr-anon-pill">Guest</span></>
                : (row.reporterName || "—")}
            </div>
            {row.reporterEmail ? (
              <a
                href={`mailto:${row.reporterEmail}?subject=${encodeURIComponent(
                  `Re: your report about ${row.propertyTitle || "a listing"}`
                )}`}
                className="kr-lr-reporter-email"
              >
                {row.reporterEmail}
              </a>
            ) : null}
          </div>
        </div>
      </td>

      {/* Filed */}
      <td className="kr-lr-td kr-lr-td--date">
        <span className="kr-lr-date-rel" title={formatDateTime(row.createdAt)}>
          {timeAgo(row.createdAt)}
        </span>
        <div className="kr-lr-date-full">{formatDateTime(row.createdAt).split(",")[0]}</div>
        {!isOpen && row.resolvedAt ? (
          <div className="kr-lr-td-resolved" title={`Resolved by ${row.resolverName || "admin"} on ${formatDateTime(row.resolvedAt)}`}>
            ↳ {row.resolverName || "Admin"}
          </div>
        ) : null}
      </td>

      {/* Action */}
      <td className="kr-lr-td kr-lr-td--action">
        {isOpen ? (
          <button type="button" className="kr-lr-resolve-btn" onClick={() => onResolve(row)}>
            <IcoFlag />
            <span>Resolve</span>
            <IcoChevronRight />
          </button>
        ) : (
          <span className="kr-lr-outcome-tag kr-lr-outcome-tag--closed">
            <IcoCheck />
            Done
          </span>
        )}
      </td>
    </tr>
  );
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

function IcoChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  );
}
function IcoChevronRightLg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  );
}

function buildPageNumbers(current, total) {
  const max = Math.max(1, total);
  if (max <= 7) return Array.from({ length: max }, (_, i) => i + 1);
  const pages = new Set([1, max, current, current - 1, current + 1]);
  const sorted = [...pages].filter((n) => n >= 1 && n <= max).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("…");
    out.push(sorted[i]);
  }
  return out;
}

function PaginationBar({ page, totalPages, total, limit, onPageChange, loading }) {
  if (!total || totalPages <= 0) return null;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);
  const pageList = buildPageNumbers(page, totalPages);
  const disabled = loading;

  return (
    <div className="kr-lr-pagination">
      <div className="kr-lr-pagination-info">
        Showing <strong>{from}</strong>–<strong>{to}</strong> of <strong>{total}</strong>
      </div>

      <div className="kr-lr-pagination-controls">
        <button
          type="button"
          className="kr-lr-page-btn kr-lr-page-btn--nav"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={disabled || page <= 1}
          aria-label="Previous page"
        >
          <IcoChevronLeft />
          <span>Prev</span>
        </button>

        <div className="kr-lr-page-numbers">
          {pageList.map((p, idx) =>
            p === "…" ? (
              <span key={`gap-${idx}`} className="kr-lr-page-gap">…</span>
            ) : (
              <button
                key={p}
                type="button"
                className={`kr-lr-page-btn kr-lr-page-btn--num${p === page ? " is-active" : ""}`}
                onClick={() => onPageChange(p)}
                disabled={disabled || p === page}
                aria-current={p === page ? "page" : undefined}
                aria-label={`Page ${p}`}
              >
                {p}
              </button>
            )
          )}
        </div>

        <button
          type="button"
          className="kr-lr-page-btn kr-lr-page-btn--nav"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={disabled || page >= totalPages}
          aria-label="Next page"
        >
          <span>Next</span>
          <IcoChevronRightLg />
        </button>
      </div>
    </div>
  );
}

function AdminListingReportsPage() {
  const currentUser = getStoredUser();
  const [statusFilter, setStatusFilter] = useState("open");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({ open: 0, closed: 0 });
  const [pagination, setPagination] = useState({ page: 1, limit: DEFAULT_PAGE_SIZE, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [modalReport, setModalReport] = useState(null);
  const [outcome, setOutcome] = useState("dismissed");
  const [adminNotes, setAdminNotes] = useState("");
  const [suspendHours, setSuspendHours] = useState(168);
  const [submitting, setSubmitting] = useState(false);

  // Debounce the search input → search query (drives the fetch)
  useEffect(() => {
    const handle = setTimeout(() => setSearchQuery(searchInput.trim()), 280);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Reset to page 1 whenever any filter/search changes
  useEffect(() => {
    setPage(1);
  }, [statusFilter, reasonFilter, searchQuery, pageSize]);

  const load = useCallback(async () => {
    void refreshNonce;
    setLoading(true);
    try {
      const res = await getListingReports({
        status: statusFilter,
        reasonCode: reasonFilter !== "all" ? reasonFilter : "",
        search: searchQuery,
        page,
        limit: pageSize
      });
      setRows(Array.isArray(res?.data) ? res.data : []);
      setStats(res?.stats || { open: 0, closed: 0 });
      setPagination(res?.pagination || { page: 1, limit: pageSize, total: 0, totalPages: 1 });
    } catch {
      notify("Could not load listing reports.", "danger");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, reasonFilter, searchQuery, page, pageSize, refreshNonce]);

  useEffect(() => { void load(); }, [load]);

  const triggerRefresh = () => setRefreshNonce((n) => n + 1);
  const clearAllFilters = () => {
    setStatusFilter("open");
    setReasonFilter("all");
    setSearchInput("");
    setSearchQuery("");
    setPage(1);
  };
  const hasActiveFilters =
    statusFilter !== "open" || reasonFilter !== "all" || Boolean(searchQuery);

  const openResolveModal = (report) => {
    setModalReport(report);
    setOutcome("dismissed");
    setAdminNotes("");
    setSuspendHours(168);
  };

  const closeModal = () => { if (!submitting) setModalReport(null); };

  const selectedOutcomeMeta = useMemo(
    () => OUTCOME_OPTIONS.find((o) => o.value === outcome),
    [outcome]
  );

  const handleResolve = async () => {
    if (!modalReport) return;
    setSubmitting(true);
    try {
      await resolveListingReport(modalReport.id, {
        outcome,
        adminNotes,
        ...(selectedOutcomeMeta?.needsSuspendHours ? { suspendDurationHours: suspendHours } : {})
      });
      notify("Report resolved successfully.", "success");
      setModalReport(null);
      triggerRefresh();
    } catch (e) {
      notify(e.message || "Could not resolve report.", "danger");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!modalReport) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !submitting) setModalReport(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalReport, submitting]);

  if (currentUser?.accountType !== "admin") {
    return (
      <PortalLayout title="Access denied" subtitle="Admin only.">
        <p className="kr-portal-muted">You do not have permission to view listing reports.</p>
      </PortalLayout>
    );
  }

  const totalReports = stats.open + stats.closed;

  return (
    <PortalLayout
      title="Listing reports"
      subtitle="Review and action complaints submitted by users against listings and their owners."
    >
      {/* Stats */}
      <div className="kr-lr-stats-row">
        <StatCard
          value={stats.open}
          label="Awaiting review"
          colorClass="kr-lr-stat--amber"
          icon={<IcoFlag />}
        />
        <StatCard
          value={stats.closed}
          label="Resolved"
          colorClass="kr-lr-stat--green"
          icon={<IcoCheck />}
        />
        <StatCard
          value={totalReports}
          label="Total complaints"
          colorClass="kr-lr-stat--blue"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          }
        />
      </div>

      {/* Toolbar — status tabs + refresh */}
      <div className="kr-lr-toolbar">
        <div className="kr-lr-filter-group">
          {[
            { key: "open",   label: "Open",     count: stats.open },
            { key: "all",    label: "All",      count: totalReports },
            { key: "closed", label: "Resolved", count: stats.closed }
          ].map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              data-key={key}
              className={`kr-lr-filter-btn${statusFilter === key ? " is-active" : ""}`}
              onClick={() => setStatusFilter(key)}
            >
              {label}
              <span className="kr-lr-filter-count">{count}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="kr-lr-refresh-btn"
          onClick={triggerRefresh}
          disabled={loading}
        >
          <IcoRefresh spinning={loading} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Secondary filter row — search + reason + page size */}
      <div className="kr-lr-filter-row">
        <div className="kr-lr-search-wrap">
          <span className="kr-lr-search-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </span>
          <input
            type="search"
            className="kr-lr-search-input"
            placeholder="Search by name, email, note, or ID…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search reports"
          />
          {searchInput ? (
            <button
              type="button"
              className="kr-lr-search-clear"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
            >
              ✕
            </button>
          ) : null}
        </div>

        <div className="kr-lr-select-wrap">
          <label htmlFor="kr-lr-reason-select" className="kr-lr-select-label">Reason</label>
          <select
            id="kr-lr-reason-select"
            className="kr-lr-select"
            value={reasonFilter}
            onChange={(e) => setReasonFilter(e.target.value)}
          >
            <option value="all">All reasons</option>
            {Object.entries(REPORT_REASON_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {REASON_ICONS[code] ? `${REASON_ICONS[code]} ` : ""}{label}
              </option>
            ))}
          </select>
        </div>

        <div className="kr-lr-select-wrap">
          <label htmlFor="kr-lr-size-select" className="kr-lr-select-label">Per page</label>
          <select
            id="kr-lr-size-select"
            className="kr-lr-select kr-lr-select--narrow"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value) || DEFAULT_PAGE_SIZE)}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {hasActiveFilters ? (
          <button type="button" className="kr-lr-clear-filters-btn" onClick={clearAllFilters}>
            Clear filters
          </button>
        ) : null}
      </div>

      {/* Content */}
      {loading && rows.length === 0 ? (
        <div className="kr-portal-state">
          <span className="kr-portal-state-spinner" />
          <span>Loading reports…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="kr-lr-empty-state">
          <div className="kr-lr-empty-icon"><IcoCheck /></div>
          <p className="kr-lr-empty-title">
            {hasActiveFilters
              ? "No matching reports"
              : statusFilter === "open" ? "No open reports" : "No reports found"}
          </p>
          <p className="kr-lr-empty-sub">
            {hasActiveFilters
              ? "Try adjusting your filters or clearing the search."
              : statusFilter === "open"
                ? "All complaints have been resolved. Nice work."
                : "No reports match this filter."}
          </p>
          {hasActiveFilters ? (
            <button type="button" className="kr-lr-clear-filters-btn kr-lr-clear-filters-btn--empty" onClick={clearAllFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="kr-lr-table-wrap">
            <table className="kr-lr-table">
              <thead>
                <tr className="kr-lr-thead-tr">
                  <th className="kr-lr-th kr-lr-th--id">#</th>
                  <th className="kr-lr-th">Status</th>
                  <th className="kr-lr-th">Reason</th>
                  <th className="kr-lr-th">Listing</th>
                  <th className="kr-lr-th">Lister</th>
                  <th className="kr-lr-th">Reporter</th>
                  <th className="kr-lr-th">Filed</th>
                  <th className="kr-lr-th kr-lr-th--action">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ReportRow key={row.id} row={row} onResolve={openResolveModal} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination bar */}
          <PaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            limit={pagination.limit}
            onPageChange={setPage}
            loading={loading}
          />
        </>
      )}

      {/* Resolution modal */}
      {modalReport ? (
        <div className="kr-lr-modal-overlay" role="presentation" onClick={closeModal}>
          <div
            className="kr-lr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kr-lr-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="kr-lr-modal-header">
              <div className="kr-lr-modal-header-icon"><IcoFlag /></div>
              <div className="kr-lr-modal-header-body">
                <h3 id="kr-lr-modal-title" className="kr-lr-modal-title">Resolve complaint</h3>
                <div className="kr-lr-modal-header-meta">
                  <span className="kr-lr-modal-reason-chip">
                    {REASON_ICONS[modalReport.reasonCode] || "🚩"}{" "}
                    {REPORT_REASON_LABELS[modalReport.reasonCode] || modalReport.reasonCode}
                  </span>
                  <span className="kr-lr-modal-listing-name">
                    — {modalReport.propertyTitle}
                  </span>
                </div>
              </div>
              <button type="button" className="kr-lr-modal-close" onClick={closeModal} disabled={submitting}>✕</button>
            </div>

            {/* Lister history banner */}
            <div
              className={[
                "kr-lr-history-banner",
                modalReport.listerTotalReports >= 5 ? "kr-lr-history-banner--danger" :
                modalReport.listerTotalReports >= 2 ? "kr-lr-history-banner--warn" : ""
              ].filter(Boolean).join(" ")}
            >
              <span className="kr-lr-history-icon">
                {modalReport.listerTotalReports >= 5
                  ? <IcoAlertTriangle />
                  : modalReport.listerTotalReports >= 2
                    ? "⚠️"
                    : "ℹ️"}
              </span>
              <div className="kr-lr-history-banner-body">
                <strong>{modalReport.listerName || `User #${modalReport.listerUserId}`}</strong>
                {" "}has{" "}
                <strong className={
                  modalReport.listerTotalReports >= 5 ? "kr-lr-history-count--high" :
                  modalReport.listerTotalReports >= 2 ? "kr-lr-history-count--mid" : ""
                }>
                  {modalReport.listerTotalReports} complaint{modalReport.listerTotalReports === 1 ? "" : "s"}
                </strong>
                {" "}on record
                {modalReport.listerOpenReports > 0
                  ? <span className="kr-lr-history-open-note">, {modalReport.listerOpenReports} still open</span>
                  : <span className="kr-lr-history-clean-note"> · all resolved</span>}.
              </div>
            </div>

            {/* Outcome picker */}
            <p className="kr-lr-modal-section-label">Choose an outcome</p>
            <div className="kr-lr-outcome-grid">
              {OUTCOME_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`kr-lr-outcome-btn kr-lr-outcome-btn--${o.severity}${outcome === o.value ? " is-selected" : ""}`}
                  onClick={() => setOutcome(o.value)}
                >
                  <div className="kr-lr-outcome-btn-top">
                    <span className="kr-lr-outcome-icon">{o.icon}</span>
                    {outcome === o.value ? <span className="kr-lr-outcome-check"><IcoCheck /></span> : null}
                  </div>
                  <span className="kr-lr-outcome-label">{o.label}</span>
                  <span className="kr-lr-outcome-sub">{o.sub}</span>
                </button>
              ))}
            </div>

            {/* Suspend duration (when needed) */}
            {selectedOutcomeMeta?.needsSuspendHours ? (
              <div className="kr-lr-suspend-row">
                <p className="kr-lr-modal-section-label">Suspension length</p>
                <div className="kr-lr-suspend-presets">
                  {SUSPEND_PRESETS.map((p) => (
                    <button
                      key={p.hours}
                      type="button"
                      className={`kr-lr-preset-btn${suspendHours === p.hours ? " is-active" : ""}`}
                      onClick={() => setSuspendHours(p.hours)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="kr-lr-suspend-custom">
                  <input
                    type="number"
                    className="kr-lr-suspend-input"
                    min={1}
                    max={8760}
                    value={suspendHours}
                    onChange={(e) => setSuspendHours(Number(e.target.value))}
                  />
                  <span className="kr-lr-suspend-unit">hours</span>
                </div>
              </div>
            ) : null}

            {/* Admin notes */}
            <label className="kr-lr-notes-label">
              <span className="kr-lr-modal-section-label" style={{ marginBottom: 0 }}>
                Admin notes <span style={{ fontWeight: 400, textTransform: "none" }}>(optional · shown to user on suspend/ban if no other message)</span>
              </span>
              <textarea
                className="kr-lr-notes-textarea"
                rows={3}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Internal notes or the message sent to the lister…"
              />
            </label>

            {/* Actions */}
            <div className="kr-lr-modal-actions">
              <button type="button" className="kr-lr-btn-cancel" onClick={closeModal} disabled={submitting}>
                Cancel
              </button>
              <button
                type="button"
                className={`kr-lr-btn-confirm kr-lr-btn-confirm--${selectedOutcomeMeta?.severity || "neutral"}`}
                onClick={handleResolve}
                disabled={submitting}
              >
                {submitting ? (
                  <><span className="kr-lr-spinner" />Applying…</>
                ) : (
                  <>Confirm: {selectedOutcomeMeta?.label}</>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PortalLayout>
  );
}

export default AdminListingReportsPage;
