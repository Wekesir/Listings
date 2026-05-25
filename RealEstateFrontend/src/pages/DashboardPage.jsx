import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PortalLayout from "../components/PortalLayout";
import { getStoredUser } from "../utils/session";
import {
  getProperties,
  getPropertiesForAdmin,
  getShortlistedProperties,
  getMyListingEngagement
} from "../services/propertyService";
import { getAnalyticsSummary } from "../services/analyticsService";
import { getAuthAuditLogs, getManageableUsers } from "../services/authService";
import { getRealtimeSocket } from "../services/realtimeSocket";
import { notify } from "../utils/notify";

function getSuggestedMatchCount(shortlistedProperties, allProperties) {
  if (!Array.isArray(shortlistedProperties) || shortlistedProperties.length === 0) return 0;
  if (!Array.isArray(allProperties) || allProperties.length === 0) return 0;

  const shortlistedIds = new Set(shortlistedProperties.map((item) => Number(item.id)));
  const preferredLocations = new Set(
    shortlistedProperties.map((item) => String(item.location || "").trim().toLowerCase()).filter(Boolean)
  );
  const preferredTypes = new Set(
    shortlistedProperties.map((item) => String(item.type || "").trim().toLowerCase()).filter(Boolean)
  );

  const candidates = allProperties.filter((item) => {
    if (shortlistedIds.has(Number(item.id))) return false;
    const loc = String(item.location || "").trim().toLowerCase();
    const typ = String(item.type || "").trim().toLowerCase();
    return preferredLocations.has(loc) || preferredTypes.has(typ);
  });

  return Math.min(5, candidates.length);
}

function IcoGrid() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  );
}
function IcoBan() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>; }
function IcoUsers() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/></svg>; }
function IcoLogs() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12h6"/><path d="M9 16h6"/><path d="M9 8h6"/><path d="M5 3h14a2 2 0 0 1 2 2v14l-4-2-4 2-4-2-4 2V5a2 2 0 0 1 2-2z"/></svg>; }
function IcoStar() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>; }
function IcoPin() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>; }
function IcoArrow() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>; }
function IcoRefresh() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>; }
function IcoFlag() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>; }

function SectionHead({ eyebrow, title }) {
  return (
    <div className="kr-db-section-head">
      <span className="kr-db-section-eyebrow">{eyebrow}</span>
      <h2 className="kr-db-section-title">{title}</h2>
    </div>
  );
}

function DashboardPage() {
  const navigate = useNavigate();
  const user = useMemo(() => getStoredUser(), []);
  const displayName = user?.fullName?.split(" ")[0] || "User";
  const isAdmin = user?.accountType === "admin";

  const [analyticsSummary, setAnalyticsSummary] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [engagementSummary, setEngagementSummary] = useState(null);
  const [engagementLoading, setEngagementLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [allProperties, setAllProperties] = useState([]);
  const [shortlistedPropertyIds, setShortlistedPropertyIds] = useState([]);
  const [adminManageableUsers, setAdminManageableUsers] = useState([]);
  const [adminAuditEvents24h, setAdminAuditEvents24h] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setDashboardLoading(true);
      try {
        const propPromise = isAdmin ? getPropertiesForAdmin(true) : getProperties();
        const shortPromise = getShortlistedProperties();
        const usersPromise = isAdmin ? getManageableUsers() : Promise.resolve(null);
        const now = new Date();
        const ago24 = new Date(now.getTime() - 86400000);
        const auditPromise = isAdmin
          ? getAuthAuditLogs({ page: 1, limit: 1, fromDate: ago24.toISOString() })
          : Promise.resolve(null);

        const [props, shortlist, users, audit] = await Promise.all([
          propPromise, shortPromise, usersPromise, auditPromise
        ]);

        if (!active) return;
        setAllProperties(Array.isArray(props) ? props : []);
        setShortlistedPropertyIds(
          Array.isArray(shortlist?.propertyIds)
            ? shortlist.propertyIds.map(Number).filter((v) => Number.isFinite(v))
            : []
        );
        setAdminManageableUsers(Array.isArray(users?.data) ? users.data : []);
        setAdminAuditEvents24h(Number(audit?.pagination?.total || 0));
        setLastRefreshedAt(new Date());
      } catch {
        if (active) notify("Some dashboard insights could not be loaded.", "warning");
      } finally {
        if (active) setDashboardLoading(false);
      }
    };

    void load();
    return () => { active = false; };
  }, [isAdmin, refreshNonce]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setAnalyticsLoading(true);
      try {
        const summary = await getAnalyticsSummary();
        if (active) setAnalyticsSummary(summary);
      } catch {
        if (active) setAnalyticsSummary(null);
      } finally {
        if (active) setAnalyticsLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [refreshNonce]);

  useEffect(() => {
    if (isAdmin) {
      setEngagementSummary(null);
      setEngagementLoading(false);
      return undefined;
    }

    let active = true;
    const load = async () => {
      setEngagementLoading(true);
      try {
        const summary = await getMyListingEngagement();
        if (active) setEngagementSummary(summary);
      } catch {
        if (active) setEngagementSummary(null);
      } finally {
        if (active) setEngagementLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [isAdmin, refreshNonce]);

  useEffect(() => {
    if (isAdmin) return undefined;
    const socket = getRealtimeSocket();
    let refreshTimeout = null;
    const handleMetricsUpdated = () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      refreshTimeout = setTimeout(() => {
        setRefreshNonce((prev) => prev + 1);
      }, 300);
    };
    socket.on("listings:metrics-updated", handleMetricsUpdated);
    return () => {
      socket.off("listings:metrics-updated", handleMetricsUpdated);
      if (refreshTimeout) clearTimeout(refreshTimeout);
    };
  }, [isAdmin]);

  const triggerDashboardRefresh = () => setRefreshNonce((prev) => prev + 1);
  const isRefreshing = dashboardLoading || analyticsLoading || engagementLoading;

  const shortlistedProperties = useMemo(() => {
    if (!allProperties.length) return [];
    const ids = new Set(shortlistedPropertyIds.map(Number));
    return allProperties.filter((item) => ids.has(Number(item.id)));
  }, [allProperties, shortlistedPropertyIds]);

  const listingStats = useMemo(() => {
    const active = allProperties.filter((item) => !item?.isSoftDeleted);
    const deleted = allProperties.filter((item) => Boolean(item?.isSoftDeleted));

    if (isAdmin) {
      return {
        activeCount: active.length,
        softDeletedCount: deleted.length,
        restrictedUsersCount: adminManageableUsers.filter((u) => u?.isBanned || u?.isSuspended).length,
        audit24hCount: adminAuditEvents24h
      };
    }

    const myId = Number(user?.id);
    return {
      myListingsCount: allProperties.filter((item) => Number(item?.ownerId) === myId).length,
      allListingsCount: active.length,
      shortlistedCount: shortlistedPropertyIds.length,
      suggestionCount: getSuggestedMatchCount(shortlistedProperties, active)
    };
  }, [allProperties, isAdmin, adminManageableUsers, adminAuditEvents24h, shortlistedPropertyIds, user?.id, shortlistedProperties]);

  const statCards = useMemo(() => {
    if (isAdmin) {
      return [
        { label: "Active Listings", value: listingStats.activeCount, sub: "Visible to all users", color: "blue", icon: <IcoGrid />, link: "/listings" },
        { label: "Soft Deleted", value: listingStats.softDeletedCount, sub: "Under admin moderation", color: "amber", icon: <IcoBan />, link: "/listings" },
        { label: "Restricted Users", value: listingStats.restrictedUsersCount, sub: "Suspended or banned", color: "red", icon: <IcoUsers />, link: "/admin/user-access" },
        { label: "Auth Events (24 h)", value: listingStats.audit24hCount, sub: "Login/logout activity", color: "green", icon: <IcoLogs />, link: "/admin/audit-logs" }
      ];
    }

    return [
      { label: "My Listings", value: listingStats.myListingsCount, sub: "Published by you", color: "blue", icon: <IcoGrid />, link: "/listings" },
      { label: "All Listings", value: listingStats.allListingsCount, sub: "Live marketplace", color: "purple", icon: <IcoGrid />, link: "/listings" },
      { label: "Shortlisted", value: listingStats.shortlistedCount, sub: "Saved for follow-up", color: "green", icon: <IcoStar />, link: "/shortlist" },
      { label: "Suggested Matches", value: listingStats.suggestionCount, sub: "Based on shortlist", color: "amber", icon: <IcoPin />, link: "/shortlist" }
    ];
  }, [isAdmin, listingStats]);

  const engagementCards = useMemo(() => {
    if (isAdmin) return [];
    const totals = engagementSummary?.totals || {};
    return [
      {
        label: "Property views",
        value: Number(totals.views || 0),
        helper: "Unique tracked detail-page visits"
      },
      {
        label: "Interested (shortlist)",
        value: Number(totals.interestedShortlist || 0),
        helper: "Users who saved your listings"
      },
      {
        label: "Interested (inquiry)",
        value: Number(totals.interestedInquiry || 0),
        helper: "Users who started inquiry threads"
      },
      {
        label: "Reached out",
        value: Number(totals.reachedOut || 0),
        helper: "Users who sent inquiry messages"
      }
    ];
  }, [isAdmin, engagementSummary]);

  const topEngagementListings = useMemo(() => {
    const listings = Array.isArray(engagementSummary?.listings) ? engagementSummary.listings : [];
    return listings
      .map((item) => ({
        ...item,
        score:
          Number(item?.views || 0) +
          Number(item?.interestedShortlist || 0) * 2 +
          Number(item?.interestedInquiry || 0) * 3 +
          Number(item?.reachedOut || 0) * 4
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [engagementSummary]);

  const actionTiles = useMemo(() => {
    const tiles = [
      { title: "Manage Listings", sub: "Create listings and switch between My Listings / All Listings", icon: <IcoGrid />, color: "blue", link: "/listings" },
      { title: "My Shortlist", sub: "Review saved listings and suggestions", icon: <IcoStar />, color: "green", link: "/shortlist" }
    ];

    if (isAdmin) {
      tiles.push(
        { title: "Manage User Access", sub: "Suspend, ban, or reinstate accounts", icon: <IcoUsers />, color: "amber", link: "/admin/user-access" },
        { title: "Listing Reports", sub: "Review complaints and moderate listings or listers", icon: <IcoFlag />, color: "purple", link: "/admin/listing-reports" },
        { title: "Review Audit Logs", sub: "Track auth events and clean up logs", icon: <IcoLogs />, color: "red", link: "/admin/audit-logs" }
      );
    }

    return tiles;
  }, [isAdmin]);

  return (
    <PortalLayout
      title={isAdmin ? "Admin Dashboard" : "Lister Dashboard"}
      subtitle={
        isAdmin
          ? `Welcome back, ${displayName}. Here's a real-time overview of platform activity.`
          : `Welcome back, ${displayName}. Listing creation now happens from the Listings screen.`
      }
    >
      <div className="kr-db-refresh-bar">
        <span className="kr-db-refresh-ts">
          {lastRefreshedAt ? <>Updated {lastRefreshedAt.toLocaleString("en-KE")}</> : "Loading…"}
        </span>
        <button
          type="button"
          className={`kr-db-refresh-btn${isRefreshing ? " is-spinning" : ""}`}
          onClick={triggerDashboardRefresh}
          disabled={isRefreshing}
          title="Refresh dashboard data"
        >
          <span className="kr-db-refresh-ico"><IcoRefresh /></span>
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="kr-db-section-row">
        <SectionHead eyebrow="Overview" title="Platform snapshot" />
        <div className="row g-3 mt-0">
          {statCards.map((card) => {
            const inner = (
              <div className={`kr-db-stat-card kr-db-stat-card--${card.color}`}>
                <div className="kr-db-stat-top">
                  <span className={`kr-db-stat-icon kr-db-stat-icon--${card.color}`}>{card.icon}</span>
                  <span className="kr-db-stat-sub">{card.sub}</span>
                </div>
                <p className="kr-db-stat-value">
                  {dashboardLoading ? <span className="kr-db-skel" /> : card.value}
                </p>
                <p className="kr-db-stat-label">{card.label}</p>
              </div>
            );
            return (
              <div className="col-sm-6 col-xl-3" key={card.label}>
                {card.link
                  ? <button type="button" className="kr-db-stat-btn" onClick={() => navigate(card.link)}>{inner}</button>
                  : inner}
              </div>
            );
          })}
        </div>
      </div>

      {!isAdmin && (
        <div className="kr-db-section-row">
          <SectionHead eyebrow="Performance" title="Live listing engagement" />
          <div className="kr-db-analytics-card">
            <div className="kr-db-analytics-live">
              <span className="kr-db-analytics-live-dot" />
              Real-time updates
            </div>
            {engagementLoading ? (
              <div className="kr-db-analytics-grid">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="kr-db-analytics-metric">
                    <span className="kr-db-skel kr-db-skel--sm" />
                    <span className="kr-db-skel kr-db-skel--lg" style={{ marginTop: "0.5rem" }} />
                  </div>
                ))}
              </div>
            ) : engagementSummary ? (
              <>
                <div className="kr-db-analytics-grid">
                  {engagementCards.map((metric) => (
                    <div className="kr-db-analytics-metric" key={metric.label}>
                      <span className="kr-db-analytics-metric-label">{metric.label}</span>
                      <span className="kr-db-analytics-metric-value">{metric.value.toLocaleString("en-KE")}</span>
                      <span className="kr-db-stat-sub">{metric.helper}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <p className="kr-db-panel-title" style={{ marginBottom: "0.5rem" }}>Top-performing listings</p>
                  {topEngagementListings.length ? (
                    <div className="kr-db-actions-grid">
                      {topEngagementListings.map((item) => (
                        <button
                          type="button"
                          key={item.propertyId}
                          className="kr-db-action-tile kr-db-action-tile--blue"
                          onClick={() => navigate("/listings")}
                        >
                          <span className="kr-db-action-body">
                            <span className="kr-db-action-title">{item.title || `Listing #${item.propertyId}`}</span>
                            <span className="kr-db-action-sub">
                              {Number(item.views || 0)} views · {Number(item.interestedShortlist || 0)} shortlist · {Number(item.interestedInquiry || 0)} inquiry interest · {Number(item.reachedOut || 0)} reached out
                            </span>
                          </span>
                          <span className="kr-db-action-arrow"><IcoArrow /></span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="kr-db-analytics-empty">Your listing engagement metrics will appear after visitors interact with your properties.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="kr-db-analytics-empty">Listing engagement metrics are currently unavailable.</p>
            )}
          </div>
        </div>
      )}

      <div className="kr-db-section-row">
        <SectionHead eyebrow="Navigation" title="Quick actions" />
        <div className="kr-db-actions-grid">
          {actionTiles.map((tile) => (
            <button
              key={tile.title}
              type="button"
              className={`kr-db-action-tile kr-db-action-tile--${tile.color}`}
              onClick={() => navigate(tile.link)}
            >
              <span className={`kr-db-action-icon kr-db-action-icon--${tile.color}`}>{tile.icon}</span>
              <span className="kr-db-action-body">
                <span className="kr-db-action-title">{tile.title}</span>
                <span className="kr-db-action-sub">{tile.sub}</span>
              </span>
              <span className="kr-db-action-arrow"><IcoArrow /></span>
            </button>
          ))}
        </div>
      </div>

      <div className="kr-db-section-row">
        <SectionHead eyebrow={isAdmin ? "Admin" : "Lister"} title="Listing workflow" />
        <div className="kr-db-panel">
          <div className="kr-db-panel-head">
            <div className="kr-db-panel-head-left">
              <p className="kr-db-panel-title">
                {isAdmin ? "Listing moderation workspace" : "Create new listings from the Listings page"}
              </p>
              <p className="kr-db-panel-sub">
                {isAdmin
                  ? "Use Listings to review all entries, including soft-deleted records."
                  : "Go to Listings and use the create listing form. You can also switch between My Listings and All Listings tabs there."}
              </p>
            </div>
            <button type="button" className="kr-db-submit" onClick={() => navigate("/listings")}>Open Listings</button>
          </div>
        </div>
      </div>

      <div className="kr-db-section-row">
        <SectionHead eyebrow="Monetization" title="Premium CTA performance" />
        <div className="kr-db-analytics-card">
          <div className="kr-db-analytics-live">
            <span className="kr-db-analytics-live-dot" />
            Live data
          </div>
          {analyticsLoading ? (
            <div className="kr-db-analytics-grid">
              {[1, 2, 3].map((n) => (
                <div key={n} className="kr-db-analytics-metric">
                  <span className="kr-db-skel kr-db-skel--sm" />
                  <span className="kr-db-skel kr-db-skel--lg" style={{ marginTop: "0.5rem" }} />
                </div>
              ))}
            </div>
          ) : analyticsSummary ? (
            <div className="kr-db-analytics-grid">
              <div className="kr-db-analytics-metric">
                <span className="kr-db-analytics-metric-label">All-time clicks</span>
                <span className="kr-db-analytics-metric-value">{Number(analyticsSummary?.totals?.premiumUpgradeCtaClicks || 0).toLocaleString("en-KE")}</span>
              </div>
              <div className="kr-db-analytics-metric">
                <span className="kr-db-analytics-metric-label">Last 24 hours</span>
                <span className="kr-db-analytics-metric-value">{Number(analyticsSummary?.windows?.last24h || 0).toLocaleString("en-KE")}</span>
              </div>
              <div className="kr-db-analytics-metric">
                <span className="kr-db-analytics-metric-label">Last 7 days</span>
                <span className="kr-db-analytics-metric-value">{Number(analyticsSummary?.windows?.last7d || 0).toLocaleString("en-KE")}</span>
              </div>
            </div>
          ) : (
            <p className="kr-db-analytics-empty">Analytics unavailable. Events are still captured in the background.</p>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}

export default DashboardPage;
