import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { logoutAccount } from "../services/authService";
import { getMyUnreadMessageCount } from "../services/messageService";
import { getRealtimeSocket } from "../services/realtimeSocket";
import { notify } from "../utils/notify";
import {
  clearStoredSessionMeta,
  clearStoredUser,
  getStoredTheme,
  getStoredUser,
  setStoredTheme
} from "../utils/session";
import { ACCESS_ACTIONS, MODULE_KEYS, canAccessModule } from "../utils/accessControl";

const NAV_ITEMS = [
  {
    to: "/dashboard",
    label: "Dashboard",
    roles: ["lister", "admin"],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    )
  },
  {
    to: "/listings",
    label: "Listings",
    roles: ["viewer", "lister", "admin"],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
      </svg>
    )
  },
  {
    to: "/shortlist",
    label: "Shortlist",
    roles: ["viewer", "lister", "admin"],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    )
  },
  {
    to: "/finances",
    label: "Finances",
    roles: ["lister", "admin"],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    )
  },
  {
    to: "/messages",
    label: "Messages",
    roles: ["viewer", "lister"],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    )
  },
  {
    to: "/messages",
    label: "Conversation Oversight",
    roles: ["admin", "employee"],
    moduleKey: MODULE_KEYS.ADMIN_MESSAGES,
    action: ACCESS_ACTIONS.VIEW,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 10h8" />
        <path d="M8 14h5" />
        <path d="M21 12c0 4.97-4.03 9-9 9-1.53 0-2.97-.38-4.23-1.05L3 21l1.3-4.13A8.96 8.96 0 0 1 3 12c0-4.97 4.03-9 9-9s9 4.03 9 9z" />
      </svg>
    )
  },
  {
    to: "/admin/user-access",
    label: "User Access",
    roles: ["admin", "employee"],
    moduleKey: MODULE_KEYS.USER_ACCESS,
    action: ACCESS_ACTIONS.VIEW,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="8.5" cy="7" r="4"/>
        <line x1="20" y1="8" x2="20" y2="14"/>
        <line x1="17" y1="11" x2="23" y2="11"/>
      </svg>
    )
  },
  {
    to: "/admin/listing-reports",
    label: "Reports",
    roles: ["admin", "employee"],
    moduleKey: MODULE_KEYS.LISTING_REPORTS,
    action: ACCESS_ACTIONS.VIEW,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
        <line x1="4" y1="22" x2="4" y2="15"/>
      </svg>
    )
  },
  {
    to: "/admin/audit-logs",
    label: "Audit Logs",
    roles: ["admin", "employee"],
    moduleKey: MODULE_KEYS.AUDIT_LOGS,
    action: ACCESS_ACTIONS.VIEW,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 12h6"/><path d="M9 16h6"/><path d="M9 8h6"/>
        <path d="M5 3h14a2 2 0 0 1 2 2v14l-4-2-4 2-4-2-4 2V5a2 2 0 0 1 2-2z"/>
      </svg>
    )
  },
  {
    to: "/admin/finances",
    label: "Finances",
    roles: ["admin", "employee"],
    moduleKey: MODULE_KEYS.ADMIN_FINANCES,
    action: ACCESS_ACTIONS.VIEW,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    )
  },
  {
    to: "/admin/pricing",
    label: "Pricing",
    roles: ["admin", "employee"],
    moduleKey: MODULE_KEYS.PRICING,
    action: ACCESS_ACTIONS.VIEW,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    )
  },
  {
    to: "/settings",
    label: "Settings",
    roles: ["viewer", "lister", "admin", "employee"],
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    )
  }
];

function PortalLayout({ title, subtitle, children, hideGuestAuthButtons = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(() => getStoredUser());
  const [theme, setTheme] = useState(() => (getStoredUser() ? getStoredTheme() : "light"));
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [isUnreadBadgeBumping, setIsUnreadBadgeBumping] = useState(false);
  const prevUnreadCountRef = useRef(0);

  const displayName = useMemo(() => user?.fullName?.split(" ")[0] || "User", [user]);
  const initials = useMemo(() => {
    const parts = (user?.fullName || "U").split(" ");
    return parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : parts[0][0].toUpperCase();
  }, [user]);
  const shouldTrackUnreadMessages = useMemo(() => {
    const accountType = String(user?.accountType || "").toLowerCase();
    return accountType === "viewer" || accountType === "lister";
  }, [user?.accountType]);

  useEffect(() => {
    const effectiveTheme = user ? theme : "light";
    document.documentElement.setAttribute("data-theme", effectiveTheme);
    if (user) {
      setStoredTheme(theme);
    }
  }, [theme, user]);

  useEffect(() => {
    if (!user) {
      setTheme((prev) => (prev === "light" ? prev : "light"));
      return;
    }
    const stored = getStoredTheme();
    setTheme((prev) => (prev === stored ? prev : stored));
  }, [user]);

  useEffect(() => {
    const handleStorageChange = () => {
      const nextUser = getStoredUser();
      setUser(nextUser);
      const nextTheme = nextUser ? getStoredTheme() : "light";
      setTheme((prev) => (prev === nextTheme ? prev : nextTheme));
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const handleViewportChange = (event) => {
      if (event.matches) {
        setIsMobileNavOpen(false);
      }
    };

    mediaQuery.addEventListener("change", handleViewportChange);
    return () => mediaQuery.removeEventListener("change", handleViewportChange);
  }, []);

  useEffect(() => {
    if (!isMobileNavOpen) {
      return undefined;
    }

    const handleEscapeClose = (event) => {
      if (event.key === "Escape") {
        setIsMobileNavOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscapeClose);
    return () => window.removeEventListener("keydown", handleEscapeClose);
  }, [isMobileNavOpen]);

  useEffect(() => {
    let cancelled = false;
    if (!user || !shouldTrackUnreadMessages) {
      setUnreadMessageCount(0);
      return undefined;
    }

    const loadUnreadCount = async () => {
      try {
        const response = await getMyUnreadMessageCount();
        if (cancelled) return;
        setUnreadMessageCount(Math.max(0, Number(response?.unreadCount || 0)));
      } catch (_error) {
        if (!cancelled) {
          setUnreadMessageCount(0);
        }
      }
    };

    void loadUnreadCount();
    return () => {
      cancelled = true;
    };
  }, [location.pathname, shouldTrackUnreadMessages, user]);

  useEffect(() => {
    if (!user || !shouldTrackUnreadMessages) {
      return undefined;
    }
    const socket = getRealtimeSocket();
    let cancelled = false;
    let refreshTimeout = null;

    const loadUnreadCount = async () => {
      try {
        const response = await getMyUnreadMessageCount();
        if (cancelled) return;
        setUnreadMessageCount(Math.max(0, Number(response?.unreadCount || 0)));
      } catch (_error) {
        if (!cancelled) {
          setUnreadMessageCount(0);
        }
      }
    };

    const scheduleRefresh = () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      refreshTimeout = setTimeout(() => {
        void loadUnreadCount();
      }, 220);
    };

    const onWindowFocus = () => scheduleRefresh();
    const onBadgeRefresh = () => scheduleRefresh();

    socket.on("messages:new-message", scheduleRefresh);
    socket.on("messages:conversation-updated", scheduleRefresh);
    window.addEventListener("focus", onWindowFocus);
    window.addEventListener("messages:badge-refresh", onBadgeRefresh);

    return () => {
      cancelled = true;
      socket.off("messages:new-message", scheduleRefresh);
      socket.off("messages:conversation-updated", scheduleRefresh);
      window.removeEventListener("focus", onWindowFocus);
      window.removeEventListener("messages:badge-refresh", onBadgeRefresh);
      if (refreshTimeout) clearTimeout(refreshTimeout);
    };
  }, [shouldTrackUnreadMessages, user]);

  useEffect(() => {
    if (unreadMessageCount > prevUnreadCountRef.current) {
      setIsUnreadBadgeBumping(true);
      const timeout = setTimeout(() => {
        setIsUnreadBadgeBumping(false);
      }, 420);
      prevUnreadCountRef.current = unreadMessageCount;
      return () => clearTimeout(timeout);
    }
    prevUnreadCountRef.current = unreadMessageCount;
    return undefined;
  }, [unreadMessageCount]);

  const handleLogout = async () => {
    try {
      await logoutAccount({ reason: "manual" });
    } catch (_error) {
      // Session might already be invalid server-side.
    }
    clearStoredUser();
    clearStoredSessionMeta();
    notify("You have been logged out.", "info");
    navigate("/login", { replace: true });
  };

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.roles && !item.roles.includes(user?.accountType)) {
      return false;
    }
    if (item.moduleKey && !canAccessModule(user, item.moduleKey, item.action || ACCESS_ACTIONS.VIEW)) {
      return false;
    }
    return true;
  });

  // Guest (unauthenticated) view — no sidebar, no user identity, no logout button.
  // Renders a clean full-width layout with only a slim top bar showing the brand
  // and login/register CTAs so guests can find their way around.
  if (!user) {
    return (
      <div className="kr-portal-shell kr-portal-shell--guest">
        <main className="kr-portal-main kr-portal-main--guest">
          <header className="kr-portal-header kr-portal-header--guest">
            <div className="kr-portal-header-inner">
              <div className="kr-portal-header-left">
                <NavLink to="/" className="kr-portal-brand kr-portal-brand--header">
                  <span className="kr-sidebar-brand-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>
                      <polyline points="9 22 9 12 15 12 15 22"/>
                    </svg>
                  </span>
                  KenReal<span className="kr-portal-dot"></span>Estates
                </NavLink>
                <h1 className="kr-portal-title">{title}</h1>
                {subtitle && <p className="kr-portal-subtitle">{subtitle}</p>}
              </div>
              {!hideGuestAuthButtons && (
                <div className="kr-portal-header-meta">
                  <NavLink to="/login" className="kr-guest-header-btn kr-guest-header-btn--outline">
                    Log in
                  </NavLink>
                  <NavLink to="/register" className="kr-guest-header-btn kr-guest-header-btn--solid">
                    Sign up free
                  </NavLink>
                </div>
              )}
            </div>
          </header>

          <section className="kr-portal-content">{children}</section>
        </main>
      </div>
    );
  }

  return (
    <div className="kr-portal-shell">
      <aside className={`kr-portal-sidebar ${isMobileNavOpen ? "is-mobile-open" : ""}`}>
        {/* Brand */}
        <div className="kr-sidebar-brand-wrap">
          <NavLink to="/" className="kr-portal-brand">
            <span className="kr-sidebar-brand-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </span>
            KenReal<span className="kr-portal-dot"></span>Estates
          </NavLink>
          <button
            type="button"
            className="kr-portal-mobile-nav-close"
            onClick={() => setIsMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* User identity */}
        <div className="kr-sidebar-identity">
          <div className="kr-sidebar-avatar">{initials}</div>
          <div className="kr-sidebar-identity-info">
            <p className="kr-sidebar-identity-name">{user.fullName}</p>
            <span className={`kr-sidebar-role-badge kr-sidebar-role-${user.accountType}`}>
              {user.accountType}
            </span>
          </div>
        </div>

        {/* Navigation */}
        <div className="kr-sidebar-nav-label">Navigation</div>
        <nav className="kr-portal-nav">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setIsMobileNavOpen(false)}
              className={({ isActive }) =>
                `kr-portal-link ${isActive ? "active" : ""}`
              }
            >
              <span className="kr-portal-link-icon">{item.icon}</span>
              <span className="kr-portal-link-label">{item.label}</span>
              {item.to === "/messages" && item.label === "Messages" && unreadMessageCount > 0 && (
                <span
                  className={`kr-portal-unread-badge${isUnreadBadgeBumping ? " is-bump" : ""}`}
                  aria-label={`${unreadMessageCount} unread messages`}
                >
                  {unreadMessageCount > 99 ? "99+" : unreadMessageCount}
                </span>
              )}
            </NavLink>
          ))}
          <div className="kr-sidebar-nav-divider"></div>
          <NavLink
            to="/"
            className="kr-portal-link kr-portal-link-home"
            onClick={() => setIsMobileNavOpen(false)}
          >
            <span className="kr-portal-link-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </span>
            Back to Home
          </NavLink>
        </nav>

        {/* Footer actions */}
        <div className="kr-portal-side-actions">
          <button type="button" className="kr-portal-logout-btn" onClick={handleLogout}>
            <span className="kr-portal-link-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </span>
            Logout
          </button>
        </div>
      </aside>
      {isMobileNavOpen && (
        <button
          type="button"
          className="kr-portal-mobile-backdrop"
          onClick={() => setIsMobileNavOpen(false)}
          aria-label="Close navigation menu"
        />
      )}

      <main className="kr-portal-main">
        <header className="kr-portal-header">
          <div className="kr-portal-header-inner">
            <div className="kr-portal-header-left">
              <button
                type="button"
                className="kr-portal-mobile-nav-toggle"
                onClick={() => setIsMobileNavOpen(true)}
                aria-label="Open navigation"
                aria-expanded={isMobileNavOpen}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
                Menu
              </button>
              <p className="kr-portal-eyebrow">KenReal Portal</p>
              <h1 className="kr-portal-title">{title}</h1>
              {subtitle && <p className="kr-portal-subtitle">{subtitle}</p>}
            </div>
            <div className="kr-portal-header-meta">
              <span className="kr-portal-header-user">
                {displayName}
              </span>
            </div>
          </div>
        </header>

        <section className="kr-portal-content">{children}</section>
      </main>
    </div>
  );
}

export default PortalLayout;
