function isOnboardingPending(user) {
  if (!user || typeof user !== "object") {
    return false;
  }
  if (user.onboardingPending === true) {
    return true;
  }
  if (user.onboardingCompleted === false) {
    return true;
  }
  return false;
}

function isAllowedPendingPath(req) {
  const method = String(req.method || "").toUpperCase();
  const path = String(req.path || "");

  if (method === "GET" && path === "/api/auth/session") return true;
  if (method === "POST" && path === "/api/auth/logout") return true;
  if (method === "POST" && path === "/api/auth/complete-oauth-signup") return true;
  if (path.startsWith("/api/auth/oauth/")) return true;
  return false;
}

function requireOnboardingComplete(req, res, next) {
  if (!String(req.path || "").startsWith("/api/")) {
    return next();
  }

  const sessionUser = req.session?.user;
  if (!isOnboardingPending(sessionUser)) {
    return next();
  }

  if (isAllowedPendingPath(req)) {
    return next();
  }

  return res.status(403).json({
    message: "Complete your account setup to continue.",
    onboardingRequired: true,
    completionPath: "/complete-signup"
  });
}

module.exports = requireOnboardingComplete;
