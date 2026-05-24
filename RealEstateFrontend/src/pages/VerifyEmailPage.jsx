import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { resendVerificationCode, verifyEmailCode } from "../services/authService";
import { notify } from "../utils/notify";

const RESEND_COOLDOWN_SECONDS = 60;

function VerifyEmailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialEmail = useMemo(
    () => String(new URLSearchParams(location.search).get("email") || "").trim().toLowerCase(),
    [location.search]
  );

  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  useEffect(() => {
    if (cooldownLeft <= 0) {
      return undefined;
    }
    const timer = setTimeout(() => setCooldownLeft((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldownLeft]);

  const handleVerify = async (event) => {
    event.preventDefault();
    if (!email || !code) {
      notify("Enter your email and the verification code.", "warning");
      return;
    }

    setIsVerifying(true);
    try {
      const response = await verifyEmailCode({ email, code });
      notify(response.message || "Email verified successfully.", "success");
      navigate(`/login?verified=1&email=${encodeURIComponent(email)}`, { replace: true });
    } catch (error) {
      notify(error.message || "Failed to verify code.", "danger");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!email) {
      notify("Please enter the email address to resend the code.", "warning");
      return;
    }
    setIsResending(true);
    try {
      const response = await resendVerificationCode({ email });
      notify(response.message || "A new verification code has been sent.", "success");
      setCooldownLeft(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      notify(error.message || "Failed to resend verification code.", "danger");
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="kr-auth-page">
      <div className="kr-auth-shell">
        <div className="kr-auth-side">
          <div className="kr-auth-side-inner">
            <Link to="/" className="kr-auth-side-logo text-decoration-none">
              KenReal<span className="kr-auth-dot"></span>Estates
            </Link>
            <div className="kr-auth-side-hero">
              <div className="kr-auth-side-icon-wrap">
                <span className="kr-auth-side-icon">✉️</span>
              </div>
              <h2 className="kr-auth-side-title">Verify your email address</h2>
              <p className="kr-auth-side-sub">
                We sent a one-time code to your inbox. Enter it to activate your account.
              </p>
            </div>
          </div>
        </div>

        <div className="kr-auth-form-panel">
          <div className="kr-auth-form-scroll">
            <Link to="/register" className="kr-auth-back-link d-inline-flex">
              Back to register
            </Link>
            <div className="kr-auth-form-header">
              <span className="kr-auth-eyebrow-pill">Almost there</span>
              <h1 className="kr-auth-heading">Verify Email</h1>
              <p className="kr-auth-subheading">
                Enter the verification code sent to your email address.
              </p>
            </div>

            <form onSubmit={handleVerify} className="kr-auth-form">
              <div className="kr-field">
                <label className="kr-field-label" htmlFor="verifyEmail">Email Address</label>
                <input
                  id="verifyEmail"
                  type="email"
                  className="form-control kr-field-input"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div className="kr-field">
                <label className="kr-field-label" htmlFor="verifyCode">Verification Code</label>
                <input
                  id="verifyCode"
                  type="text"
                  inputMode="numeric"
                  className="form-control kr-field-input"
                  placeholder="6-digit code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  minLength={6}
                  maxLength={6}
                  required
                />
              </div>

              <button type="submit" className="kr-auth-submit" disabled={isVerifying}>
                {isVerifying ? "Verifying..." : "Verify Email"}
              </button>

              <button
                type="button"
                className="btn btn-outline-secondary w-100 mt-3"
                onClick={handleResend}
                disabled={isResending || cooldownLeft > 0}
              >
                {isResending
                  ? "Sending..."
                  : cooldownLeft > 0
                    ? `Resend code in ${cooldownLeft}s`
                    : "Resend verification code"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VerifyEmailPage;
