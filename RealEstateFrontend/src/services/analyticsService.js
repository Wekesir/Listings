import { apiRequest } from "./apiClient";

export async function trackEvent(eventName, metadata = {}) {
  return apiRequest("/api/analytics/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ eventName, metadata })
  });
}

export async function getAnalyticsSummary() {
  return apiRequest("/api/analytics/summary", {
    method: "GET"
  });
}
