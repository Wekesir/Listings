import { apiRequest } from "./apiClient";

function toQueryString(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export async function getListerFinanceSummary(filters = {}) {
  return apiRequest(`/api/finances/lister/summary${toQueryString(filters)}`, { method: "GET" });
}

export async function getListerFinancePayments(filters = {}) {
  return apiRequest(`/api/finances/lister/payments${toQueryString(filters)}`, { method: "GET" });
}

export async function getAdminFinanceSummary(filters = {}) {
  return apiRequest(`/api/finances/admin/summary${toQueryString(filters)}`, { method: "GET" });
}

export async function getAdminFinancePayments(filters = {}) {
  return apiRequest(`/api/finances/admin/payments${toQueryString(filters)}`, { method: "GET" });
}

export function getListerFinanceCsvUrl(filters = {}) {
  return `/api/finances/lister/payments.csv${toQueryString(filters)}`;
}

export function getAdminFinanceCsvUrl(filters = {}) {
  return `/api/finances/admin/payments.csv${toQueryString(filters)}`;
}

export function getFinanceReceiptPdfUrl(paymentId) {
  return `/api/finances/${paymentId}/receipt.pdf`;
}
