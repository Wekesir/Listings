import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { completeOAuthSignup, getActiveSession } from "../services/authService";
import { setStoredSessionMeta, setStoredUser } from "../utils/session";
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

function getPostAuthRedirect(user) {
  return ["lister", "admin"].includes(user?.accountType) ? "/dashboard" : "/listings";
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function CompleteSignupPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userFullName, setUserFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [formState, setFormState] = useState({
    countryCode: "KE",
    accountType: "viewer",
    subscriptionTier: "standard",
    password: "",
    confirmPassword: ""
  });

  useEffect(() => {
    let isMounted = true;
    const loadSession = async () => {
      try {
        const response = await getActiveSession();
        if (!isMounted) return;
        const user = response?.user;
        if (!user) {
          navigate("/login", { replace: true });
          return;
        }
        setStoredUser(user);
        setStoredSessionMeta({
          timeoutMs: Number(response?.session?.timeoutMs),
          lastActivityAt: Date.now()
        });

        if (!user.onboardingPending) {
          navigate(getPostAuthRedirect(user), { replace: true });
          return;
        }

        setUserEmail(String(user.email || ""));
        setUserFullName(String(user.fullName || ""));
        setFormState((prev) => ({
          ...prev,
          countryCode: user.countryCode || "KE",
          accountType: user.accountType === "lister" ? "lister" : "viewer",
          subscriptionTier: user.subscriptionTier === "premium" ? "premium" : "standard"
        }));
      } catch (_error) {
        if (isMounted) {
          navigate("/login", { replace: true });
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    void loadSession();
    return () => {
      isMounted = false;
    };
  }, [navigate]);

  const passwordStrength = useMemo(() => {
    if (formState.password.length >= 10) return "strong";
    if (formState.password.length >= 6) return "medium";
    return "weak";
  }, [formState.password.length]);

  const passwordStrengthLabel = useMemo(() => {
    if (formState.password.length === 0) return null;
    if (passwordStrength === "strong") return "✓ Strong password";
    if (passwordStrength === "medium") return "Fair — consider adding more characters";
    return "Too short";
  }, [formState.password.length, passwordStrength]);

  const passwordsMatch = formState.confirmPassword.length > 0 && formState.password === formState.confirmPassword;
  const passwordsMismatch = formState.confirmPassword.length > 0 && formState.password !== formState.confirmPassword;

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormState((prev) => {
      if (name === "accountType" && value !== "lister") {
        return { ...prev, accountType: value, subscriptionTier: "standard" };
      }
      return { ...prev, [name]: value };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (formState.password.length < 6) {
      notify("Password must be at least 6 characters.", "warning");
      return;
    }
    if (formState.password !== formState.confirmPassword) {
      notify("Passwords do not match.", "warning");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await completeOAuthSignup({
        countryCode: formState.countryCode,
        accountType: formState.accountType,
        subscriptionTier: formState.subscriptionTier,
        password: formState.password
      });
      setStoredUser(response.user);
      setStoredSessionMeta({
        timeoutMs: Number(response?.session?.timeoutMs),
        lastActivityAt: Date.now()
      });
      notify("Account setup complete. Welcome!", "success");
      navigate(getPostAuthRedirect(response.user), { replace: true });
    } catch (error) {
      notify(error.message || "Could not complete account setup.", "danger");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="kr-auth-page">
        <div className="d-flex justify-content-center align-items-center" style={{ minHeight: "100vh" }}>
          <div className="spinner-border" role="status" aria-hidden="true" style={{ color: "var(--kr-primary)" }}></div>
        </div>
      </div>
    );
  }

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
              <h2 className="kr-auth-side-title">One last step before you're in</h2>
              <p className="kr-auth-side-sub">
                You signed in with Google. Tell us how you'll use the platform and set a password so you can also log in with email.
              </p>

              {userEmail && (
                <div className="kr-auth-mockup-card" style={{ textAlign: "left" }}>
                  <div className="kr-auth-mockup-body" style={{ padding: "1rem" }}>
                    <p className="kr-auth-mockup-title" style={{ marginBottom: "0.25rem" }}>
                      {userFullName || "Your account"}
                    </p>
                    <p className="kr-auth-mockup-price" style={{ fontSize: "0.8rem", fontWeight: 500 }}>
                      {userEmail}
                    </p>
                    <div className="kr-auth-mockup-tags">
                      <span className="kr-auth-mockup-tag">Google account</span>
                    </div>
                  </div>
                </div>
              )}
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
          </div>

          <div className="kr-auth-form-scroll">
            <div className="kr-auth-form-header">
              <span className="kr-auth-eyebrow-pill">Almost there</span>
              <h1 className="kr-auth-heading">Complete your signup</h1>
              <p className="kr-auth-subheading">
                This step is required — your account is not active until you finish below.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="kr-auth-form">

              {/* Country */}
              <div className="kr-field">
                <label className="kr-field-label" htmlFor="countryCode">Country</label>
                <div className="kr-field-input-wrap">
                  <span className="kr-field-icon">
                    <GlobeIcon />
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

              {/* Account purpose */}
              <div className="kr-field">
                <p className="kr-field-label">I want to…</p>
                <div className="kr-role-grid">
                  <label className={`kr-role-card ${formState.accountType === "viewer" ? "selected" : ""}`} htmlFor="accountTypeViewer">
                    <input
                      type="radio"
                      id="accountTypeViewer"
                      name="accountType"
                      value="viewer"
                      checked={formState.accountType === "viewer"}
                      onChange={handleInputChange}
                    />
                    <div className="kr-role-card-icon-wrap">🔍</div>
                    <span className="kr-role-card-title">Browse &amp; Rent</span>
                    <span className="kr-role-card-sub">Find rental or lease properties</span>
                    {formState.accountType === "viewer" && (
                      <span className="kr-role-check-badge">✓</span>
                    )}
                  </label>
                  <label className={`kr-role-card ${formState.accountType === "lister" ? "selected" : ""}`} htmlFor="accountTypeLister">
                    <input
                      type="radio"
                      id="accountTypeLister"
                      name="accountType"
                      value="lister"
                      checked={formState.accountType === "lister"}
                      onChange={handleInputChange}
                    />
                    <div className="kr-role-card-icon-wrap">📋</div>
                    <span className="kr-role-card-title">List Properties</span>
                    <span className="kr-role-card-sub">Advertise your units</span>
                    {formState.accountType === "lister" && (
                      <span className="kr-role-check-badge">✓</span>
                    )}
                  </label>
                </div>
              </div>

              {/* Lister plan */}
              {formState.accountType === "lister" && (
                <div className="kr-field">
                  <p className="kr-field-label">Lister plan</p>
                  <div className="kr-plan-grid">
                    <label className={`kr-plan-card ${formState.subscriptionTier === "standard" ? "selected" : ""}`} htmlFor="tierStandard">
                      <input
                        type="radio"
                        id="tierStandard"
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
                    <label className={`kr-plan-card ${formState.subscriptionTier === "premium" ? "selected" : ""}`} htmlFor="tierPremium">
                      <input
                        type="radio"
                        id="tierPremium"
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

              {/* Password */}
              <div className="kr-field">
                <label className="kr-field-label" htmlFor="password">Set a password</label>
                <div className="kr-field-input-wrap">
                  <span className="kr-field-icon">
                    <LockIcon />
                  </span>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    className="form-control kr-field-input"
                    placeholder="Minimum 6 characters"
                    minLength={6}
                    value={formState.password}
                    onChange={handleInputChange}
                    required
                  />
                  <button
                    type="button"
                    className="kr-field-toggle"
                    onClick={() => setShowPassword((prev) => !prev)}
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {formState.password.length > 0 && (
                  <div className="kr-password-strength">
                    <div className="kr-strength-segments">
                      <div className={`kr-strength-seg ${["weak", "medium", "strong"].includes(passwordStrength) ? `kr-seg-${passwordStrength}` : ""}`}></div>
                      <div className={`kr-strength-seg ${["medium", "strong"].includes(passwordStrength) ? `kr-seg-${passwordStrength}` : ""}`}></div>
                      <div className={`kr-strength-seg ${passwordStrength === "strong" ? "kr-seg-strong" : ""}`}></div>
                    </div>
                    <small className="kr-strength-text">{passwordStrengthLabel}</small>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div className="kr-field">
                <label className="kr-field-label" htmlFor="confirmPassword">Confirm password</label>
                <div className="kr-field-input-wrap">
                  <span className="kr-field-icon">
                    <LockIcon />
                  </span>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirm ? "text" : "password"}
                    className={`form-control kr-field-input${passwordsMismatch ? " is-invalid" : passwordsMatch ? " is-valid" : ""}`}
                    placeholder="Re-enter your password"
                    value={formState.confirmPassword}
                    onChange={handleInputChange}
                    required
                  />
                  <button
                    type="button"
                    className="kr-field-toggle"
                    onClick={() => setShowConfirm((prev) => !prev)}
                    tabIndex={-1}
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                  >
                    {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {passwordsMismatch && (
                  <small className="kr-strength-text" style={{ color: "#e74c3c" }}>Passwords do not match</small>
                )}
                {passwordsMatch && (
                  <small className="kr-strength-text" style={{ color: "#27ae60" }}>✓ Passwords match</small>
                )}
              </div>

              <button
                type="submit"
                className="kr-auth-submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                    Saving…
                  </>
                ) : (
                  <>Finish account setup <span className="kr-submit-arrow">→</span></>
                )}
              </button>

              <p className="kr-auth-terms">
                By completing setup you agree to KenReal Estates' Terms of Service and Privacy Policy.
              </p>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}

export default CompleteSignupPage;
