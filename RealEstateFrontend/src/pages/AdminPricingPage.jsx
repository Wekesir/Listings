import { useEffect, useMemo, useState } from "react";
import PortalLayout from "../components/PortalLayout";
import {
  getListingPricingConfiguration,
  updateListingPricingConfiguration
} from "../services/authService";
import { notify } from "../utils/notify";

const EMPTY_RULE = {
  listingType: "rent",
  minPropertyValue: "",
  maxPropertyValue: "",
  monthlyFeeUsd: "",
  isActive: true
};

const EMPTY_DISCOUNT = {
  minMonths: "",
  maxMonths: "",
  discountPercent: "",
  isActive: true
};

function toEditableNumber(value) {
  return value === null || value === undefined ? "" : String(value);
}

function upperBound(value) {
  return value === null ? Number.POSITIVE_INFINITY : Number(value);
}

function hasOverlap(firstMin, firstMax, secondMin, secondMax) {
  return Number(firstMin) <= upperBound(secondMax) && Number(secondMin) <= upperBound(firstMax);
}

function normalizeMinNumber(rawValue, fallback = 0) {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMaxNumber(rawValue) {
  if (rawValue === "" || rawValue === null || rawValue === undefined) return null;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function PillToggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`kr-pill-toggle${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="kr-pill-thumb" />
    </button>
  );
}

function SectionIcon({ children, color = "blue" }) {
  return (
    <div className={`kr-pricing-section-icon kr-pricing-section-icon--${color}`}>
      {children}
    </div>
  );
}

function ActionBtn({ onClick, variant = "ghost", title, children }) {
  return (
    <button
      type="button"
      title={title}
      className={`kr-pricing-action-btn kr-pricing-action-btn--${variant}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AdminPricingPage() {
  const [rules, setRules] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadPricing = async () => {
    setIsLoading(true);
    try {
      const response = await getListingPricingConfiguration();
      const loadedRules = Array.isArray(response?.rules) ? response.rules : [];
      const loadedDiscounts = Array.isArray(response?.discounts) ? response.discounts : [];
      setRules(loadedRules.map((item) => ({
        id: item.id,
        listingType: item.listingType || "rent",
        minPropertyValue: toEditableNumber(item.minPropertyValue),
        maxPropertyValue: toEditableNumber(item.maxPropertyValue),
        monthlyFeeUsd: toEditableNumber(item.monthlyFeeUsd),
        isActive: Boolean(item.isActive)
      })));
      setDiscounts(loadedDiscounts.map((item) => ({
        id: item.id,
        minMonths: toEditableNumber(item.minMonths),
        maxMonths: toEditableNumber(item.maxMonths),
        discountPercent: toEditableNumber(item.discountPercent),
        isActive: Boolean(item.isActive)
      })));
    } catch (error) {
      notify(error.message || "Could not load listing pricing settings.", "danger");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadPricing();
  }, []);

  const updateRule = (index, key, value) => {
    setRules((prev) => prev.map((item, i) => i === index ? { ...item, [key]: value } : item));
  };

  const updateDiscount = (index, key, value) => {
    setDiscounts((prev) => prev.map((item, i) => i === index ? { ...item, [key]: value } : item));
  };

  const handleSortRules = () => {
    setRules((prev) => [...prev].sort((left, right) => {
      const typeCompare = String(left.listingType || "").localeCompare(String(right.listingType || ""));
      if (typeCompare !== 0) return typeCompare;
      return normalizeMinNumber(left.minPropertyValue, 0) - normalizeMinNumber(right.minPropertyValue, 0);
    }));
    notify("Fee bands sorted by type then minimum value.", "info");
  };

  const handleSortDiscounts = () => {
    setDiscounts((prev) => [...prev].sort(
      (left, right) => normalizeMinNumber(left.minMonths, 1) - normalizeMinNumber(right.minMonths, 1)
    ));
    notify("Discount bands sorted by minimum months.", "info");
  };

  const handleAutoFixRuleOverlaps = () => {
    let totalAdjustments = 0;
    setRules((prev) => {
      const next = prev.map((item) => ({ ...item }));
      ["rent", "lease"].forEach((listingType) => {
        const activeIndexes = [];
        next.forEach((item, index) => {
          if (item.isActive && item.listingType === listingType) activeIndexes.push(index);
        });
        activeIndexes.sort(
          (a, b) => normalizeMinNumber(next[a].minPropertyValue, 0) - normalizeMinNumber(next[b].minPropertyValue, 0)
        );
        for (let index = 0; index < activeIndexes.length - 1; index += 1) {
          const curr = next[activeIndexes[index]];
          const following = next[activeIndexes[index + 1]];
          const currMin = normalizeMinNumber(curr.minPropertyValue, 0);
          const currMax = normalizeMaxNumber(curr.maxPropertyValue);
          const nextMin = normalizeMinNumber(following.minPropertyValue, 0);
          if (currMax === null || currMax >= nextMin) {
            const proposed = String(Math.max(currMin, Number((nextMin - 0.01).toFixed(2))));
            if (curr.maxPropertyValue !== proposed) {
              curr.maxPropertyValue = proposed;
              totalAdjustments += 1;
            }
          }
        }
      });
      return next;
    });
    if (totalAdjustments > 0) {
      notify(`Auto-fix updated ${totalAdjustments} fee band bound${totalAdjustments === 1 ? "" : "s"}.`, "success");
    } else {
      notify("No fee band overlaps detected to fix.", "info");
    }
  };

  const handleAutoFixDiscountOverlaps = () => {
    let totalAdjustments = 0;
    setDiscounts((prev) => {
      const next = prev.map((item) => ({ ...item }));
      const activeIndexes = [];
      next.forEach((item, index) => { if (item.isActive) activeIndexes.push(index); });
      activeIndexes.sort(
        (a, b) => normalizeMinNumber(next[a].minMonths, 1) - normalizeMinNumber(next[b].minMonths, 1)
      );
      for (let index = 0; index < activeIndexes.length - 1; index += 1) {
        const curr = next[activeIndexes[index]];
        const following = next[activeIndexes[index + 1]];
        const currMin = Math.max(1, Math.trunc(normalizeMinNumber(curr.minMonths, 1)));
        const currMax = normalizeMaxNumber(curr.maxMonths);
        const nextMin = Math.max(1, Math.trunc(normalizeMinNumber(following.minMonths, 1)));
        if (currMax === null || currMax >= nextMin) {
          const proposed = String(Math.max(currMin, nextMin - 1));
          if (curr.maxMonths !== proposed) {
            curr.maxMonths = proposed;
            totalAdjustments += 1;
          }
        }
      }
      return next;
    });
    if (totalAdjustments > 0) {
      notify(`Auto-fix updated ${totalAdjustments} discount bound${totalAdjustments === 1 ? "" : "s"}.`, "success");
    } else {
      notify("No discount band overlaps detected to fix.", "info");
    }
  };

  const summary = useMemo(() => {
    const activeRent = rules.filter((item) => item.isActive && item.listingType === "rent").length;
    const activeLease = rules.filter((item) => item.isActive && item.listingType === "lease").length;
    const activeDiscounts = discounts.filter((item) => item.isActive).length;
    const totalRules = rules.length;
    const totalDiscounts = discounts.length;
    return { activeRent, activeLease, activeDiscounts, totalRules, totalDiscounts };
  }, [rules, discounts]);

  const overlapState = useMemo(() => {
    const rentConflict = new Set();
    const leaseConflict = new Set();
    const discountConflict = new Set();

    const markRuleConflicts = (type, dest) => {
      const active = [];
      rules.forEach((item, index) => {
        if (item.isActive && item.listingType === type) {
          const min = item.minPropertyValue === "" ? 0 : Number(item.minPropertyValue);
          const max = item.maxPropertyValue === "" ? null : Number(item.maxPropertyValue);
          active.push({ index, min, max });
        }
      });
      for (let i = 0; i < active.length; i += 1) {
        for (let j = i + 1; j < active.length; j += 1) {
          if (hasOverlap(active[i].min, active[i].max, active[j].min, active[j].max)) {
            dest.add(active[i].index);
            dest.add(active[j].index);
          }
        }
      }
    };

    markRuleConflicts("rent", rentConflict);
    markRuleConflicts("lease", leaseConflict);

    const activeDsc = [];
    discounts.forEach((item, index) => {
      if (item.isActive) {
        activeDsc.push({ index, min: Number(item.minMonths), max: item.maxMonths === "" ? null : Number(item.maxMonths) });
      }
    });
    for (let i = 0; i < activeDsc.length; i += 1) {
      for (let j = i + 1; j < activeDsc.length; j += 1) {
        if (hasOverlap(activeDsc[i].min, activeDsc[i].max, activeDsc[j].min, activeDsc[j].max)) {
          discountConflict.add(activeDsc[i].index);
          discountConflict.add(activeDsc[j].index);
        }
      }
    }

    return { rentConflict, leaseConflict, discountConflict };
  }, [rules, discounts]);

  const hasAnyConflict =
    overlapState.rentConflict.size > 0 ||
    overlapState.leaseConflict.size > 0 ||
    overlapState.discountConflict.size > 0;

  const handleSave = async () => {
    if (rules.length === 0 || discounts.length === 0) {
      notify("Add at least one pricing rule and one duration discount before saving.", "warning");
      return;
    }

    const payload = {
      rules: rules.map((item) => ({
        listingType: item.listingType,
        minPropertyValue: item.minPropertyValue === "" ? 0 : Number(item.minPropertyValue),
        maxPropertyValue: item.maxPropertyValue === "" ? null : Number(item.maxPropertyValue),
        monthlyFeeUsd: Number(item.monthlyFeeUsd),
        isActive: Boolean(item.isActive)
      })),
      discounts: discounts.map((item) => ({
        minMonths: Number(item.minMonths),
        maxMonths: item.maxMonths === "" ? null : Number(item.maxMonths),
        discountPercent: Number(item.discountPercent),
        isActive: Boolean(item.isActive)
      }))
    };

    const activeRent = payload.rules.filter((item) => item.isActive && item.listingType === "rent");
    const activeLease = payload.rules.filter((item) => item.isActive && item.listingType === "lease");
    const activeDsc = payload.discounts.filter((item) => item.isActive);

    if (activeRent.length === 0 || activeLease.length === 0) {
      notify("Keep at least one active pricing band for rent and one for lease.", "warning");
      return;
    }
    if (activeDsc.length === 0) {
      notify("Keep at least one active duration discount band.", "warning");
      return;
    }

    const validateOverlaps = (items, minKey, maxKey) => {
      for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
          if (hasOverlap(items[i][minKey], items[i][maxKey], items[j][minKey], items[j][maxKey])) return true;
        }
      }
      return false;
    };

    if (validateOverlaps(activeRent, "minPropertyValue", "maxPropertyValue")) {
      notify("Rent fee bands overlap. Adjust value ranges before saving.", "warning");
      return;
    }
    if (validateOverlaps(activeLease, "minPropertyValue", "maxPropertyValue")) {
      notify("Lease fee bands overlap. Adjust value ranges before saving.", "warning");
      return;
    }
    if (validateOverlaps(activeDsc, "minMonths", "maxMonths")) {
      notify("Duration discount bands overlap. Adjust month ranges before saving.", "warning");
      return;
    }

    setIsSaving(true);
    try {
      await updateListingPricingConfiguration(payload);
      notify("Listing pricing configuration saved successfully.", "success");
      await loadPricing();
    } catch (error) {
      notify(error.message || "Could not update listing pricing configuration.", "danger");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PortalLayout
      title="Listing Pricing"
      subtitle="Set monthly listing fees by property value range and define duration-based discount tiers."
    >

      {/* ── Summary stat row ── */}
      <div className="kr-pricing-stat-row">
        <div className="kr-pricing-stat kr-pricing-stat--blue">
          <div className="kr-pricing-stat-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <div>
            <p className="kr-pricing-stat-value">{summary.activeRent}</p>
            <p className="kr-pricing-stat-label">Active Rent Bands</p>
          </div>
        </div>

        <div className="kr-pricing-stat kr-pricing-stat--amber">
          <div className="kr-pricing-stat-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2"/>
              <path d="M16 7V5a2 2 0 0 0-4 0v2"/>
              <path d="M12 12v3"/>
            </svg>
          </div>
          <div>
            <p className="kr-pricing-stat-value">{summary.activeLease}</p>
            <p className="kr-pricing-stat-label">Active Lease Bands</p>
          </div>
        </div>

        <div className="kr-pricing-stat kr-pricing-stat--green">
          <div className="kr-pricing-stat-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
              <polyline points="17 6 23 6 23 12"/>
            </svg>
          </div>
          <div>
            <p className="kr-pricing-stat-value">{summary.activeDiscounts}</p>
            <p className="kr-pricing-stat-label">Duration Discounts</p>
          </div>
        </div>

        <div className={`kr-pricing-stat ${hasAnyConflict ? "kr-pricing-stat--red" : "kr-pricing-stat--purple"}`}>
          <div className="kr-pricing-stat-icon">
            {hasAnyConflict ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
          </div>
          <div>
            <p className="kr-pricing-stat-value">{hasAnyConflict ? "Conflict" : "Clean"}</p>
            <p className="kr-pricing-stat-label">{hasAnyConflict ? "Overlaps detected" : "No overlaps"}</p>
          </div>
        </div>
      </div>

      {/* ── Value-based fee bands ── */}
      <div className="kr-pricing-section">
        <div className="kr-pricing-section-head">
          <div className="kr-pricing-section-head-left">
            <SectionIcon color="blue">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23"/>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </SectionIcon>
            <div>
              <h2 className="kr-pricing-section-title">Value-based monthly fees</h2>
              <p className="kr-pricing-section-sub">
                Different property value ranges carry different monthly listing charges. Each range must be non-overlapping.
              </p>
            </div>
          </div>
          <div className="kr-pricing-section-actions">
            <ActionBtn onClick={handleSortRules} title="Sort bands by type then minimum value" variant="ghost">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="15" y2="12"/>
                <line x1="3" y1="18" x2="9" y2="18"/>
              </svg>
              Sort
            </ActionBtn>
            <ActionBtn onClick={handleAutoFixRuleOverlaps} title="Automatically adjust band upper bounds to remove overlaps" variant="amber">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
              Auto-fix
            </ActionBtn>
            <ActionBtn onClick={() => setRules((prev) => [...prev, { ...EMPTY_RULE }])} variant="primary">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add band
            </ActionBtn>
          </div>
        </div>

        {isLoading ? (
          <div className="kr-pricing-loading">
            <span className="kr-portal-state-spinner" />
            <span>Loading fee bands…</span>
          </div>
        ) : rules.length === 0 ? (
          <div className="kr-pricing-empty">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            <p>No fee bands yet. Add one to get started.</p>
          </div>
        ) : (
          <>
            <div className="kr-pricing-grid-header kr-pricing-grid-header--rules">
              <span>Type</span>
              <span>Min Value (KSh)</span>
              <span>Max Value (KSh)</span>
              <span>Monthly Fee (USD)</span>
              <span>Active</span>
              <span />
            </div>
            <div className="kr-pricing-rows">
              {rules.map((rule, index) => {
                const isConflict = overlapState.rentConflict.has(index) || overlapState.leaseConflict.has(index);
                return (
                  <div
                    key={`rule-${rule.id || "new"}-${index}`}
                    className={`kr-pricing-row${isConflict ? " kr-pricing-row--conflict" : ""}${!rule.isActive ? " kr-pricing-row--inactive" : ""}`}
                  >
                    <div className="kr-pricing-row-field">
                      <select
                        className="kr-pricing-select"
                        value={rule.listingType}
                        onChange={(event) => updateRule(index, "listingType", event.target.value)}
                      >
                        <option value="rent">Rent</option>
                        <option value="lease">Lease</option>
                      </select>
                      <span className={`kr-pricing-type-badge kr-pricing-type-badge--${rule.listingType}`}>
                        {rule.listingType}
                      </span>
                    </div>
                    <div className="kr-pricing-row-field">
                      <label className="kr-pricing-mobile-label">Min Value</label>
                      <input
                        className="kr-pricing-input"
                        type="number"
                        min="0"
                        placeholder="0"
                        value={rule.minPropertyValue}
                        onChange={(event) => updateRule(index, "minPropertyValue", event.target.value)}
                      />
                    </div>
                    <div className="kr-pricing-row-field">
                      <label className="kr-pricing-mobile-label">Max Value</label>
                      <input
                        className="kr-pricing-input"
                        type="number"
                        min="0"
                        placeholder="No limit"
                        value={rule.maxPropertyValue}
                        onChange={(event) => updateRule(index, "maxPropertyValue", event.target.value)}
                      />
                    </div>
                    <div className="kr-pricing-row-field">
                      <label className="kr-pricing-mobile-label">Monthly Fee (USD)</label>
                      <div className="kr-pricing-input-prefix-wrap">
                        <span className="kr-pricing-input-prefix">$</span>
                        <input
                          className="kr-pricing-input kr-pricing-input--prefixed"
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="0.00"
                          value={rule.monthlyFeeUsd}
                          onChange={(event) => updateRule(index, "monthlyFeeUsd", event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="kr-pricing-row-field kr-pricing-row-field--toggle">
                      <PillToggle
                        checked={rule.isActive}
                        onChange={(val) => updateRule(index, "isActive", val)}
                      />
                    </div>
                    <div className="kr-pricing-row-field kr-pricing-row-field--actions">
                      {isConflict && (
                        <span className="kr-pricing-conflict-badge">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                          </svg>
                          Overlap
                        </span>
                      )}
                      <button
                        type="button"
                        className="kr-pricing-remove-btn"
                        title="Remove this fee band"
                        onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {(overlapState.rentConflict.size > 0 || overlapState.leaseConflict.size > 0) && (
          <div className="kr-pricing-alert">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Active fee bands overlap. Use <strong>Auto-fix</strong> or adjust the highlighted rows manually.
          </div>
        )}
      </div>

      {/* ── Duration discounts ── */}
      <div className="kr-pricing-section">
        <div className="kr-pricing-section-head">
          <div className="kr-pricing-section-head-left">
            <SectionIcon color="green">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                <polyline points="17 6 23 6 23 12"/>
              </svg>
            </SectionIcon>
            <div>
              <h2 className="kr-pricing-section-title">Duration discounts</h2>
              <p className="kr-pricing-section-sub">
                Reward longer listing periods with tiered discounts. Ranges must not overlap.
              </p>
            </div>
          </div>
          <div className="kr-pricing-section-actions">
            <ActionBtn onClick={handleSortDiscounts} title="Sort by minimum months" variant="ghost">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="15" y2="12"/>
                <line x1="3" y1="18" x2="9" y2="18"/>
              </svg>
              Sort
            </ActionBtn>
            <ActionBtn onClick={handleAutoFixDiscountOverlaps} title="Automatically adjust discount upper bounds to remove overlaps" variant="amber">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
              Auto-fix
            </ActionBtn>
            <ActionBtn onClick={() => setDiscounts((prev) => [...prev, { ...EMPTY_DISCOUNT }])} variant="primary">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add band
            </ActionBtn>
          </div>
        </div>

        {isLoading ? (
          <div className="kr-pricing-loading">
            <span className="kr-portal-state-spinner" />
            <span>Loading discounts…</span>
          </div>
        ) : discounts.length === 0 ? (
          <div className="kr-pricing-empty">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
              <polyline points="17 6 23 6 23 12"/>
            </svg>
            <p>No discount bands yet. Add one to get started.</p>
          </div>
        ) : (
          <>
            <div className="kr-pricing-grid-header kr-pricing-grid-header--discounts">
              <span>Min Months</span>
              <span>Max Months</span>
              <span>Discount (%)</span>
              <span>Active</span>
              <span />
            </div>
            <div className="kr-pricing-rows">
              {discounts.map((discount, index) => {
                const isConflict = overlapState.discountConflict.has(index);
                return (
                  <div
                    key={`discount-${discount.id || "new"}-${index}`}
                    className={`kr-pricing-row${isConflict ? " kr-pricing-row--conflict" : ""}${!discount.isActive ? " kr-pricing-row--inactive" : ""}`}
                  >
                    <div className="kr-pricing-row-field">
                      <label className="kr-pricing-mobile-label">Min Months</label>
                      <input
                        className="kr-pricing-input"
                        type="number"
                        min="1"
                        placeholder="1"
                        value={discount.minMonths}
                        onChange={(event) => updateDiscount(index, "minMonths", event.target.value)}
                      />
                    </div>
                    <div className="kr-pricing-row-field">
                      <label className="kr-pricing-mobile-label">Max Months</label>
                      <input
                        className="kr-pricing-input"
                        type="number"
                        min="1"
                        placeholder="No limit"
                        value={discount.maxMonths}
                        onChange={(event) => updateDiscount(index, "maxMonths", event.target.value)}
                      />
                    </div>
                    <div className="kr-pricing-row-field">
                      <label className="kr-pricing-mobile-label">Discount (%)</label>
                      <div className="kr-pricing-input-prefix-wrap">
                        <input
                          className="kr-pricing-input kr-pricing-input--suffixed"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="0"
                          value={discount.discountPercent}
                          onChange={(event) => updateDiscount(index, "discountPercent", event.target.value)}
                        />
                        <span className="kr-pricing-input-suffix">%</span>
                      </div>
                    </div>
                    <div className="kr-pricing-row-field kr-pricing-row-field--toggle">
                      <PillToggle
                        checked={discount.isActive}
                        onChange={(val) => updateDiscount(index, "isActive", val)}
                      />
                    </div>
                    <div className="kr-pricing-row-field kr-pricing-row-field--actions">
                      {isConflict && (
                        <span className="kr-pricing-conflict-badge">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                          </svg>
                          Overlap
                        </span>
                      )}
                      <button
                        type="button"
                        className="kr-pricing-remove-btn"
                        title="Remove this discount band"
                        onClick={() => setDiscounts((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {overlapState.discountConflict.size > 0 && (
          <div className="kr-pricing-alert">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Active discount bands overlap. Use <strong>Auto-fix</strong> or adjust the highlighted rows manually.
          </div>
        )}
      </div>

      {/* ── Sticky save bar ── */}
      <div className="kr-pricing-save-bar">
        <div className="kr-pricing-save-bar-info">
          <span className="kr-pricing-save-bar-counts">
            {summary.totalRules} fee band{summary.totalRules === 1 ? "" : "s"}
            {" · "}
            {summary.totalDiscounts} discount band{summary.totalDiscounts === 1 ? "" : "s"}
          </span>
          {hasAnyConflict && (
            <span className="kr-pricing-save-bar-warning">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              Overlaps will prevent saving
            </span>
          )}
        </div>
        <button
          type="button"
          className="kr-pricing-save-btn"
          onClick={handleSave}
          disabled={isSaving || isLoading}
        >
          {isSaving ? (
            <>
              <span className="kr-pricing-save-spinner" />
              Saving…
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              Save Pricing
            </>
          )}
        </button>
      </div>

    </PortalLayout>
  );
}

export default AdminPricingPage;
