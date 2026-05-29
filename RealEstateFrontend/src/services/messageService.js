import { apiRequest } from "./apiClient";

export async function createListingInquiry(propertyId, payload) {
  return apiRequest(`/api/messages/listings/${propertyId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function getMyConversations(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return apiRequest(`/api/messages/conversations${query ? `?${query}` : ""}`, {
    method: "GET"
  });
}

export async function getConversationMessages(conversationId, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return apiRequest(`/api/messages/conversations/${conversationId}/messages${query ? `?${query}` : ""}`, {
    method: "GET"
  });
}

export async function sendConversationMessage(conversationId, payload) {
  return apiRequest(`/api/messages/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload || {})
  });
}

export async function markConversationAsRead(conversationId) {
  return apiRequest(`/api/messages/conversations/${conversationId}/read`, {
    method: "POST"
  });
}

export async function getMyUnreadMessageCount() {
  return apiRequest("/api/messages/conversations/unread-count", {
    method: "GET"
  });
}

export async function getAdminConversations(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return apiRequest(`/api/messages/admin/conversations${query ? `?${query}` : ""}`, {
    method: "GET"
  });
}

export async function getAdminConversationMessages(conversationId, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return apiRequest(`/api/messages/admin/conversations/${conversationId}/messages${query ? `?${query}` : ""}`, {
    method: "GET"
  });
}
