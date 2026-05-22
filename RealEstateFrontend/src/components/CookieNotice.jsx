import { useEffect, useState } from "react";

const COOKIE_NOTICE_KEY = "kenreal-cookie-notice-accepted";

function CookieNotice() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    try {
      const accepted = window.localStorage.getItem(COOKIE_NOTICE_KEY) === "1";
      setIsVisible(!accepted);
    } catch (_error) {
      setIsVisible(true);
    }
  }, []);

  const handleAccept = () => {
    try {
      window.localStorage.setItem(COOKIE_NOTICE_KEY, "1");
    } catch (_error) {
      // Ignore storage errors and simply hide the banner.
    }
    setIsVisible(false);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="kr-cookie-notice" role="region" aria-label="Cookie notice">
      <p className="kr-cookie-notice-text">
        We use cookies to keep you signed in, improve your experience, and analyze usage on KenReal Estates.
      </p>
      <button
        type="button"
        className="kr-cookie-notice-btn"
        onClick={handleAccept}
      >
        I Understand
      </button>
    </div>
  );
}

export default CookieNotice;
