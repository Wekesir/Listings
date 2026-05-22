import { getMediaSummary } from "../utils/propertyMedia";

/**
 * Small overlay pill for property cards indicating that a listing has
 * richer media than the single cover image (extra photos and/or a video).
 * Renders nothing when there is no extra media to advertise.
 */
function PropertyMediaBadge({ item, className = "" }) {
  const { extraImages, hasVideo } = getMediaSummary(item);
  if (!hasVideo && extraImages <= 0) return null;

  const parts = [];
  if (extraImages > 0) {
    parts.push(
      <span key="photos" className="kr-card-media-chip__part">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="5" width="14" height="14" rx="2" />
          <path d="M7 5V3h10a4 4 0 0 1 4 4v10h-2" />
        </svg>
        +{extraImages}
      </span>
    );
  }

  if (hasVideo) {
    parts.push(
      <span key="video" className="kr-card-media-chip__part">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
        Video
      </span>
    );
  }

  return (
    <span
      className={`kr-card-media-chip ${className}`.trim()}
      title={
        hasVideo && extraImages > 0
          ? `${extraImages} more ${extraImages === 1 ? "photo" : "photos"} · Video tour`
          : hasVideo
            ? "Video tour available"
            : `${extraImages} more ${extraImages === 1 ? "photo" : "photos"}`
      }
    >
      {parts}
    </span>
  );
}

export default PropertyMediaBadge;
