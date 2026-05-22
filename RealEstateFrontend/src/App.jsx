import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useEffect, useState } from "react";
import HomePage from "./pages/HomePage";
import RegisterPage from "./pages/RegisterPage";
import LoginPage from "./pages/LoginPage";
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
import AdminMessagesPage from "./pages/AdminMessagesPage";
import { getStoredTheme, getStoredUser } from "./utils/session";
import SessionTimeoutManager from "./components/SessionTimeoutManager";
import CookieNotice from "./components/CookieNotice";

function ProtectedRoute({ children, allowedRoles }) {
  const user = getStoredUser();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(user.accountType)) {
    const fallback = ["lister", "admin"].includes(user.accountType) ? "/dashboard" : "/listings";
    return <Navigate to={fallback} replace />;
  }

  return children;
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
          path="/messages"
          element={(
            <ProtectedRoute allowedRoles={["viewer", "lister", "admin"]}>
              <MessagesPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/settings"
          element={(
            <ProtectedRoute allowedRoles={["viewer", "lister", "admin"]}>
              <SettingsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin/messages"
          element={(
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminMessagesPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin/user-access"
          element={(
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminUserAccessPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin/audit-logs"
          element={(
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminAuditLogsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin/pricing"
          element={(
            <ProtectedRoute allowedRoles={["admin"]}>
              <AdminPricingPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/admin/listing-reports"
          element={(
            <ProtectedRoute allowedRoles={["admin"]}>
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
