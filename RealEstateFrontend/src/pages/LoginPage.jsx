import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { getActiveSession, loginAccount } from "../services/authService";
import {
  clearStoredSessionMeta,
  clearStoredUser,
  getStoredUser,
  setStoredSessionMeta,
  setStoredUser
} from "../utils/session";
import { notify } from "../utils/notify";

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [formState, setFormState] = useState({ email: "", password: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSessionExpiredNotice, setShowSessionExpiredNotice] = useState(false);
  const [showAccountRestrictedNotice, setShowAccountRestrictedNotice] = useState(false);
  const [showVerifiedNotice, setShowVerifiedNotice] = useState(false);
  const [isCheckingExistingSession, setIsCheckingExistingSession] = useState(false);

  const getPostLoginPath = useCallback((user) => {
    const params = new URLSearchParams(location.search);
    const requestedReturnTo = params.get("returnTo");
    const safeReturnTo =
      requestedReturnTo && requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//")
        ? requestedReturnTo
        : null;

    return safeReturnTo || (["lister", "admin"].includes(user?.accountType) ? "/dashboard" : "/listings");
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sessionExpired = params.get("sessionExpired") === "1";
    const accountRestricted = params.get("accountRestricted") === "1";
    const verified = params.get("verified") === "1";
    const oauthSuccess = params.get("oauthSuccess") === "1";

    if (sessionExpired) {
      setShowSessionExpiredNotice(true);
    }
    if (accountRestricted) {
      setShowAccountRestrictedNotice(true);
    }
    if (verified) {
      setShowVerifiedNotice(true);
    }
    if (oauthSuccess) {
      getActiveSession()
        .then((response) => {
          setStoredUser(response.user);
          setStoredSessionMeta({
            timeoutMs: Number(response?.session?.timeoutMs),
            lastActivityAt: Date.now()
          });
          if (response.user?.onboardingPending) {
            notify("Complete your account setup to continue.", "info");
            navigate("/complete-signup", { replace: true });
            return;
          }
          notify("Signed in successfully with social account.", "success");
          navigate(getPostLoginPath(response.user), { replace: true });
        })
        .catch(() => {
          notify("Social login did not complete. Please try again.", "warning");
        });
    }
    if (!sessionExpired && !accountRestricted && !verified && !oauthSuccess) {
      return;
    }

    params.delete("sessionExpired");
    params.delete("accountRestricted");
    params.delete("verified");
    params.delete("oauthSuccess");
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : ""
      },
      { replace: true }
    );
  }, [getPostLoginPath, location.pathname, location.search, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sessionExpired = params.get("sessionExpired") === "1";
    const accountRestricted = params.get("accountRestricted") === "1";
    const oauthSuccess = params.get("oauthSuccess") === "1";
    const cachedUser = getStoredUser();

    if (sessionExpired || accountRestricted || oauthSuccess || !cachedUser) {
      return;
    }

    let cancelled = false;
    setIsCheckingExistingSession(true);

    getActiveSession()
      .then((response) => {
        if (cancelled) return;
        setStoredUser(response.user);
        setStoredSessionMeta({
          timeoutMs: Number(response?.session?.timeoutMs),
          lastActivityAt: Date.now()
        });
        const redirectPath = response.user?.onboardingPending
          ? "/complete-signup"
          : getPostLoginPath(response.user);
        navigate(redirectPath, { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        clearStoredUser();
        clearStoredSessionMeta();
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingExistingSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getPostLoginPath, location.search, navigate]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await loginAccount(formState);
      setStoredUser(response.user);
      setStoredSessionMeta({
        timeoutMs: Number(response?.session?.timeoutMs),
        lastActivityAt: Date.now()
      });
      if (response.user?.onboardingPending) {
        notify("Complete your account setup to continue.", "info");
        navigate("/complete-signup", { replace: true });
        return;
      }
      notify(`Welcome back, ${response.user.fullName}!`, "success");
      setFormState({ email: "", password: "" });
      const redirectPath = getPostLoginPath(response.user);
      setTimeout(() => navigate(redirectPath, { replace: true }), 600);
    } catch (submitError) {
      if (submitError?.message?.toLowerCase().includes("verify your email")) {
        navigate(`/verify-email?email=${encodeURIComponent(formState.email)}`);
      }
      notify(submitError.message || "Failed to log in.", "danger");
    } finally {
      setIsSubmitting(false);
    }
  };

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
                <span className="kr-auth-side-icon">🔑</span>
              </div>
              <h2 className="kr-auth-side-title">Welcome back to KenReal Estates</h2>
              <p className="kr-auth-side-sub">
                Pick up where you left off — your shortlist, inquiries, and listings are all waiting for you.
              </p>

              {/* Floating property card mockup */}
              <div className="kr-auth-mockup-card">
                <div className="kr-auth-mockup-img"></div>
                <div className="kr-auth-mockup-body">
                  <p className="kr-auth-mockup-title">2-Bed Apartment, Westlands</p>
                  <p className="kr-auth-mockup-price">KSh 45,000 / mo</p>
                  <div className="kr-auth-mockup-tags">
                    <span className="kr-auth-mockup-tag">⭐ Shortlisted</span>
                    <span className="kr-auth-mockup-tag kr-auth-mockup-tag-badge">Rent</span>
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
            <Link to="/" className="btn btn-outline-primary btn-sm px-3">← Home</Link>
          </div>

          <div className="kr-auth-form-scroll">
            {isCheckingExistingSession ? (
              <div className="d-flex align-items-center gap-2 text-muted mb-3">
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                Checking existing session...
              </div>
            ) : null}
            <Link to="/" className="kr-auth-back-link d-none d-lg-inline-flex">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Back to home
            </Link>

            <div className="kr-auth-form-header">
              <span className="kr-auth-eyebrow-pill">Welcome Back</span>
              <h1 className="kr-auth-heading">Log In</h1>
              <p className="kr-auth-subheading">
                New to KenReal Estates?{" "}
                <Link to="/register" className="kr-auth-link">Create an account</Link>
              </p>
            </div>

            {showSessionExpiredNotice && (
              <div className="alert alert-warning py-2 px-3 mb-3" role="alert">
                Your session timed out due to inactivity. Please log in again.
              </div>
            )}
            {showAccountRestrictedNotice && (
              <div className="alert alert-danger py-2 px-3 mb-3" role="alert">
                Your account has been restricted by an administrator. Contact support for assistance.
              </div>
            )}
            {showVerifiedNotice && (
              <div className="alert alert-success py-2 px-3 mb-3" role="alert">
                Email verified. You can now log in.
              </div>
            )}

            <form onSubmit={handleSubmit} className="kr-auth-form">
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
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <label className="kr-field-label mb-0" htmlFor="password">Password</label>
                  <span className="kr-forgot-link">Forgot password?</span>
                </div>
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
                    placeholder="Your password"
                    value={formState.password}
                    onChange={handleInputChange}
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
              </div>

              <button
                type="submit"
                className="kr-auth-submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                    Logging In…
                  </>
                ) : (
                  <>Log In <span className="kr-submit-arrow">→</span></>
                )}
              </button>
            </form>

            <div className="kr-login-features">
              <p className="kr-login-features-label">What you get with an account</p>
              <div className="kr-login-feature">
                <div className="kr-login-feature-icon-wrap" style={{ background: "rgba(30,58,95,0.1)" }}>
                  <span className="kr-login-feature-icon">📊</span>
                </div>
                <div>
                  <p className="kr-login-feature-title">Dashboard Access</p>
                  <p className="kr-login-feature-sub">Manage your listings and inquiries in one place.</p>
                </div>
              </div>
              <div className="kr-login-feature">
                <div className="kr-login-feature-icon-wrap" style={{ background: "rgba(232,160,32,0.12)" }}>
                  <span className="kr-login-feature-icon">⭐</span>
                </div>
                <div>
                  <p className="kr-login-feature-title">Saved Shortlist</p>
                  <p className="kr-login-feature-sub">Your shortlisted properties stay synced across sessions.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
