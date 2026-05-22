const RENT_FALLBACK_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 700'%3E%3Cdefs%3E%3ClinearGradient id='bg' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%231e3a5f'/%3E%3Cstop offset='100%25' stop-color='%233a6fa8'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='1200' height='700' fill='url(%23bg)'/%3E%3Ccircle cx='960' cy='120' r='180' fill='rgba(255,255,255,0.14)'/%3E%3Ccircle cx='220' cy='600' r='220' fill='rgba(255,255,255,0.08)'/%3E%3Ctext x='90' y='615' font-family='Arial,sans-serif' font-size='82' font-weight='700' fill='rgba(255,255,255,0.82)'%3EKenReal Rent%3C/text%3E%3C/svg%3E";

const LEASE_FALLBACK_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 700'%3E%3Cdefs%3E%3ClinearGradient id='bg' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%23145a47'/%3E%3Cstop offset='100%25' stop-color='%231e8065'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='1200' height='700' fill='url(%23bg)'/%3E%3Ccircle cx='960' cy='120' r='180' fill='rgba(255,255,255,0.14)'/%3E%3Ccircle cx='220' cy='600' r='220' fill='rgba(255,255,255,0.08)'/%3E%3Ctext x='90' y='615' font-family='Arial,sans-serif' font-size='82' font-weight='700' fill='rgba(255,255,255,0.82)'%3EKenReal Lease%3C/text%3E%3C/svg%3E";

export function getFallbackImage(type) {
  return String(type).toLowerCase() === "lease" ? LEASE_FALLBACK_IMAGE : RENT_FALLBACK_IMAGE;
}

export function hasCustomImage(imageUrl) {
  return Boolean(String(imageUrl || "").trim());
}

export function resolvePropertyImageUrl(imageUrl, type) {
  const normalized = String(imageUrl || "").trim();
  return normalized || getFallbackImage(type);
}

/**
 * Derive a compact summary of the media attached to a listing so that
 * cards can surface an "extra media" hint (e.g. "Video" or "+4 photos")
 * before the user clicks through to the detail page.
 */
export function getMediaSummary(item) {
  const imageUrls = Array.isArray(item?.imageUrls)
    ? item.imageUrls.filter((value) => String(value || "").trim())
    : [];
  const hasSinglePrimary = hasCustomImage(item?.imageUrl);
  const totalImages = imageUrls.length > 0
    ? imageUrls.length
    : hasSinglePrimary ? 1 : 0;
  const hasVideo = Boolean(String(item?.videoUrl || "").trim());
  const extraImages = Math.max(totalImages - 1, 0);
  return { totalImages, extraImages, hasVideo };
}
