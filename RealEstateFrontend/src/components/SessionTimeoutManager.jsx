import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getActiveSession, logoutAccount } from "../services/authService";
import {
  clearStoredSessionMeta,
  clearStoredUser,
  getStoredSessionMeta,
  getStoredUser,
  setStoredUser,
  setStoredSessionMeta
} from "../utils/session";

const ACTIVITY_EVENTS = ["click", "keydown", "mousemove", "scroll", "touchstart"];
const EXPIRY_CHECK_INTERVAL_MS = 15000;
const ACTIVITY_SYNC_INTERVAL_MS = 15000;
const SERVER_SESSION_SYNC_INTERVAL_MS = 60000;

function SessionTimeoutManager() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!getStoredUser()) {
      return undefined;
    }

    const initialMeta = getStoredSessionMeta();
    setStoredSessionMeta({
      timeoutMs: initialMeta.timeoutMs,
      lastActivityAt: initialMeta.lastActivityAt || Date.now()
    });

    let isLoggingOut = false;
    let lastActivitySyncAt = Date.now();

    const forceLogout = async (reason = "sessionExpired=1") => {
      if (isLoggingOut) {
        return;
      }
      isLoggingOut = true;
      const timeoutUser = getStoredUser();

      clearStoredUser();
      clearStoredSessionMeta();
      try {
        await logoutAccount({
          reason: "inactivity_timeout",
          timedOutUser: timeoutUser
            ? {
                id: timeoutUser.id,
                email: timeoutUser.email,
                accountType: timeoutUser.accountType
              }
            : null
        });
      } catch (_error) {
        // Session might already be invalidated server-side.
      }
      if (location.pathname !== "/login") {
        navigate(`/login?${reason}`, { replace: true });
      }
    };

    const syncActivity = () => {
      if (isLoggingOut || !getStoredUser()) {
        return;
      }

      const now = Date.now();
      if (now - lastActivitySyncAt < ACTIVITY_SYNC_INTERVAL_MS) {
        return;
      }

      lastActivitySyncAt = now;
      setStoredSessionMeta({ lastActivityAt: now });
    };

    const checkForExpiry = () => {
      if (isLoggingOut || !getStoredUser()) {
        return;
      }

      const sessionMeta = getStoredSessionMeta();
      const idleDurationMs = Date.now() - sessionMeta.lastActivityAt;
      if (idleDurationMs >= sessionMeta.timeoutMs) {
        void forceLogout();
      }
    };

    const syncWithServerSession = async () => {
      try {
        const data = await getActiveSession();
        if (data?.user) {
          setStoredUser(data.user);
        }
        setStoredSessionMeta({
          timeoutMs: Number(data?.session?.timeoutMs) || initialMeta.timeoutMs,
          lastActivityAt: Date.now()
        });
      } catch (error) {
        const message = String(error?.message || "");
        if (
          message === "No active session" ||
          /session expired|suspended|banned/i.test(message)
        ) {
          const isRestricted = /suspended|banned/i.test(message);
          await forceLogout(isRestricted ? "accountRestricted=1" : "sessionExpired=1");
          return;
        }
        setStoredSessionMeta({ lastActivityAt: Date.now() });
      }
    };

    void syncWithServerSession();
    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, syncActivity, { passive: true });
    });
    checkForExpiry();
    const intervalId = window.setInterval(checkForExpiry, EXPIRY_CHECK_INTERVAL_MS);
    const serverSyncId = window.setInterval(() => {
      void syncWithServerSession();
    }, SERVER_SESSION_SYNC_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, syncActivity);
      });
      window.clearInterval(intervalId);
      window.clearInterval(serverSyncId);
    };
  }, [location.pathname, navigate]);

  return null;
}

export default SessionTimeoutManager;
