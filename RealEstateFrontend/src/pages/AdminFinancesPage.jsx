import { useEffect, useState } from "react";
import PortalLayout from "../components/PortalLayout";
import {
  getAdminFinanceCsvUrl,
  getAdminFinancePayments,
  getAdminFinanceSummary,
  getFinanceReceiptPdfUrl
} from "../services/financeService";
import { notify } from "../utils/notify";

const DEFAULT_FILTERS = {
  status: "",
  provider: "",
  fromDate: "",
  toDate: "",
  minAmount: "",
  maxAmount: "",
  checkoutRef: "",
  providerRef: "",
  listingType: "",
  email: "",
  userId: "",
  q: "",
  page: 1,
  limit: 25
};

function statusVariant(status) {
  const s = status?.toLowerCase();
  if (s === "paid") return "kr-audit-badge--success";
  if (s === "pending") return "kr-audit-badge--warning";
  if (s === "failed") return "kr-audit-badge--danger";
  return "kr-audit-badge--muted";
}

function providerVariant(provider) {
  const p = provider?.toLowerCase();
  if (p === "stripe") return "kr-audit-badge--info";
  if (p === "mpesa") return "kr-audit-badge--success";
  return "kr-audit-badge--muted";
}

function countActiveFilters(filters) {
  const { page, limit, ...rest } = filters;
  return Object.values(rest).filter(Boolean).length;
}

function fmtDate(raw) {
  if (!raw) return "—";
  try {
    return new Date(raw).toLocaleString("en-KE", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (_) {
    return String(raw);
  }
}

function AdminFinancesPage() {
  const [summary, setSummary] = useState({
    paidTransactionsCount: 0,
    grossRevenueUsd: 0,
    grossRevenueKes: 0,
    byProvider: []
  });
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: 25 });
  const [isLoading, setIsLoading] = useState(true);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

  const loadData = async (nextFilters = filters) => {
    setIsLoading(true);
    try {
      const [summaryResponse, paymentsResponse] = await Promise.all([
        getAdminFinanceSummary(nextFilters),
        getAdminFinancePayments(nextFilters)
      ]);
      setSummary(summaryResponse || {});
      setRows(Array.isArray(paymentsResponse?.data) ? paymentsResponse.data : []);
      setPagination(paymentsResponse?.pagination || { page: 1, totalPages: 1, total: 0, limit: 25 });
    } catch (error) {
      notify(error.message || "Could not load admin finances.", "danger");
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const applyFiltersAndClose = () => {
    const next = { ...filters, page: 1 };
    setFilters(next);
    setIsFilterModalOpen(false);
    void loadData(next);
  };

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setIsFilterModalOpen(false);
    void loadData(DEFAULT_FILTERS);
  };

  const goToPage = (page) => {
    if (page < 1 || page > Number(pagination.totalPages || 1)) return;
    const next = { ...filters, page };
    setFilters(next);
    void loadData(next);
  };

  const handleExportCsv = () => {
    const url = getAdminFinanceCsvUrl(filters);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleDownloadReceipt = (paymentId) => {
    const url = getFinanceReceiptPdfUrl(paymentId);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const activeFiltersCount = countActiveFilters(filters);

  return (
    <PortalLayout
      title="Admin Finances"
      subtitle="Analyze payment performance with advanced filters and export full transaction history."
    >
      {/* KPI Cards */}
      <div className="kr-pricing-stat-row">
        <div className="kr-pricing-stat kr-pricing-stat--blue">
          <div className="kr-pricing-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <div>
            <p className="kr-pricing-stat-value">${Number(summary.grossRevenueUsd || 0).toFixed(2)}</p>
            <p className="kr-pricing-stat-label">Gross Revenue (USD)</p>
          </div>
        </div>
        <div className="kr-pricing-stat kr-pricing-stat--green">
          <div className="kr-pricing-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2"/>
              <line x1="2" y1="10" x2="22" y2="10"/>
            </svg>
          </div>
          <div>
            <p className="kr-pricing-stat-value">KSh {Number(summary.grossRevenueKes || 0).toFixed(0)}</p>
            <p className="kr-pricing-stat-label">Gross Revenue (KES)</p>
          </div>
        </div>
        <div className="kr-pricing-stat kr-pricing-stat--purple">
          <div className="kr-pricing-stat-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <div>
            <p className="kr-pricing-stat-value">{Number(summary.paidTransactionsCount || 0)}</p>
            <p className="kr-pricing-stat-label">Paid Transactions</p>
          </div>
        </div>
      </div>

      {/* Payments panel */}
      <div className="kr-audit-panel">
        <div className="kr-audit-toolbar">
          <div className="kr-audit-toolbar-left">
            <div className="kr-audit-toolbar-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div>
              <p className="kr-audit-toolbar-count">
                {pagination.total ?? rows.length} payment{(pagination.total ?? rows.length) !== 1 ? "s" : ""}
              </p>
              {activeFiltersCount > 0 && (
                <p className="kr-audit-toolbar-filter-hint">
                  {activeFiltersCount} filter{activeFiltersCount !== 1 ? "s" : ""} active
                </p>
              )}
            </div>
          </div>
          <div className="kr-audit-toolbar-actions">
            <button
              type="button"
              className={`kr-audit-filter-btn${activeFiltersCount > 0 ? " kr-audit-filter-btn--active" : ""}`}
              onClick={() => setIsFilterModalOpen(true)}
              disabled={isLoading}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              Filters
              {activeFiltersCount > 0 && (
                <span className="kr-audit-filter-badge">{activeFiltersCount}</span>
              )}
            </button>
            <button
              type="button"
              className="kr-audit-export-btn"
              onClick={handleExportCsv}
              disabled={isLoading || rows.length === 0}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export CSV
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="kr-audit-state">
            <div className="kr-audit-spinner" />
            <p className="kr-audit-state-text">Loading payments…</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="kr-audit-state">
            <div className="kr-audit-state-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <p className="kr-audit-state-text">No payments found for the selected filters.</p>
            {activeFiltersCount > 0 && (
              <button className="kr-audit-state-clear" onClick={clearFilters}>Clear filters</button>
            )}
          </div>
        ) : (
          <div className="kr-audit-table-wrap">
            <table className="kr-audit-table">
              <thead>
                <tr>
                  <th className="kr-audit-th kr-audit-th--id">ID</th>
                  <th className="kr-audit-th">Date</th>
                  <th className="kr-audit-th">Lister</th>
                  <th className="kr-audit-th">Status</th>
                  <th className="kr-audit-th">Provider</th>
                  <th className="kr-audit-th">Listing</th>
                  <th className="kr-audit-th">Amount (USD)</th>
                  <th className="kr-audit-th kr-audit-th--center">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="kr-audit-row">
                    <td className="kr-audit-td kr-audit-td--id">#{row.id}</td>
                    <td className="kr-audit-td">
                      <span className="kr-audit-timestamp">{fmtDate(row.paidAt || row.createdAt)}</span>
                    </td>
                    <td className="kr-audit-td">
                      <div className="kr-audit-user-email">{row.userFullName || "—"}</div>
                      <div className="kr-audit-user-meta">{row.userEmail || "—"}</div>
                    </td>
                    <td className="kr-audit-td">
                      <span className={`kr-audit-badge ${statusVariant(row.status)}`} style={{ textTransform: "capitalize" }}>
                        {row.status || "—"}
                      </span>
                    </td>
                    <td className="kr-audit-td">
                      <span className={`kr-audit-badge ${providerVariant(row.provider)}`} style={{ textTransform: "uppercase" }}>
                        {row.provider || "—"}
                      </span>
                    </td>
                    <td className="kr-audit-td kr-finance-td-listing">
                      {row.propertyTitle || `Property ${row.propertyId}`}
                    </td>
                    <td className="kr-audit-td">
                      <strong className="kr-finance-amount">${Number(row.amount || 0).toFixed(2)}</strong>
                    </td>
                    <td className="kr-audit-td kr-audit-td--center">
                      {row.status === "paid" ? (
                        <button
                          type="button"
                          className="kr-finance-receipt-btn"
                          onClick={() => handleDownloadReceipt(row.id)}
                          title="Download receipt PDF"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          PDF
                        </button>
                      ) : (
                        <span className="kr-finance-dash">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && Number(pagination.totalPages) > 1 && (
          <div className="kr-finance-pagination">
            <button
              type="button"
              className="kr-audit-filter-btn"
              disabled={Number(pagination.page) <= 1}
              onClick={() => goToPage(Number(pagination.page) - 1)}
            >
              ← Prev
            </button>
            <span className="kr-finance-page-info">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              className="kr-audit-filter-btn"
              disabled={Number(pagination.page) >= Number(pagination.totalPages)}
              onClick={() => goToPage(Number(pagination.page) + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Filter modal */}
      {isFilterModalOpen && (
        <div
          className="kr-portal-filter-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setIsFilterModalOpen(false); }}
        >
          <div className="kr-portal-filter-modal kr-audit-modal" role="dialog" aria-modal="true" aria-label="Payment filters">

            <div className="kr-portal-filter-modal-head">
              <div className="kr-portal-filter-modal-head-left">
                <span className="kr-portal-filter-modal-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                  </svg>
                </span>
                <div>
                  <h3 className="kr-portal-filter-modal-title">Payment Filters</h3>
                  <p className="kr-portal-filter-modal-subtitle">
                    {activeFiltersCount > 0 ? `${activeFiltersCount} active filter${activeFiltersCount !== 1 ? "s" : ""}` : "No filters applied"}
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

            <div className="kr-filter-modal-body" style={{ display: "block", padding: "0" }}>
              <div className="kr-audit-modal-section">
                <div className="kr-audit-modal-section-label">Search &amp; identity</div>
                <div className="kr-audit-modal-grid">
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="q">Search</label>
                    <input id="q" name="q" type="text" className="kr-form-input" value={filters.q} onChange={handleFilterChange} placeholder="email, listing title, refs…" />
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="email">Lister email</label>
                    <input id="email" name="email" type="text" className="kr-form-input" value={filters.email} onChange={handleFilterChange} placeholder="user@example.com" />
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="userId">Lister ID</label>
                    <input id="userId" name="userId" type="number" className="kr-form-input" value={filters.userId} onChange={handleFilterChange} placeholder="numeric user ID" />
                  </div>
                </div>
              </div>

              <div className="kr-audit-modal-section">
                <div className="kr-audit-modal-section-label">Payment details</div>
                <div className="kr-audit-modal-grid">
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="status">Status</label>
                    <select id="status" name="status" className="kr-form-input kr-form-select" value={filters.status} onChange={handleFilterChange}>
                      <option value="">All statuses</option>
                      <option value="paid">Paid</option>
                      <option value="pending">Pending</option>
                      <option value="failed">Failed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="provider">Provider</label>
                    <select id="provider" name="provider" className="kr-form-input kr-form-select" value={filters.provider} onChange={handleFilterChange}>
                      <option value="">All providers</option>
                      <option value="mpesa">M-Pesa</option>
                      <option value="stripe">Stripe</option>
                      <option value="mock">Mock</option>
                    </select>
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="listingType">Listing type</label>
                    <select id="listingType" name="listingType" className="kr-form-input kr-form-select" value={filters.listingType} onChange={handleFilterChange}>
                      <option value="">All types</option>
                      <option value="rent">Rent</option>
                      <option value="lease">Lease</option>
                    </select>
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="checkoutRef">Checkout ref</label>
                    <input id="checkoutRef" name="checkoutRef" type="text" className="kr-form-input" value={filters.checkoutRef} onChange={handleFilterChange} placeholder="checkout reference" />
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="providerRef">Provider ref</label>
                    <input id="providerRef" name="providerRef" type="text" className="kr-form-input" value={filters.providerRef} onChange={handleFilterChange} placeholder="provider reference" />
                  </div>
                </div>
              </div>

              <div className="kr-audit-modal-section">
                <div className="kr-audit-modal-section-label">Date &amp; amount range</div>
                <div className="kr-audit-modal-grid">
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="fromDate">From date</label>
                    <input id="fromDate" name="fromDate" type="date" className="kr-form-input" value={filters.fromDate} onChange={handleFilterChange} />
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="toDate">To date</label>
                    <input id="toDate" name="toDate" type="date" className="kr-form-input" value={filters.toDate} onChange={handleFilterChange} />
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="minAmount">Min amount (USD)</label>
                    <input id="minAmount" name="minAmount" type="number" className="kr-form-input" value={filters.minAmount} onChange={handleFilterChange} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="kr-audit-modal-field">
                    <label className="kr-settings-field-label" htmlFor="maxAmount">Max amount (USD)</label>
                    <input id="maxAmount" name="maxAmount" type="number" className="kr-form-input" value={filters.maxAmount} onChange={handleFilterChange} min="0" step="0.01" placeholder="0.00" />
                  </div>
                </div>
              </div>
            </div>

            <div className="kr-portal-filter-modal-actions">
              <button type="button" className="kr-portal-filter-reset" onClick={clearFilters} disabled={isLoading}>
                Reset all filters
              </button>
              <button type="button" className="kr-portal-filter-apply" onClick={applyFiltersAndClose} disabled={isLoading}>
                Apply &amp; close
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}

export default AdminFinancesPage;
