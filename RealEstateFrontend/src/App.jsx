import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useEffect, useState } from "react";
import HomePage from "./pages/HomePage";
import RegisterPage from "./pages/RegisterPage";
import LoginPage from "./pages/LoginPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ListingsPage from "./pages/ListingsPage";
import BrowseListingsPage from "./pages/BrowseListingsPage";
import ShortlistPage from "./pages/ShortlistPage";
import PropertyDetailPage from "./pages/PropertyDetailPage";
import DashboardPage from "./pages/DashboardPage";
import SettingsPage from "./pages/SettingsPage";
import AdminAuditLogsPage from "./pages/AdminAuditLogsPage";
import AdminUserAccessPage from "./pages/AdminUserAccessPage";
import AdminPricingPage from "./pages/AdminPricingPage";
import AdminListingReportsPage from "./pages/AdminListingReportsPage";
import MessagesPage from "./pages/MessagesPage";
import ListerFinancesPage from "./pages/ListerFinancesPage";
import AdminFinancesPage from "./pages/AdminFinancesPage";
import { getStoredTheme, getStoredUser } from "./utils/session";
import SessionTimeoutManager from "./components/SessionTimeoutManager";
import CookieNotice from "./components/CookieNotice";
import { ACCESS_ACTIONS, MODULE_KEYS, canAccessModule } from "./utils/accessControl";

function ProtectedRoute({ children, allowedRoles, requiredModule = null, requiredAction = ACCESS_ACTIONS.VIEW }) {
  const user = getStoredUser();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(user.accountType)) {
    const fallback = ["lister", "admin"].includes(user.accountType)
      ? "/dashboard"
      : user.accountType === "employee"
        ? "/settings"
        : "/listings";
    return <Navigate to={fallback} replace />;
  }

  if (requiredModule && !canAccessModule(user, requiredModule, requiredAction)) {
    const fallback = ["lister", "admin"].includes(user.accountType)
      ? "/dashboard"
      : user.accountType === "employee"
        ? "/settings"
        : "/listings";
    return <Navigate to={fallback} replace />;
  }

  return children;
}

function MessagesEntryRoute() {
  const user = getStoredUser();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  const canViewConversationOversight = canAccessModule(
    user,
    MODULE_KEYS.ADMIN_MESSAGES,
    ACCESS_ACTIONS.VIEW
  );
  if (canViewConversationOversight) {
    return <MessagesPage forceOversightMode />;
  }
  if (["viewer", "lister"].includes(user.accountType)) {
    return <MessagesPage />;
  }
  const fallback = user.accountType === "employee" ? "/settings" : "/dashboard";
  return <Navigate to={fallback} replace />;
}

function App() {
  const [theme, setTheme] = useState(() => getStoredTheme());

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      setTheme((prev) => (prev === current ? prev : current));
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <BrowserRouter>
      <SessionTimeoutManager />
      <CookieNotice />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/browse" element={<BrowseListingsPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route
          path="/listings"
          element={(
            <ProtectedRoute allowedRoles={["viewer", "lister", "admin"]}>
              <ListingsPage />
            </ProtectedRoute>
          )}
        />
        <Route path="/listings/:id" element={<PropertyDetailPage />} />
        <Route
          path="/shortlist"
          element={(
            <ProtectedRoute allowedRoles={["viewer", "lister", "admin"]}>
              <ShortlistPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/dashboard"
          element={(
            <ProtectedRoute allowedRoles={["lister", "admin"]}>
              <DashboardPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/finances"
          element={(
            <ProtectedRoute allowedRoles={["lister", "admin"]}>
              <ListerFinancesPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/messages"
          element={(
            <ProtectedRoute allowedRoles={["viewer", "lister", "admin", "employee"]}>
              <MessagesEntryRoute />
            </ProtectedRoute>
          )}
        />
        {/* Legacy alias for stale bookmarks; canonical path is /messages */}
        <Route path="/admin/messages" element={<Navigate to="/messages" replace />} />
        <Route
          path="/settings"
          element={(
            <ProtectedRoute allowedRoles={["viewer", "lister", "admin", "employee"]}>
              <SettingsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin/finances"
          element={(
            <ProtectedRoute
              allowedRoles={["admin", "employee"]}
              requiredModule={MODULE_KEYS.ADMIN_FINANCES}
              requiredAction={ACCESS_ACTIONS.VIEW}
            >
              <AdminFinancesPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin/user-access"
          element={(
            <ProtectedRoute
              allowedRoles={["admin", "employee"]}
              requiredModule={MODULE_KEYS.USER_ACCESS}
              requiredAction={ACCESS_ACTIONS.VIEW}
            >
              <AdminUserAccessPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin/audit-logs"
          element={(
            <ProtectedRoute
              allowedRoles={["admin", "employee"]}
              requiredModule={MODULE_KEYS.AUDIT_LOGS}
              requiredAction={ACCESS_ACTIONS.VIEW}
            >
              <AdminAuditLogsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin/pricing"
          element={(
            <ProtectedRoute
              allowedRoles={["admin", "employee"]}
              requiredModule={MODULE_KEYS.PRICING}
              requiredAction={ACCESS_ACTIONS.VIEW}
            >
              <AdminPricingPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin/listing-reports"
          element={(
            <ProtectedRoute
              allowedRoles={["admin", "employee"]}
              requiredModule={MODULE_KEYS.LISTING_REPORTS}
              requiredAction={ACCESS_ACTIONS.VIEW}
            >
              <AdminListingReportsPage />
            </ProtectedRoute>
          )}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <ToastContainer
        position="top-right"
        autoClose={4000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme={theme === "dark" ? "dark" : "light"}
      />
    </BrowserRouter>
  );
}

export default App;
