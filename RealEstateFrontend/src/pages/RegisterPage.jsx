import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  getSocialAuthProvidersAvailability,
  getSocialAuthStartUrl,
  registerAccount
} from "../services/authService";
import { notify } from "../utils/notify";

const COUNTRY_OPTIONS = [
  { code: "KE", label: "Kenya" },
  { code: "UG", label: "Uganda" },
  { code: "TZ", label: "Tanzania" },
  { code: "RW", label: "Rwanda" },
  { code: "BI", label: "Burundi" },
  { code: "ET", label: "Ethiopia" },
  { code: "SS", label: "South Sudan" },
  { code: "SO", label: "Somalia" }
];

function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [formState, setFormState] = useState({
    fullName: "",
    email: "",
    countryCode: "KE",
    password: "",
    accountType: "viewer",
    subscriptionTier: "standard"
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [oauthProviders, setOauthProviders] = useState({
    google: true,
    apple: true
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const oauthError = params.get("oauthError");
    if (!oauthError) {
      return;
    }
    notify("Social sign up was not completed. Please try again.", "warning");
    params.delete("oauthError");
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : ""
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    let cancelled = false;
    const loadOAuthProviders = async () => {
      try {
        const availability = await getSocialAuthProvidersAvailability();
        if (cancelled) return;
        setOauthProviders({
          google: Boolean(availability?.google),
          apple: Boolean(availability?.apple)
        });
      } catch (_error) {
        if (!cancelled) {
          setOauthProviders({ google: true, apple: true });
        }
      }
    };
    void loadOAuthProviders();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormState((prev) => {
      if (name === "accountType" && value !== "lister") {
        return {
          ...prev,
          accountType: value,
          subscriptionTier: "standard"
        };
      }
      return { ...prev, [name]: value };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await registerAccount(formState);
      notify(response.verificationMessage || "Account created. Please verify your email.", "success");
      navigate(`/verify-email?email=${encodeURIComponent(formState.email)}`);
    } catch (submitError) {
      notify(submitError.message || "Failed to create account.", "danger");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSocialSignup = (provider) => {
    if (!oauthProviders?.[provider]) {
      notify(`${provider[0].toUpperCase()}${provider.slice(1)} sign in is not configured yet.`, "warning");
      return;
    }
    try {
      window.location.assign(getSocialAuthStartUrl(provider));
    } catch (error) {
      notify(error.message || "Social sign up is not available right now.", "danger");
    }
  };

  const passwordStrength = formState.password.length >= 10 ? "strong" : formState.password.length >= 6 ? "medium" : "weak";

  return (
    <div className="kr-auth-page">
      <div className="kr-auth-shell">

        {/* Left decorative panel */}
        <div className="kr-auth-side">
          <div className="kr-auth-side-inner">
            <Link to="/" className="kr-auth-side-logo text-decoration-none">
              KenReal<span className="kr-auth-dot"></span>Estates
            </Link>

            <div className="kr-auth-side-hero">
              <div className="kr-auth-side-icon-wrap">
                <span className="kr-auth-side-icon">🏡</span>
              </div>
              <h2 className="kr-auth-side-title">Start your property journey today</h2>
              <p className="kr-auth-side-sub">
                Join thousands of Kenyans finding rentals, leases, and listing opportunities through our trusted platform.
              </p>

              {/* Floating property card mockup */}
              <div className="kr-auth-mockup-card">
                <div className="kr-auth-mockup-img kr-auth-mockup-img-alt"></div>
                <div className="kr-auth-mockup-body">
                  <p className="kr-auth-mockup-title">3-Bed Villa, Karen</p>
                  <p className="kr-auth-mockup-price">KSh 120,000 / mo</p>
                  <div className="kr-auth-mockup-tags">
                    <span className="kr-auth-mockup-tag">📍 Nairobi</span>
                    <span className="kr-auth-mockup-tag kr-auth-mockup-tag-badge">Lease</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="kr-auth-side-stats">
              <div className="kr-auth-stat">
                <span className="kr-auth-stat-val">8,500+</span>
                <span className="kr-auth-stat-label">Monthly inquiries</span>
              </div>
              <div className="kr-auth-stat">
                <span className="kr-auth-stat-val">4 days</span>
                <span className="kr-auth-stat-label">Avg. match time</span>
              </div>
              <div className="kr-auth-stat">
                <span className="kr-auth-stat-val">98%</span>
                <span className="kr-auth-stat-label">Satisfaction</span>
              </div>
            </div>

            <div className="kr-auth-side-trust">
              <span>🔒</span>
              <span>Your data is encrypted and never shared with third parties.</span>
            </div>
          </div>
        </div>

        {/* Right form panel */}
        <div className="kr-auth-form-panel">
          <div className="kr-auth-form-topbar d-lg-none">
            <Link to="/" className="text-decoration-none" style={{ color: "var(--kr-primary)", fontWeight: 800, fontSize: "1.1rem" }}>
              KenReal<span style={{ display: "inline-block", width: 8, height: 8, background: "var(--kr-accent)", borderRadius: "50%", margin: "0 2px 2px" }}></span>Estates
            </Link>
            <Link to="/" className="kr-auth-back-btn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Home
            </Link>
          </div>

          <div className="kr-auth-form-scroll">
            <Link to="/" className="kr-auth-back-link d-none d-lg-inline-flex">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Back to home
            </Link>

            <div className="kr-auth-form-header">
              <span className="kr-auth-eyebrow-pill">Get Started — Free</span>
              <h1 className="kr-auth-heading">Create Your Account</h1>
              <p className="kr-auth-subheading">
                Already have an account?{" "}
                <Link to="/login" className="kr-auth-link">Log in</Link>
              </p>
            </div>

            {/* Social sign-up */}
            <div className="kr-auth-social-row">
              <button
                type="button"
                className="kr-auth-social-btn kr-auth-social-btn--google"
                onClick={() => handleSocialSignup("google")}
                disabled={!oauthProviders.google}
                title={!oauthProviders.google ? "Google OAuth not configured" : "Continue with Google"}
              >
                {/* Google colour logo */}
                <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>
              <button
                type="button"
                className="kr-auth-social-btn kr-auth-social-btn--apple"
                onClick={() => handleSocialSignup("apple")}
                disabled={!oauthProviders.apple}
                title={!oauthProviders.apple ? "Apple OAuth not configured" : "Continue with Apple"}
              >
                {/* Apple logo */}
                <svg width="17" height="20" viewBox="0 0 814 1000" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105.1-58.2-165.9-127.5C89 891.8 40 773.5 40 661c0-190.9 124.7-292.3 247.2-292.3 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" fill="currentColor"/>
                </svg>
                Continue with Apple
              </button>
            </div>

            {!oauthProviders.google && !oauthProviders.apple && (
              <p className="text-muted small mb-3">
                Social sign in will appear here once provider credentials are configured.
              </p>
            )}

            {/* "or" divider */}
            <div className="kr-auth-divider">
              <span className="kr-auth-divider-text">or sign up with email</span>
            </div>

            <form onSubmit={handleSubmit} className="kr-auth-form">

              <div className="kr-field">
                <label className="kr-field-label" htmlFor="fullName">Full Name</label>
                <div className="kr-field-input-wrap">
                  <span className="kr-field-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                  </span>
                  <input
                    id="fullName"
                    name="fullName"
                    type="text"
                    className="form-control kr-field-input"
                    placeholder="e.g. Ken Wekesir "
                    value={formState.fullName}
                    onChange={handleInputChange}
                    required
                  />
                </div>
              </div>

              <div className="kr-field">
                <label className="kr-field-label" htmlFor="email">Email Address</label>
                <div className="kr-field-input-wrap">
                  <span className="kr-field-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="4" width="20" height="16" rx="2"/>
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                    </svg>
                  </span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    className="form-control kr-field-input"
                    placeholder="you@example.com"
                    value={formState.email}
                    onChange={handleInputChange}
                    required
                  />
                </div>
              </div>

              <div className="kr-field">
                <label className="kr-field-label" htmlFor="countryCode">Country</label>
                <div className="kr-field-input-wrap">
                  <span className="kr-field-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="2" y1="12" x2="22" y2="12"/>
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                  </span>
                  <select
                    id="countryCode"
                    name="countryCode"
                    className="form-control kr-field-input"
                    value={formState.countryCode}
                    onChange={handleInputChange}
                  >
                    {COUNTRY_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="kr-field">
                <label className="kr-field-label" htmlFor="password">Password</label>
                <div className="kr-field-input-wrap">
                  <span className="kr-field-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </span>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    className="form-control kr-field-input"
                    placeholder="Minimum 6 characters"
                    value={formState.password}
                    onChange={handleInputChange}
                    minLength={6}
                    required
                  />
                  <button
                    type="button"
                    className="kr-field-toggle"
                    onClick={() => setShowPassword((prev) => !prev)}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
                {formState.password.length > 0 && (
                  <div className="kr-password-strength">
                    <div className="kr-strength-segments">
                      <div className={`kr-strength-seg ${["weak","medium","strong"].includes(passwordStrength) ? `kr-seg-${passwordStrength}` : ""}`}></div>
                      <div className={`kr-strength-seg ${["medium","strong"].includes(passwordStrength) ? `kr-seg-${passwordStrength}` : ""}`}></div>
                      <div className={`kr-strength-seg ${passwordStrength === "strong" ? "kr-seg-strong" : ""}`}></div>
                    </div>
                    <small className="kr-strength-text">
                      {passwordStrength === "strong" ? "✓ Strong password" : passwordStrength === "medium" ? "Fair — consider adding more characters" : "Too short"}
                    </small>
                  </div>
                )}
              </div>

              <div className="kr-field">
                <p className="kr-field-label">I want to…</p>
                <div className="kr-role-grid">
                  <label
                    className={`kr-role-card ${formState.accountType === "viewer" ? "selected" : ""}`}
                    htmlFor="accountTypeViewer"
                  >
                    <input type="radio" id="accountTypeViewer" name="accountType" value="viewer" checked={formState.accountType === "viewer"} onChange={handleInputChange} />
                    <div className="kr-role-card-icon-wrap">🔍</div>
                    <span className="kr-role-card-title">Browse &amp; Rent</span>
                    <span className="kr-role-card-sub">Find rental or lease properties</span>
                    {formState.accountType === "viewer" && (
                      <span className="kr-role-check-badge">✓</span>
                    )}
                  </label>
                  <label
                    className={`kr-role-card ${formState.accountType === "lister" ? "selected" : ""}`}
                    htmlFor="accountTypeLister"
                  >
                    <input type="radio" id="accountTypeLister" name="accountType" value="lister" checked={formState.accountType === "lister"} onChange={handleInputChange} />
                    <div className="kr-role-card-icon-wrap">📋</div>
                    <span className="kr-role-card-title">List Properties</span>
                    <span className="kr-role-card-sub">Advertise your units</span>
                    {formState.accountType === "lister" && (
                      <span className="kr-role-check-badge">✓</span>
                    )}
                  </label>
                </div>
              </div>

              {formState.accountType === "lister" && (
                <div className="kr-field">
                  <p className="kr-field-label">Lister plan</p>
                  <div className="kr-plan-grid">
                    <label
                      className={`kr-plan-card ${formState.subscriptionTier === "standard" ? "selected" : ""}`}
                      htmlFor="subscriptionTierStandard"
                    >
                      <input
                        type="radio"
                        id="subscriptionTierStandard"
                        name="subscriptionTier"
                        value="standard"
                        checked={formState.subscriptionTier === "standard"}
                        onChange={handleInputChange}
                      />
                      <span className="kr-plan-title">Standard</span>
                      <span className="kr-plan-price">KSh 0 / mo</span>
                      <span className="kr-plan-feature">Up to 4 listing images</span>
                      <span className="kr-plan-feature">No video uploads</span>
                    </label>
                    <label
                      className={`kr-plan-card ${formState.subscriptionTier === "premium" ? "selected" : ""}`}
                      htmlFor="subscriptionTierPremium"
                    >
                      <input
                        type="radio"
                        id="subscriptionTierPremium"
                        name="subscriptionTier"
                        value="premium"
                        checked={formState.subscriptionTier === "premium"}
                        onChange={handleInputChange}
                      />
                      <span className="kr-plan-badge">Recommended</span>
                      <span className="kr-plan-title">Premium</span>
                      <span className="kr-plan-price">KSh 2,500 / mo</span>
                      <span className="kr-plan-feature">Up to 12 listing images</span>
                      <span className="kr-plan-feature">1 video tour per listing</span>
                    </label>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="kr-auth-submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                    Creating Account…
                  </>
                ) : (
                  <>Create Account <span className="kr-submit-arrow">→</span></>
                )}
              </button>

              <p className="kr-auth-terms">
                By creating an account you agree to KenReal Estates' Terms of Service and Privacy Policy.
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RegisterPage;
