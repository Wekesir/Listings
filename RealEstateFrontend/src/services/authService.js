import { apiRequest } from "./apiClient";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

export async function registerAccount(payload) {
  return apiRequest("/api/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function loginAccount(payload) {
  return apiRequest("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function verifyEmailCode(payload) {
  return apiRequest("/api/auth/verify-email-code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function resendVerificationCode(payload) {
  return apiRequest("/api/auth/resend-verification-code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export function getSocialAuthStartUrl(provider) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  if (!["google", "apple"].includes(normalizedProvider)) {
    throw new Error("Unsupported social provider");
  }
  return `${API_BASE_URL}/api/auth/oauth/${normalizedProvider}`;
}

export async function getSocialAuthProvidersAvailability() {
  return apiRequest("/api/auth/oauth/providers", {
    method: "GET"
  });
}

export async function logoutAccount(payload = {}) {
  return apiRequest("/api/auth/logout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function getActiveSession() {
  return apiRequest("/api/auth/session", {
    method: "GET"
  });
}

export async function updateAccountProfile(payload) {
  return apiRequest("/api/auth/profile", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function getAuthAuditLogs(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  });

  const queryString = params.toString();
  return apiRequest(`/api/auth/audit-logs${queryString ? `?${queryString}` : ""}`, {
    method: "GET"
  });
}

export async function deleteAuthAuditLogs(payload) {
  return apiRequest("/api/auth/audit-logs/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function getManageableUsers() {
  return apiRequest("/api/auth/users", {
    method: "GET"
  });
}

export async function createAdminUser(payload) {
  return apiRequest("/api/auth/users/admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function createEmployeeUser(payload) {
  return apiRequest("/api/auth/users/employee", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function suspendUserAccount(userId, payload) {
  return apiRequest(`/api/auth/users/${userId}/suspend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function banUserAccount(userId, payload) {
  return apiRequest(`/api/auth/users/${userId}/ban`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function clearUserRestrictions(userId) {
  return apiRequest(`/api/auth/users/${userId}/clear-restrictions`, {
    method: "POST"
  });
}

export async function getAccessControlModules() {
  return apiRequest("/api/auth/access-control/modules", {
    method: "GET"
  });
}

export async function getEmployeeRoles() {
  return apiRequest("/api/auth/employee-roles", {
    method: "GET"
  });
}

export async function createEmployeeRole(payload) {
  return apiRequest("/api/auth/employee-roles", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function updateEmployeeRole(roleId, payload) {
  return apiRequest(`/api/auth/employee-roles/${roleId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function deleteEmployeeRole(roleId) {
  return apiRequest(`/api/auth/employee-roles/${roleId}`, {
    method: "DELETE"
  });
}

export async function getEmployeeRolePermissions(roleId) {
  return apiRequest(`/api/auth/employee-roles/${roleId}/permissions`, {
    method: "GET"
  });
}

export async function replaceEmployeeRolePermissions(roleId, payload) {
  return apiRequest(`/api/auth/employee-roles/${roleId}/permissions`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function assignEmployeeRole(userId, payload) {
  return apiRequest(`/api/auth/users/${userId}/employee-role`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function getUserAccessProfile(userId = "me") {
  return apiRequest(`/api/auth/users/${userId}/access`, {
    method: "GET"
  });
}

export async function replaceUserAccessOverrides(userId, payload) {
  return apiRequest(`/api/auth/users/${userId}/access`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function getListingReports(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  });
  const queryString = params.toString();
  return apiRequest(`/api/auth/listing-reports${queryString ? `?${queryString}` : ""}`, {
    method: "GET"
  });
}

export async function resolveListingReport(reportId, payload) {
  return apiRequest(`/api/auth/listing-reports/${reportId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function getListingPricingConfiguration() {
  return apiRequest("/api/auth/listing-pricing", {
    method: "GET"
  });
}

export async function getEmailDeliveryConfiguration() {
  return apiRequest("/api/auth/email-delivery", {
    method: "GET"
  });
}

export async function updateEmailDeliveryConfiguration(payload) {
  return apiRequest("/api/auth/email-delivery", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function triggerSponsorshipExpiryRun() {
  return apiRequest("/api/auth/debug/sponsorship-expiry/run", {
    method: "POST"
  });
}

export async function updateListingPricingConfiguration(payload) {
  return apiRequest("/api/auth/listing-pricing", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}
