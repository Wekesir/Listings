const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const AppleStrategy = require("passport-apple");

function parseBooleanLike(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) {
      return {};
    }
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload);
  } catch (_error) {
    return {};
  }
}

function initializePassport() {
  const googleClientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
  const googleClientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
  const googleCallbackUrl = String(
    process.env.GOOGLE_OAUTH_CALLBACK_URL || "http://localhost:5000/api/auth/oauth/google/callback"
  ).trim();

  if (googleClientId && googleClientSecret) {
    passport.use(
      "google",
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL: googleCallbackUrl
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const emailValue = String(profile?.emails?.[0]?.value || "").trim().toLowerCase();
            const fullName = String(
              profile?.displayName ||
              `${profile?.name?.givenName || ""} ${profile?.name?.familyName || ""}`
            ).trim();
            const emailVerified = parseBooleanLike(profile?.emails?.[0]?.verified, true);
            return done(null, {
              provider: "google",
              providerSubject: String(profile?.id || "").trim(),
              email: emailValue,
              fullName,
              emailVerified
            });
          } catch (error) {
            return done(error);
          }
        }
      )
    );
  } else {
    console.warn("Google OAuth disabled: GOOGLE_OAUTH_CLIENT_ID/SECRET not configured.");
  }

  const appleClientId = String(process.env.APPLE_OAUTH_CLIENT_ID || "").trim();
  const appleTeamId = String(process.env.APPLE_OAUTH_TEAM_ID || "").trim();
  const appleKeyId = String(process.env.APPLE_OAUTH_KEY_ID || "").trim();
  const applePrivateKeyRaw = String(process.env.APPLE_OAUTH_PRIVATE_KEY || "").trim();
  const appleCallbackUrl = String(
    process.env.APPLE_OAUTH_CALLBACK_URL || "http://localhost:5000/api/auth/oauth/apple/callback"
  ).trim();

  if (appleClientId && appleTeamId && appleKeyId && applePrivateKeyRaw) {
    passport.use(
      "apple",
      new AppleStrategy(
        {
          clientID: appleClientId,
          teamID: appleTeamId,
          keyID: appleKeyId,
          privateKeyString: applePrivateKeyRaw.replace(/\\n/g, "\n"),
          callbackURL: appleCallbackUrl,
          passReqToCallback: false
        },
        async (
          _accessToken,
          _refreshToken,
          idToken,
          profile,
          done
        ) => {
          try {
            const tokenPayload = decodeJwtPayload(idToken);
            const providerSubject = String(
              profile?.id || tokenPayload.sub || ""
            ).trim();
            const emailValue = String(profile?.email || tokenPayload.email || "").trim().toLowerCase();
            const fullName = String(profile?.name?.firstName || "").trim();
            const emailVerified = parseBooleanLike(tokenPayload.email_verified, false);
            return done(null, {
              provider: "apple",
              providerSubject,
              email: emailValue,
              fullName,
              emailVerified
            });
          } catch (error) {
            return done(error);
          }
        }
      )
    );
  } else {
    console.warn("Apple OAuth disabled: Apple OAuth env vars not configured.");
  }
}

module.exports = {
  passport,
  initializePassport
};
