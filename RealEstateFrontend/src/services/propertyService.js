import { apiRequest } from "./apiClient";

export const LISTING_PAYMENT_INTENT = {
  PUBLISH_PREMIUM: "publish_premium",
  UPGRADE_PREMIUM: "upgrade_premium"
};

export async function getProperties() {
  return apiRequest("/api/properties", {
    method: "GET"
  });
}

export async function getMyProperties() {
  return apiRequest("/api/properties/mine", {
    method: "GET"
  });
}

export async function getMyListingEngagement() {
  return apiRequest("/api/properties/mine/engagement", {
    method: "GET"
  });
}

export async function getPropertiesForAdmin(includeDeleted = true) {
  const queryString = includeDeleted ? "?includeDeleted=true" : "";
  return apiRequest(`/api/properties${queryString}`, {
    method: "GET"
  });
}

export async function getPropertyById(id) {
  return apiRequest(`/api/properties/${id}`, {
    method: "GET"
  });
}

export async function getShortlistedProperties() {
  return apiRequest("/api/properties/shortlist", {
    method: "GET"
  });
}

export async function getPropertyAlertPreference() {
  return apiRequest("/api/properties/alerts/preference", {
    method: "GET"
  });
}

export async function updatePropertyAlertPreference(payload = {}) {
  return apiRequest("/api/properties/alerts/preference", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function addToShortlist(propertyId) {
  return apiRequest(`/api/properties/${propertyId}/shortlist`, {
    method: "POST"
  });
}

export async function removeFromShortlist(propertyId) {
  return apiRequest(`/api/properties/${propertyId}/shortlist`, {
    method: "DELETE"
  });
}

export async function createProperty(payload) {
  const isFormData = typeof FormData !== "undefined" && payload instanceof FormData;
  return apiRequest("/api/properties", {
    method: "POST",
    ...(isFormData
      ? { body: payload }
      : {
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        })
  });
}

export async function updateProperty(propertyId, payload) {
  const isFormData = typeof FormData !== "undefined" && payload instanceof FormData;
  return apiRequest(`/api/properties/${propertyId}`, {
    method: "PUT",
    ...(isFormData
      ? { body: payload }
      : {
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload || {})
        })
  });
}

export async function getListingPaymentStatus(propertyId) {
  // Response now includes expiry and FX quote metadata:
  // { visibilityExpiresAt, isExpired, exchangeRate, pricingByMonths[].totalKes, ... }
  return apiRequest(`/api/properties/${propertyId}/payments/status`, {
    method: "GET"
  });
}

export async function createListingPaymentCheckout(propertyId, payload = {}) {
  const normalizedPayload = {
    paymentIntent: LISTING_PAYMENT_INTENT.UPGRADE_PREMIUM,
    ...(payload || {})
  };
  return apiRequest(`/api/properties/${propertyId}/payments/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(normalizedPayload)
  });
}

export async function submitInquiry(propertyId, payload) {
  const normalizedMessage = String(
    payload?.message ||
    payload?.inquiry ||
    ""
  ).trim();
  return apiRequest(`/api/messages/listings/${propertyId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: normalizedMessage })
  });
}

export async function softDeleteListing(propertyId, payload = {}) {
  return apiRequest(`/api/properties/${propertyId}/soft-delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function restoreSoftDeletedListing(propertyId) {
  return apiRequest(`/api/properties/${propertyId}/restore`, {
    method: "POST"
  });
}

export async function submitListingReport(propertyId, payload) {
  return apiRequest(`/api/properties/${propertyId}/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}
