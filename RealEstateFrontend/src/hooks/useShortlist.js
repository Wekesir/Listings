import { useEffect, useMemo, useState } from "react";
import {
  addToShortlist,
  getShortlistedProperties,
  removeFromShortlist
} from "../services/propertyService";
import { getStoredUser } from "../utils/session";
import { notify } from "../utils/notify";

const STORAGE_KEY_PREFIX = "kenreal-shortlist";

function parseShortlist(rawValue) {
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(
      parsed
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )];
  } catch (_error) {
    return [];
  }
}

export function useShortlist() {
  const user = getStoredUser();
  const isAuthenticated = Boolean(user?.id);
  const shortlistStorageKey = useMemo(() => {
    const uniqueUser = user?.id || user?.email || "anonymous";
    return `${STORAGE_KEY_PREFIX}:${uniqueUser}`;
  }, [user?.email, user?.id]);
  const [shortlistedIds, setShortlistedIds] = useState([]);

  useEffect(() => {
    const saved = window.localStorage.getItem(shortlistStorageKey);
    setShortlistedIds(saved ? parseShortlist(saved) : []);
  }, [shortlistStorageKey]);

  useEffect(() => {
    window.localStorage.setItem(shortlistStorageKey, JSON.stringify(shortlistedIds));
  }, [shortlistedIds, shortlistStorageKey]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let cancelled = false;

    const syncShortlistFromServer = async () => {
      try {
        const response = await getShortlistedProperties();
        const ids = Array.isArray(response?.propertyIds)
          ? [...new Set(
            response.propertyIds
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0)
          )]
          : [];
        if (!cancelled) {
          setShortlistedIds(ids);
        }
      } catch (_error) {
        // Keep local values when sync fails.
      }
    };

    void syncShortlistFromServer();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, shortlistStorageKey]);

  const shortlistedLookup = useMemo(() => {
    return new Set(shortlistedIds);
  }, [shortlistedIds]);

  const toggleShortlist = async (propertyId) => {
    const normalizedPropertyId = Number(propertyId);
    if (!Number.isFinite(normalizedPropertyId)) return;

    const isCurrentlyShortlisted = shortlistedLookup.has(normalizedPropertyId);

    setShortlistedIds((prev) => {
      if (isCurrentlyShortlisted) {
        return prev.filter((id) => id !== normalizedPropertyId);
      }
      return [...prev, normalizedPropertyId];
    });

    if (!isAuthenticated) return;

    try {
      if (isCurrentlyShortlisted) {
        await removeFromShortlist(normalizedPropertyId);
      } else {
        await addToShortlist(normalizedPropertyId);
      }
    } catch (error) {
      // Rollback optimistic change if API fails.
      setShortlistedIds((prev) => {
        if (isCurrentlyShortlisted) {
          return [...new Set([...prev, normalizedPropertyId])];
        }
        return prev.filter((id) => id !== normalizedPropertyId);
      });
      notify(error.message || "Could not save shortlist update right now.", "warning");
    }
  };

  return {
    shortlistedIds,
    shortlistedLookup,
    toggleShortlist
  };
}
