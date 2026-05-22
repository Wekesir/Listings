import { apiRequest } from "./apiClient";

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

export async function updateListingPricingConfiguration(payload) {
  return apiRequest("/api/auth/listing-pricing", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}
