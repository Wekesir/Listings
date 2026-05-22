import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import PortalLayout from "../components/PortalLayout";
import {
  createProperty,
  createListingPaymentCheckout,
  getListingPaymentStatus,
  getProperties,
  getMyProperties,
  getPropertiesForAdmin,
  updateProperty
} from "../services/propertyService";
import { notify } from "../utils/notify";
import { useShortlist } from "../hooks/useShortlist";
import {
  getFallbackImage,
  hasCustomImage,
  resolvePropertyImageUrl
} from "../utils/propertyMedia";
import PropertyMediaBadge from "../components/PropertyMediaBadge";
import { getStoredUser } from "../utils/session";

const BASIC_INCLUDED_IMAGE_LIMIT = 2;
const PAID_MAX_IMAGE_LIMIT = 12;
const LISTING_STATUS = {
  DRAFT: "draft",
  PUBLISHED: "published"
};
const LISTING_PAYMENT_INTENT = {
  PUBLISH_PREMIUM: "publish_premium",
  UPGRADE_PREMIUM: "upgrade_premium"
};

function formatPrice(price, type) {
  const value = Number(price);
  if (Number.isNaN(value)) return "Price on request";
  const suffix = type === "lease" ? "/mo · Lease" : "/mo · Rent";
  return `KSh ${value.toLocaleString("en-KE")} ${suffix}`;
}

function getNumericPrice(price) {
  const value = Number(price);
  return Number.isFinite(value) ? value : null;
}

function getPopularityScore(item) {
  const explicit = Number(item?.popularityScore);
  if (Number.isFinite(explicit)) return explicit;

  const price = getNumericPrice(item?.price) || 0;
  const typeBoost = String(item?.type || "").toLowerCase() === "rent" ? 6 : 3;
  const idFactor = Number(item?.id) % 9;
  return Math.round((price / 10000) % 40) + typeBoost + idFactor;
}

function getBedroomCount(item) {
  const title = String(item?.title || "").toLowerCase();
  if (title.includes("studio") || title.includes("bedsitter")) return 0;
  const match = title.match(/(\d+)\s*bed/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function buildFilePreviews(files) {
  return files.map((file, index) => ({
    id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    name: file.name,
    sizeLabel: formatFileSize(file.size),
    isVideo: String(file.type || "").toLowerCase().startsWith("video/"),
    previewUrl: URL.createObjectURL(file)
  }));
}

function getFileFingerprint(file) {
  return `${file.name}-${file.size}-${file.lastModified}-${file.type}`;
}

function getUniqueFiles(files, limit) {
  const seen = new Set();
  const uniqueFiles = [];
  let duplicateCount = 0;

  files.forEach((file) => {
    const fingerprint = getFileFingerprint(file);
    if (seen.has(fingerprint)) {
      duplicateCount += 1;
      return;
    }
    seen.add(fingerprint);
    uniqueFiles.push(file);
  });

  return {
    files: uniqueFiles.slice(0, limit),
    duplicateCount
  };
}

function getSuitabilityTags(item) {
  const title = String(item?.title || "").toLowerCase();
  const description = String(item?.description || "").toLowerCase();
  const location = String(item?.location || "").toLowerCase();
  const type = String(item?.type || "").toLowerCase();
  const price = getNumericPrice(item?.price) || 0;
  const text = `${title} ${description} ${location}`;

  const tags = new Set();

  if (type === "lease" || /(office|retail|warehouse|commercial)/.test(text)) {
    tags.add("business");
  } else {
    tags.add("residential");
  }

  if (/(family|townhouse|villa|spacious|gated|garden)/.test(text) || (getBedroomCount(item) ?? 0) >= 3) {
    tags.add("family");
  }

  if (/(studio|bedsitter|compact|student|young professional)/.test(text) || (getBedroomCount(item) ?? -1) <= 1) {
    tags.add("single");
  }

  if (/(luxury|premium|modern|prime)/.test(text) || price >= 200000) {
    tags.add("luxury");
  }

  if (/(affordable|budget|value)/.test(text) || (price > 0 && price <= 35000)) {
    tags.add("budget");
  }

  return tags;
}

function getListingStatus(item) {
  if (item?.isPublished === false) return LISTING_STATUS.DRAFT;
  const normalized = String(item?.listingStatus || "").toLowerCase();
  return normalized === LISTING_STATUS.DRAFT ? LISTING_STATUS.DRAFT : LISTING_STATUS.PUBLISHED;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function ListingsPage() {
  const navigate = useNavigate();
  const currentUser = getStoredUser();
  const isAdmin = currentUser?.accountType === "admin";
  const isLister = currentUser?.accountType === "lister";
  const [allProperties, setAllProperties] = useState([]);
  const [myProperties, setMyProperties] = useState([]);
  const [listerView, setListerView] = useState("mine");
  const [mineStatusFilter, setMineStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [isCreatingListing, setIsCreatingListing] = useState(false);
  const [recentListingId, setRecentListingId] = useState(null);
  const [paymentByListingId, setPaymentByListingId] = useState({});
  const [paymentModalListing, setPaymentModalListing] = useState(null);
  const [selectedProvider, setSelectedProvider] = useState("mpesa");
  const [selectedDurationMonths, setSelectedDurationMonths] = useState(1);
  const [isStartingPayment, setIsStartingPayment] = useState(false);
  const [editingListing, setEditingListing] = useState(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [createImageFiles, setCreateImageFiles] = useState([]);
  const [createVideoFile, setCreateVideoFile] = useState(null);
  const [publishWithPremium, setPublishWithPremium] = useState(false);
  const [editImageFiles, setEditImageFiles] = useState([]);
  const [editVideoFile, setEditVideoFile] = useState(null);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [bedroomFilter, setBedroomFilter] = useState("all");
  const [suitabilityFilter, setSuitabilityFilter] = useState("all");
  const [popularityFilter, setPopularityFilter] = useState("all");
  const [sortBy, setSortBy] = useState("price-desc");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [formState, setFormState] = useState({
    title: "",
    location: "",
    type: "rent",
    price: "",
    description: ""
  });
  const { shortlistedIds, shortlistedLookup, toggleShortlist } = useShortlist();
  const createMaxImageLimit = publishWithPremium ? PAID_MAX_IMAGE_LIMIT : BASIC_INCLUDED_IMAGE_LIMIT;
  const createImagePreviews = useMemo(() => buildFilePreviews(createImageFiles), [createImageFiles]);
  const createVideoPreview = useMemo(
    () => (createVideoFile ? buildFilePreviews([createVideoFile])[0] : null),
    [createVideoFile]
  );
  const editImagePreviews = useMemo(() => buildFilePreviews(editImageFiles), [editImageFiles]);
  const editVideoPreview = useMemo(
    () => (editVideoFile ? buildFilePreviews([editVideoFile])[0] : null),
    [editVideoFile]
  );

  useEffect(() => {
    return () => {
      createImagePreviews.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, [createImagePreviews]);

  useEffect(() => {
    return () => {
      if (createVideoPreview?.previewUrl) {
        URL.revokeObjectURL(createVideoPreview.previewUrl);
      }
    };
  }, [createVideoPreview]);

  useEffect(() => {
    return () => {
      editImagePreviews.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, [editImagePreviews]);

  useEffect(() => {
    return () => {
      if (editVideoPreview?.previewUrl) {
        URL.revokeObjectURL(editVideoPreview.previewUrl);
      }
    };
  }, [editVideoPreview]);

  useEffect(() => {
    if (publishWithPremium) return;
    setCreateVideoFile(null);
    setCreateImageFiles((prev) => prev.slice(0, BASIC_INCLUDED_IMAGE_LIMIT));
  }, [publishWithPremium]);

  useEffect(() => {
    const loadProperties = async () => {
      try {
        if (isAdmin) {
          const data = await getPropertiesForAdmin(true);
          setAllProperties(Array.isArray(data) ? data : []);
          setMyProperties(
            Array.isArray(data)
              ? data.filter((item) => Number(item?.ownerId) === Number(currentUser?.id))
              : []
          );
        } else if (isLister) {
          const [allData, mineData] = await Promise.all([getProperties(), getMyProperties()]);
          setAllProperties(Array.isArray(allData) ? allData : []);
          setMyProperties(Array.isArray(mineData) ? mineData : []);
        } else {
          const data = await getProperties();
          setAllProperties(Array.isArray(data) ? data : []);
          setMyProperties([]);
        }
      } catch (_error) {
        notify("Unable to load listings right now.", "warning");
      } finally {
        setLoading(false);
      }
    };
    loadProperties();
  }, [isAdmin, isLister, currentUser?.id]);

  useEffect(() => {
    if (!isLister || myProperties.length === 0) {
      setPaymentByListingId({});
      return;
    }

    let active = true;
    const loadPaymentStatuses = async () => {
      const entries = await Promise.all(
        myProperties.map(async (item) => {
          try {
            const status = await getListingPaymentStatus(item.id);
            return [item.id, status];
          } catch (_error) {
            return [item.id, null];
          }
        })
      );
      if (!active) return;
      const mapped = {};
      entries.forEach(([id, status]) => {
        mapped[id] = status;
      });
      setPaymentByListingId(mapped);
    };

    void loadPaymentStatuses();
    return () => {
      active = false;
    };
  }, [isLister, myProperties]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateImageFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    const result = getUniqueFiles(files, createMaxImageLimit);
    if (result.duplicateCount > 0) {
      notify("Duplicate images were skipped. Each image can only be uploaded once per listing.", "warning");
    }
    setCreateImageFiles(result.files);
  };

  const handleCreateVideoFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    setCreateVideoFile(file);
  };

  const handleRemoveCreateImage = (targetIndex) => {
    setCreateImageFiles((prev) => prev.filter((_, index) => index !== targetIndex));
  };

  const handleCreateListing = async (event) => {
    event.preventDefault();
    if (!isLister) return;

    if (!currentUser?.id) {
      notify("Session expired. Please log in again.", "warning");
      return;
    }

    if (createImageFiles.length === 0) {
      notify("Please upload at least one image from your device.", "warning");
      return;
    }

    if (createImageFiles.length > createMaxImageLimit) {
      notify(
        publishWithPremium
          ? `Premium publish supports up to ${PAID_MAX_IMAGE_LIMIT} images.`
          : `A basic listing includes up to ${BASIC_INCLUDED_IMAGE_LIMIT} images before payment.`,
        "warning"
      );
      return;
    }

    setIsCreatingListing(true);
    try {
      const paymentIntent = publishWithPremium
        ? LISTING_PAYMENT_INTENT.PUBLISH_PREMIUM
        : LISTING_PAYMENT_INTENT.UPGRADE_PREMIUM;
      const payload = new FormData();
      payload.append("ownerId", String(currentUser.id));
      payload.append("title", formState.title);
      payload.append("location", formState.location);
      payload.append("type", formState.type);
      payload.append("price", String(Number(formState.price)));
      payload.append("description", formState.description);
      payload.append("paymentIntent", paymentIntent);
      createImageFiles.forEach((file) => {
        payload.append("images", file);
      });
      if (publishWithPremium && createVideoFile) {
        payload.append("video", createVideoFile);
      }

      const response = await createProperty(payload);

      const created = response?.property;
      if (created) {
        setMyProperties((prev) => [created, ...prev]);
        if (getListingStatus(created) !== LISTING_STATUS.DRAFT) {
          setAllProperties((prev) => [created, ...prev]);
        }
        setRecentListingId(created.id || null);
      }
      setFormState({
        title: "",
        location: "",
        type: "rent",
        price: "",
        description: ""
      });
      setCreateImageFiles([]);
      setCreateVideoFile(null);
      setPublishWithPremium(false);
      setListerView("mine");
      if (created && getListingStatus(created) === LISTING_STATUS.DRAFT) {
        notify(response?.message || "Draft saved. Complete payment to publish your premium listing.", "success");
        void openPaymentModal(created);
      } else {
        notify(response?.message || "Listing published successfully.", "success");
      }
    } catch (error) {
      notify(error.message || "Could not create listing right now.", "danger");
    } finally {
      setIsCreatingListing(false);
    }
  };

  const upsertPropertyInState = (updatedProperty) => {
    setAllProperties((prev) => {
      const exists = prev.some((item) => Number(item.id) === Number(updatedProperty.id));
      if (exists) {
        return prev.map((item) => (Number(item.id) === Number(updatedProperty.id) ? updatedProperty : item));
      }
      if (getListingStatus(updatedProperty) === LISTING_STATUS.PUBLISHED) {
        return [updatedProperty, ...prev];
      }
      return prev;
    });
    setMyProperties((prev) => {
      const exists = prev.some((item) => Number(item.id) === Number(updatedProperty.id));
      if (exists) {
        return prev.map((item) => (Number(item.id) === Number(updatedProperty.id) ? updatedProperty : item));
      }
      return [updatedProperty, ...prev];
    });
  };

  const openPaymentModal = async (listing, event) => {
    event?.stopPropagation();
    setPaymentModalListing(listing);
    setSelectedDurationMonths(1);
    const known = paymentByListingId[listing.id];
    if (known?.recommendedProvider) {
      setSelectedProvider(known.recommendedProvider);
    } else {
      setSelectedProvider("mpesa");
      try {
        const fresh = await getListingPaymentStatus(listing.id);
        setPaymentByListingId((prev) => ({ ...prev, [listing.id]: fresh }));
        setSelectedProvider(fresh?.recommendedProvider || "mpesa");
      } catch (_error) {
        // keep modal usable with default provider
      }
    }
  };

  const handleStartCheckout = async () => {
    if (!paymentModalListing) return;
    setIsStartingPayment(true);
    try {
      const listingStatus = getListingStatus(paymentModalListing);
      const paymentIntent = listingStatus === LISTING_STATUS.DRAFT
        ? LISTING_PAYMENT_INTENT.PUBLISH_PREMIUM
        : LISTING_PAYMENT_INTENT.UPGRADE_PREMIUM;
      const response = await createListingPaymentCheckout(paymentModalListing.id, {
        provider: selectedProvider,
        months: selectedDurationMonths,
        paymentIntent
      });
      const latestStatus = await getListingPaymentStatus(paymentModalListing.id);
      setPaymentByListingId((prev) => ({ ...prev, [paymentModalListing.id]: latestStatus }));

      if (response?.checkoutUrl) {
        window.location.assign(response.checkoutUrl);
        return;
      }

      if (latestStatus?.paymentStatus === "paid") {
        upsertPropertyInState({
          ...paymentModalListing,
          paymentStatus: "paid",
          premiumMediaUnlocked: true,
          listingStatus: latestStatus?.listingStatus || LISTING_STATUS.PUBLISHED,
          isPublished: Boolean(latestStatus?.isPublished ?? true),
          isExpired: Boolean(latestStatus?.isExpired ?? false),
          visibilityExpiresAt: latestStatus?.visibilityExpiresAt || null,
          expiredAt: latestStatus?.expiredAt || null
        });
      }
      notify(response?.message || "Payment initiated successfully.", "success");
      setPaymentModalListing(null);
    } catch (error) {
      notify(error.message || "Could not start payment checkout.", "danger");
    } finally {
      setIsStartingPayment(false);
    }
  };

  const openEditModal = (listing, event) => {
    event?.stopPropagation();
    setEditingListing(listing);
    setFormState({
      title: listing.title || "",
      location: listing.location || "",
      type: listing.type || "rent",
      price: String(listing.price || ""),
      description: listing.description || ""
    });
    setEditImageFiles([]);
    setEditVideoFile(null);
  };

  const handleRemoveEditImage = (targetIndex) => {
    setEditImageFiles((prev) => prev.filter((_, index) => index !== targetIndex));
  };

  const handleEditImageFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    const paymentMeta = getPaymentMeta(editingListing || {});
    const limit = paymentMeta.premiumMediaUnlocked ? PAID_MAX_IMAGE_LIMIT : BASIC_INCLUDED_IMAGE_LIMIT;
    const result = getUniqueFiles(files, limit);
    if (result.duplicateCount > 0) {
      notify("Duplicate images were skipped. Each image can only be uploaded once per listing.", "warning");
    }
    setEditImageFiles(result.files);
  };

  const handleSaveEdit = async (event) => {
    event.preventDefault();
    if (!editingListing) return;
    setIsSavingEdit(true);
    try {
      const payload = new FormData();
      payload.append("title", formState.title);
      payload.append("location", formState.location);
      payload.append("type", formState.type);
      payload.append("price", String(Number(formState.price)));
      payload.append("description", formState.description);
      editImageFiles.forEach((file) => {
        payload.append("images", file);
      });
      if (editVideoFile) {
        payload.append("video", editVideoFile);
      }

      const response = await updateProperty(editingListing.id, payload);
      if (response?.property) {
        upsertPropertyInState(response.property);
      }
      notify(response?.message || "Listing updated successfully.", "success");
      setEditingListing(null);
    } catch (error) {
      notify(error.message || "Could not update listing.", "danger");
    } finally {
      setIsSavingEdit(false);
    }
  };

  useEffect(() => {
    if (!isFilterModalOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsFilterModalOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFilterModalOpen]);

  const scopedProperties = useMemo(() => {
    if (isLister) {
      if (listerView === "mine") {
        if (mineStatusFilter === "all") return myProperties;
        return myProperties.filter((item) => getListingStatus(item) === mineStatusFilter);
      }
      return allProperties;
    }
    return allProperties;
  }, [isLister, listerView, mineStatusFilter, myProperties, allProperties]);

  const myListingCounts = useMemo(() => {
    const draft = myProperties.filter((item) => getListingStatus(item) === LISTING_STATUS.DRAFT).length;
    const published = myProperties.filter((item) => getListingStatus(item) === LISTING_STATUS.PUBLISHED).length;
    return {
      all: myProperties.length,
      draft,
      published
    };
  }, [myProperties]);

  const locationOptions = useMemo(() => {
    return [...new Set(scopedProperties.map((item) => item.location).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  }, [scopedProperties]);

  const displayedProperties = useMemo(() => {
    let filtered = [...scopedProperties];
    const q = searchTerm.trim().toLowerCase();
    const minValue = minPrice.trim() ? Number(minPrice) : null;
    const maxValue = maxPrice.trim() ? Number(maxPrice) : null;

    if (q) {
      filtered = filtered.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.location.toLowerCase().includes(q)
      );
    }

    if (locationFilter !== "all") {
      filtered = filtered.filter((item) => item.location === locationFilter);
    }

    if (typeFilter !== "all") {
      filtered = filtered.filter(
        (item) => String(item.type || "").toLowerCase() === typeFilter
      );
    }

    if (bedroomFilter !== "all") {
      filtered = filtered.filter((item) => {
        const count = getBedroomCount(item);
        if (bedroomFilter === "studio") return count === 0;
        if (bedroomFilter === "4plus") return count !== null && count >= 4;
        return count === Number(bedroomFilter);
      });
    }

    if (suitabilityFilter !== "all") {
      filtered = filtered.filter((item) => getSuitabilityTags(item).has(suitabilityFilter));
    }

    if (Number.isFinite(minValue)) {
      filtered = filtered.filter((item) => {
        const price = getNumericPrice(item.price);
        return price !== null && price >= minValue;
      });
    }

    if (Number.isFinite(maxValue)) {
      filtered = filtered.filter((item) => {
        const price = getNumericPrice(item.price);
        return price !== null && price <= maxValue;
      });
    }

    if (popularityFilter === "popular" && filtered.length > 0) {
      const scores = filtered
        .map((item) => getPopularityScore(item))
        .sort((a, b) => b - a);
      const thresholdIndex = Math.max(0, Math.ceil(scores.length * 0.4) - 1);
      const threshold = scores[thresholdIndex] ?? 0;
      filtered = filtered.filter((item) => getPopularityScore(item) >= threshold);
    }

    filtered.sort((a, b) => {
      if (sortBy === "price-asc") {
        return (getNumericPrice(a.price) ?? Number.MAX_SAFE_INTEGER) -
          (getNumericPrice(b.price) ?? Number.MAX_SAFE_INTEGER);
      }
      if (sortBy === "price-desc") {
        return (getNumericPrice(b.price) ?? 0) - (getNumericPrice(a.price) ?? 0);
      }
      if (sortBy === "popularity-desc") {
        return getPopularityScore(b) - getPopularityScore(a);
      }
      if (sortBy === "popularity-asc") {
        return getPopularityScore(a) - getPopularityScore(b);
      }
      return 0;
    });

    return filtered;
  }, [
    scopedProperties,
    searchTerm,
    locationFilter,
    typeFilter,
    bedroomFilter,
    suitabilityFilter,
    popularityFilter,
    sortBy,
    minPrice,
    maxPrice
  ]);

  const activeFilterCount = useMemo(() => {
    const flags = [
      locationFilter !== "all",
      typeFilter !== "all",
      bedroomFilter !== "all",
      suitabilityFilter !== "all",
      popularityFilter !== "all",
      sortBy !== "price-desc",
      minPrice.trim() !== "",
      maxPrice.trim() !== ""
    ];
    return flags.filter(Boolean).length;
  }, [
    locationFilter,
    typeFilter,
    bedroomFilter,
    suitabilityFilter,
    popularityFilter,
    sortBy,
    minPrice,
    maxPrice
  ]);

  const activeFilterChips = useMemo(() => {
    const chips = [];

    if (locationFilter !== "all") {
      chips.push({
        key: "location",
        label: `Location: ${locationFilter}`,
        onRemove: () => setLocationFilter("all")
      });
    }

    if (typeFilter !== "all") {
      chips.push({
        key: "type",
        label: `Type: ${typeFilter === "rent" ? "Rent" : "Lease"}`,
        onRemove: () => setTypeFilter("all")
      });
    }

    if (bedroomFilter !== "all") {
      const bedLabelMap = {
        studio: "Studio / Bedsitter",
        "1": "1 bedroom",
        "2": "2 bedrooms",
        "3": "3 bedrooms",
        "4plus": "4+ bedrooms"
      };
      chips.push({
        key: "bedrooms",
        label: `Bedrooms: ${bedLabelMap[bedroomFilter] || bedroomFilter}`,
        onRemove: () => setBedroomFilter("all")
      });
    }

    if (suitabilityFilter !== "all") {
      const suitabilityMap = {
        family: "Family living",
        single: "Single / Student",
        business: "Business use",
        luxury: "Luxury preference",
        budget: "Budget-friendly"
      };
      chips.push({
        key: "bestfor",
        label: `Best for: ${suitabilityMap[suitabilityFilter] || suitabilityFilter}`,
        onRemove: () => setSuitabilityFilter("all")
      });
    }

    if (popularityFilter !== "all") {
      chips.push({
        key: "popularity",
        label: "Popularity: Most popular",
        onRemove: () => setPopularityFilter("all")
      });
    }

    if (sortBy !== "price-desc") {
      const sortMap = {
        "price-asc": "Price: Low to high",
        "price-desc": "Price: High to low",
        "popularity-desc": "Popularity: High to low",
        "popularity-asc": "Popularity: Low to high"
      };
      chips.push({
        key: "sort",
        label: `Sort: ${sortMap[sortBy] || sortBy}`,
        onRemove: () => setSortBy("price-desc")
      });
    }

    if (minPrice.trim() !== "" || maxPrice.trim() !== "") {
      chips.push({
        key: "price-range",
        label: `Price: ${minPrice.trim() || "0"} - ${maxPrice.trim() || "Any"} KSh`,
        onRemove: () => {
          setMinPrice("");
          setMaxPrice("");
        }
      });
    }

    return chips;
  }, [
    locationFilter,
    typeFilter,
    bedroomFilter,
    suitabilityFilter,
    popularityFilter,
    sortBy,
    minPrice,
    maxPrice
  ]);

  const resetAllFilters = () => {
    setLocationFilter("all");
    setTypeFilter("all");
    setBedroomFilter("all");
    setSuitabilityFilter("all");
    setPopularityFilter("all");
    setSortBy("price-desc");
    setMinPrice("");
    setMaxPrice("");
    setSearchTerm("");
  };

  const getPaymentMeta = (item) => {
    const statusPayload = paymentByListingId[item.id];
    const paymentStatus = String(statusPayload?.paymentStatus || item.paymentStatus || "unpaid").toLowerCase();
    const premiumMediaUnlocked = Boolean(
      statusPayload?.premiumMediaUnlocked ?? item.premiumMediaUnlocked
    );
    const recommendedProvider = String(statusPayload?.recommendedProvider || "mpesa").toLowerCase();
    const pricingByMonths = Array.isArray(statusPayload?.pricingByMonths)
      ? statusPayload.pricingByMonths
      : [];
    const selectedQuote = pricingByMonths.find((quote) => Number(quote?.months) === Number(selectedDurationMonths))
      || pricingByMonths[0]
      || null;
    const amountUsd = Number(selectedQuote?.totalUsd || statusPayload?.listingFeeAmountUsd || 19);
    const amountKes = Number(selectedQuote?.totalKes || statusPayload?.listingFeeAmountKes || 0);
    const exchangeRate = statusPayload?.exchangeRate || null;
    const visibilityExpiresAt = statusPayload?.visibilityExpiresAt || item?.visibilityExpiresAt || null;
    const isExpired = Boolean(statusPayload?.isExpired ?? item?.isExpired);
    return {
      paymentStatus,
      premiumMediaUnlocked,
      recommendedProvider,
      amountUsd,
      amountKes,
      exchangeRate,
      isExpired,
      visibilityExpiresAt,
      pricingByMonths,
      selectedQuote
    };
  };

  return (
    <PortalLayout
      title={isLister ? "Listings Workspace" : "All Listings"}
      subtitle={isLister
        ? "Create new listings and switch between your published listings and all marketplace listings."
        : "Browse every available property and save your favourites."}
    >
      {isLister && (
        <div className="kr-listings-composer">
          <div className="kr-listings-composer-head">
            <div>
              <p className="kr-listings-composer-eyebrow">Create listing</p>
              <h3 className="kr-listings-composer-title">Publish a new property</h3>
              <p className="kr-listings-composer-sub">
                Your listing appears in <strong>My Listings</strong> and <strong>All Listings</strong> once published.
              </p>
            </div>
            <span className="kr-listings-plan-pill">
              Per-listing fee varies by value and period
            </span>
          </div>
          <form className="kr-listings-composer-form" onSubmit={handleCreateListing}>
            <div className="row g-3">
              <div className="col-md-6">
                <label className="kr-form-label" htmlFor="listingComposerTitle">Listing title</label>
                <input
                  id="listingComposerTitle"
                  name="title"
                  className="kr-form-input"
                  value={formState.title}
                  onChange={handleInputChange}
                  placeholder="e.g. 2 Bedroom Apartment in Kilimani"
                  required
                />
              </div>
              <div className="col-md-6">
                <label className="kr-form-label" htmlFor="listingComposerLocation">Location</label>
                <input
                  id="listingComposerLocation"
                  name="location"
                  className="kr-form-input"
                  value={formState.location}
                  onChange={handleInputChange}
                  placeholder="e.g. Kilimani, Nairobi"
                  required
                />
              </div>
              <div className="col-md-4">
                <label className="kr-form-label" htmlFor="listingComposerType">Listing type</label>
                <select
                  id="listingComposerType"
                  name="type"
                  className="kr-form-input kr-form-select"
                  value={formState.type}
                  onChange={handleInputChange}
                  required
                >
                  <option value="rent">Rent</option>
                  <option value="lease">Lease</option>
                </select>
              </div>
              <div className="col-md-4">
                <label className="kr-form-label" htmlFor="listingComposerPrice">Monthly price (KSh)</label>
                <input
                  id="listingComposerPrice"
                  name="price"
                  type="number"
                  min="1"
                  className="kr-form-input"
                  value={formState.price}
                  onChange={handleInputChange}
                  placeholder="e.g. 65000"
                  required
                />
              </div>
              <div className="col-12">
                <label className="kr-form-label">Publish mode</label>
                <div className="kr-uac-modal-field">
                  <label className="kr-listing-provider-option">
                    <input
                      type="checkbox"
                      checked={publishWithPremium}
                      onChange={(event) => setPublishWithPremium(event.target.checked)}
                    />
                    Pay before publish to unlock premium media (up to {PAID_MAX_IMAGE_LIMIT} images + video)
                  </label>
                  <small className="kr-form-helper-text">
                    {publishWithPremium
                      ? "Your listing is saved as a draft until payment succeeds, then it is published with premium features."
                      : `Basic publish goes live immediately with up to ${BASIC_INCLUDED_IMAGE_LIMIT} images. You can still upgrade later.`}
                  </small>
                </div>
              </div>
              <div className="col-md-4">
                <label className="kr-form-label">
                  Listing images
                  <span className="kr-form-label-optional">required · up to {createMaxImageLimit}</span>
                </label>
                <input
                  id="listingComposerImages"
                  type="file"
                  className="kr-form-input"
                  accept="image/*"
                  multiple
                  onChange={handleCreateImageFileChange}
                  required
                />
                <div className="kr-media-meta-row">
                  <small className="kr-media-count">
                    {createImageFiles.length} / {createMaxImageLimit} selected
                  </small>
                </div>
                {createImagePreviews.length > 0 && (
                  <div className="kr-upload-preview-grid-wrap">
                    <p className="kr-upload-preview-grid-title">Selected media preview</p>
                    <div className="kr-upload-preview-grid">
                    {createImagePreviews.map((filePreview, index) => (
                      <div className={`kr-upload-preview-card${filePreview.isVideo ? " kr-upload-preview-card--video" : ""}`} key={filePreview.id}>
                        <span className="kr-upload-preview-kind">
                          {filePreview.isVideo ? "Video" : "Image"}
                        </span>
                        <button
                          type="button"
                          className="kr-upload-preview-remove"
                          aria-label={`Remove ${filePreview.name}`}
                          onClick={() => handleRemoveCreateImage(index)}
                        >
                          ×
                        </button>
                        <img
                          src={filePreview.previewUrl}
                          alt={filePreview.name}
                          className="kr-upload-preview-media"
                        />
                        <div className="kr-upload-preview-meta">
                          <span className="kr-upload-preview-name">{filePreview.name}</span>
                          <span className="kr-upload-preview-size">{filePreview.sizeLabel}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  </div>
                )}
              </div>
              <div className="col-md-8">
                <label className="kr-form-label" htmlFor="listingComposerVideo">
                  Video tour upload
                  <span className="kr-form-label-optional">
                    {publishWithPremium ? "optional premium media" : "locked until payment"}
                  </span>
                </label>
                <input
                  id="listingComposerVideo"
                  type="file"
                  accept="video/*"
                  className="kr-form-input"
                  onChange={handleCreateVideoFileChange}
                  disabled={!publishWithPremium}
                />
                {!publishWithPremium && (
                  <small className="kr-form-helper-text">
                    Enable premium-before-publish to upload video now.
                  </small>
                )}
                {createVideoPreview && (
                  <div className="kr-upload-preview-grid-wrap">
                    <p className="kr-upload-preview-grid-title">Selected media preview</p>
                    <div className="kr-upload-preview-grid kr-upload-preview-grid--single">
                    <div className="kr-upload-preview-card kr-upload-preview-card--video" key={createVideoPreview.id}>
                      <span className="kr-upload-preview-kind">Video</span>
                      <button
                        type="button"
                        className="kr-upload-preview-remove"
                        aria-label={`Remove ${createVideoPreview.name}`}
                        onClick={() => setCreateVideoFile(null)}
                      >
                        ×
                      </button>
                      <video
                        src={createVideoPreview.previewUrl}
                        className="kr-upload-preview-media"
                        controls
                        preload="metadata"
                      />
                      <div className="kr-upload-preview-meta">
                        <span className="kr-upload-preview-name">{createVideoPreview.name}</span>
                        <span className="kr-upload-preview-size">{createVideoPreview.sizeLabel}</span>
                      </div>
                    </div>
                  </div>
                  </div>
                )}
              </div>
              <div className="col-12">
                <label className="kr-form-label" htmlFor="listingComposerDescription">Description</label>
                <textarea
                  id="listingComposerDescription"
                  name="description"
                  rows="3"
                  className="kr-form-input"
                  value={formState.description}
                  onChange={handleInputChange}
                  placeholder="Describe the property layout, amenities, and standout features..."
                  required
                />
              </div>
            </div>
            <div className="kr-listings-composer-actions">
              {recentListingId && (
                <button
                  type="button"
                  className="kr-listings-view-created-btn"
                  onClick={() => navigate(`/listings/${recentListingId}`)}
                >
                  View latest listing
                </button>
              )}
              <button type="submit" className="kr-listings-create-btn" disabled={isCreatingListing}>
                {isCreatingListing
                  ? (publishWithPremium ? "Saving draft..." : "Publishing...")
                  : (publishWithPremium ? "Save draft & continue to payment" : "Publish listing")}
              </button>
            </div>
          </form>
        </div>
      )}

      {isLister && (
        <div className="kr-listings-tabs-wrap">
          <div className="kr-listings-tabs">
            <button
              type="button"
              className={`kr-listings-tab-btn${listerView === "mine" ? " active" : ""}`}
              onClick={() => setListerView("mine")}
            >
              My Listings ({myProperties.length})
            </button>
            <button
              type="button"
              className={`kr-listings-tab-btn${listerView === "all" ? " active" : ""}`}
              onClick={() => setListerView("all")}
            >
              All Listings ({allProperties.length})
            </button>
          </div>
          {listerView === "mine" && (
            <div className="kr-listings-tabs kr-listings-subtabs">
              <button
                type="button"
                className={`kr-listings-tab-btn${mineStatusFilter === "all" ? " active" : ""}`}
                onClick={() => setMineStatusFilter("all")}
              >
                All ({myListingCounts.all})
              </button>
              <button
                type="button"
                className={`kr-listings-tab-btn${mineStatusFilter === LISTING_STATUS.DRAFT ? " active" : ""}`}
                onClick={() => setMineStatusFilter(LISTING_STATUS.DRAFT)}
              >
                Drafts ({myListingCounts.draft})
              </button>
              <button
                type="button"
                className={`kr-listings-tab-btn${mineStatusFilter === LISTING_STATUS.PUBLISHED ? " active" : ""}`}
                onClick={() => setMineStatusFilter(LISTING_STATUS.PUBLISHED)}
              >
                Published ({myListingCounts.published})
              </button>
            </div>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="kr-portal-toolbar">
        <div className="kr-portal-search-wrap">
          <svg className="kr-portal-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            className="kr-portal-search"
            placeholder="Search by title or location…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              type="button"
              className="kr-portal-search-clear"
              onClick={() => setSearchTerm("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
        <span className="kr-portal-result-count">
          {displayedProperties.length} {displayedProperties.length === 1 ? "result" : "results"}
        </span>
        <button
          type="button"
          className="kr-shortlist-browse-btn"
          onClick={() => navigate("/shortlist")}
        >
          Shortlist ({shortlistedIds.length})
        </button>
        <button
          type="button"
          className="kr-portal-filter-open-btn"
          onClick={() => setIsFilterModalOpen(true)}
          aria-label="Open filters"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
          </svg>
          Filters
          {activeFilterCount > 0 && (
            <span className="kr-portal-filter-open-count">{activeFilterCount}</span>
          )}
        </button>
      </div>

      {isFilterModalOpen && (
        <div
          className="kr-portal-filter-modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsFilterModalOpen(false);
          }}
        >
          <div className="kr-portal-filter-modal" role="dialog" aria-modal="true" aria-label="Filter listings">

            {/* ── Header ── */}
            <div className="kr-portal-filter-modal-head">
              <div className="kr-portal-filter-modal-head-left">
                <span className="kr-portal-filter-modal-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                  </svg>
                </span>
                <div>
                  <h3 className="kr-portal-filter-modal-title">Filter listings</h3>
                  <p className="kr-portal-filter-modal-subtitle">
                    {activeFilterCount > 0
                      ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied · ${displayedProperties.length} result${displayedProperties.length === 1 ? "" : "s"}`
                      : `All ${displayedProperties.length} listings shown`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="kr-portal-filter-modal-close"
                onClick={() => setIsFilterModalOpen(false)}
                aria-label="Close filters"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* ── Filter grid ── */}
            <div className="kr-filter-modal-body">

              {/* Location */}
              <div className="kr-filter-section">
                <div className="kr-filter-section-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                  Location
                </div>
                <select
                  className="kr-portal-filter-select"
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                >
                  <option value="all">All locations</option>
                  {locationOptions.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>

              {/* Listing type */}
              <div className="kr-filter-section">
                <div className="kr-filter-section-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                  Listing type
                </div>
                <div className="kr-filter-pill-group">
                  {[
                    { value: "all", label: "Any" },
                    { value: "rent", label: "Rent" },
                    { value: "lease", label: "Lease" }
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      className={`kr-filter-pill${typeFilter === value ? " active" : ""}`}
                      onClick={() => setTypeFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bedrooms */}
              <div className="kr-filter-section">
                <div className="kr-filter-section-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/>
                    <path d="M2 17h20"/><path d="M6 8v9"/>
                  </svg>
                  Bedrooms
                </div>
                <div className="kr-filter-pill-group">
                  {[
                    { value: "all", label: "Any" },
                    { value: "studio", label: "Studio" },
                    { value: "1", label: "1" },
                    { value: "2", label: "2" },
                    { value: "3", label: "3" },
                    { value: "4plus", label: "4+" }
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      className={`kr-filter-pill${bedroomFilter === value ? " active" : ""}`}
                      onClick={() => setBedroomFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Best for */}
              <div className="kr-filter-section">
                <div className="kr-filter-section-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  Best for
                </div>
                <div className="kr-filter-pill-group">
                  {[
                    { value: "all", label: "Anything" },
                    { value: "family", label: "Family" },
                    { value: "single", label: "Single / Student" },
                    { value: "business", label: "Business" },
                    { value: "luxury", label: "Luxury" },
                    { value: "budget", label: "Budget" }
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      className={`kr-filter-pill${suitabilityFilter === value ? " active" : ""}`}
                      onClick={() => setSuitabilityFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Popularity */}
              <div className="kr-filter-section">
                <div className="kr-filter-section-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                  Popularity
                </div>
                <div className="kr-filter-pill-group">
                  {[
                    { value: "all", label: "All" },
                    { value: "popular", label: "Most popular" }
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      className={`kr-filter-pill${popularityFilter === value ? " active" : ""}`}
                      onClick={() => setPopularityFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sort */}
              <div className="kr-filter-section">
                <div className="kr-filter-section-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <line x1="3" y1="12" x2="15" y2="12"/>
                    <line x1="3" y1="18" x2="9" y2="18"/>
                  </svg>
                  Sort by
                </div>
                <div className="kr-filter-pill-group">
                  {[
                    { value: "price-desc", label: "Price ↓" },
                    { value: "price-asc", label: "Price ↑" },
                    { value: "popularity-desc", label: "Popular ↓" },
                    { value: "popularity-asc", label: "Popular ↑" }
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      className={`kr-filter-pill${sortBy === value ? " active" : ""}`}
                      onClick={() => setSortBy(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price range */}
              <div className="kr-filter-section kr-filter-section--full">
                <div className="kr-filter-section-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23"/>
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                  </svg>
                  Price range (KSh / month)
                </div>
                <div className="kr-filter-price-range">
                  <div className="kr-filter-price-input-wrap">
                    <span className="kr-filter-price-currency">KSh</span>
                    <input
                      type="number"
                      min="0"
                      className="kr-filter-price-input"
                      placeholder="Minimum"
                      value={minPrice}
                      onChange={(e) => setMinPrice(e.target.value)}
                      aria-label="Minimum price"
                    />
                  </div>
                  <div className="kr-filter-price-dash">
                    <svg width="14" height="2" viewBox="0 0 14 2" fill="none">
                      <line x1="0" y1="1" x2="14" y2="1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div className="kr-filter-price-input-wrap">
                    <span className="kr-filter-price-currency">KSh</span>
                    <input
                      type="number"
                      min="0"
                      className="kr-filter-price-input"
                      placeholder="Maximum"
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                      aria-label="Maximum price"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="kr-portal-filter-modal-actions">
              <button
                type="button"
                className="kr-portal-filter-reset"
                onClick={resetAllFilters}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
                Reset all filters
              </button>
              <button
                type="button"
                className="kr-portal-filter-apply"
                onClick={() => setIsFilterModalOpen(false)}
              >
                Show {displayedProperties.length} result{displayedProperties.length === 1 ? "" : "s"}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {activeFilterChips.length > 0 && (
        <div className="kr-portal-active-filters">
          <div className="kr-portal-active-filters-head">
            <span className="kr-portal-active-filters-title">Active filters</span>
            <button
              type="button"
              className="kr-portal-active-filters-clear"
              onClick={resetAllFilters}
            >
              Clear all
            </button>
          </div>
          <div className="kr-portal-active-filters-list">
            {activeFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="kr-portal-filter-chip"
                onClick={chip.onRemove}
                title={`Remove ${chip.label}`}
              >
                {chip.label}
                <span className="kr-portal-filter-chip-x">×</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* States */}
      {loading ? (
        <div className="kr-portal-state">
          <span className="kr-portal-state-spinner"></span>
          <span>Loading listings…</span>
        </div>
      ) : displayedProperties.length === 0 ? (
        <div className="kr-portal-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.35, marginBottom: "10px" }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <p style={{ margin: 0 }}>No listings match your search.</p>
        </div>
      ) : (
        <div className="row g-4">
          {displayedProperties.map((item) => {
            const isShortlisted = shortlistedLookup.has(item.id);
            const customImage = hasCustomImage(item.imageUrl);
            const isSoftDeleted = Boolean(item.isSoftDeleted);
            const isOwnedByCurrentUser = Number(item.ownerId) === Number(currentUser?.id);
            const listingStatus = getListingStatus(item);
            const isDraftListing = listingStatus === LISTING_STATUS.DRAFT;
            const paymentMeta = getPaymentMeta(item);
            const shouldShowPayCta = paymentMeta.isExpired || !paymentMeta.premiumMediaUnlocked;
            return (
              <div className="col-md-6 col-xl-4" key={item.id}>
                <div
                  className={`kr-portal-listing-card${isSoftDeleted ? " kr-portal-listing-card--soft-deleted" : ""}`}
                  onClick={() => navigate(`/listings/${item.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Image zone */}
                  <div
                    className={`kr-portal-listing-media kr-portal-listing-media-${item.type}${customImage ? "" : " kr-has-fallback-image"}`}
                  >
                    <img
                      src={resolvePropertyImageUrl(item.imageUrl, item.type)}
                      alt={item.title}
                      className="kr-portal-listing-image"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = getFallbackImage(item.type);
                        e.currentTarget
                          .closest(".kr-portal-listing-media")
                          ?.classList.add("kr-has-fallback-image");
                      }}
                    />
                    <span className="kr-fallback-badge">Illustrative image</span>
                    <PropertyMediaBadge item={item} />

                    {/* Type badge */}
                    <span className={`kr-listing-type-badge kr-listing-type-badge--${item.type}`}>
                      {item.type}
                    </span>

                    {isSoftDeleted && (
                      <span className="kr-listing-soft-delete-badge">
                        Soft deleted
                      </span>
                    )}

                    {/* Shortlist button */}
                    <button
                      type="button"
                      className={`kr-portal-star-btn${isShortlisted ? " active" : ""}`}
                      onClick={(e) => { e.stopPropagation(); toggleShortlist(item.id); }}
                      aria-label={isShortlisted ? "Remove from shortlist" : "Add to shortlist"}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill={isShortlisted ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>
                    </button>
                  </div>

                  {/* Card body */}
                  <div className="kr-portal-listing-body">
                    <h3 className="kr-portal-listing-title">{item.title}</h3>
                    <p className="kr-portal-listing-location">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px", flexShrink: 0 }}>
                        <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
                        <circle cx="12" cy="10" r="3"/>
                      </svg>
                      {item.location}
                    </p>
                    {item.description && (
                      <p className="kr-portal-listing-desc">{item.description}</p>
                    )}
                    <p className="kr-portal-listing-price">{formatPrice(item.price, item.type)}</p>

                    {isLister && isOwnedByCurrentUser && (
                      <>
                      <div className="kr-listing-payment-row">
                        <span className={`kr-listing-payment-badge kr-listing-payment-badge--${isDraftListing ? "draft" : "paid"}`}>
                          {isDraftListing ? "Draft" : "Published"}
                        </span>
                        <span className={`kr-listing-payment-badge kr-listing-payment-badge--${paymentMeta.paymentStatus}`}>
                          {paymentMeta.paymentStatus === "paid"
                            ? "Paid"
                            : paymentMeta.paymentStatus === "pending"
                              ? "Pending payment"
                              : paymentMeta.paymentStatus === "expired"
                                ? "Expired"
                              : "Unpaid"}
                        </span>
                        {shouldShowPayCta && (
                          <button
                            type="button"
                            className="kr-listing-pay-btn"
                            onClick={(event) => openPaymentModal(item, event)}
                          >
                            {paymentMeta.isExpired
                              ? "Pay to reactivate"
                              : isDraftListing
                                ? "Pay to publish"
                                : "Pay to unlock"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="kr-listing-edit-btn"
                          onClick={(event) => openEditModal(item, event)}
                        >
                          Edit
                        </button>
                      </div>
                      {paymentMeta.isExpired ? (
                        <small className="kr-listing-draft-note">
                          Listing expired on {formatDateTime(paymentMeta.visibilityExpiresAt)}. Pay to reactivate this same listing.
                        </small>
                      ) : isDraftListing && !paymentMeta.premiumMediaUnlocked ? (
                        <small className="kr-listing-draft-note">
                          Draft - payment required before this listing appears in public listings.
                        </small>
                      ) : paymentMeta.visibilityExpiresAt ? (
                        <small className="kr-listing-draft-note">
                          Expires on {formatDateTime(paymentMeta.visibilityExpiresAt)}.
                        </small>
                      ) : null}
                      </>
                    )}

                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {paymentModalListing && (
        <div
          className="kr-portal-filter-modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPaymentModalListing(null);
          }}
        >
          <div className="kr-portal-filter-modal kr-listing-payment-modal" role="dialog" aria-modal="true" aria-label="Listing payment">
            <div className="kr-portal-filter-modal-head">
              <div className="kr-portal-filter-modal-head-left">
                <h3 className="kr-portal-filter-modal-title">Pay per listing</h3>
                <p className="kr-portal-filter-modal-subtitle">
                  {getPaymentMeta(paymentModalListing).isExpired
                    ? `This listing expired on ${formatDateTime(getPaymentMeta(paymentModalListing).visibilityExpiresAt)}. Complete payment to reactivate it.`
                    : getListingStatus(paymentModalListing) === LISTING_STATUS.DRAFT
                    ? `Complete payment to publish this draft with premium media (up to ${PAID_MAX_IMAGE_LIMIT} images + video).`
                    : `Complete payment to unlock video and up to ${PAID_MAX_IMAGE_LIMIT} images.`}
                </p>
              </div>
              <button
                type="button"
                className="kr-portal-filter-modal-close"
                onClick={() => setPaymentModalListing(null)}
                aria-label="Close payment modal"
              >
                ×
              </button>
            </div>
            <div className="kr-listing-payment-body">
              <p className="kr-listing-payment-title">{paymentModalListing.title}</p>
              <p className="kr-listing-payment-amount">
                Amount: USD {getPaymentMeta(paymentModalListing).amountUsd.toLocaleString("en-US")}
                {" · "}
                KES {getPaymentMeta(paymentModalListing).amountKes.toLocaleString("en-KE")}
              </p>
              {getPaymentMeta(paymentModalListing).exchangeRate && (
                <p className="kr-listing-payment-note">
                  Rate: 1 USD = {Number(getPaymentMeta(paymentModalListing).exchangeRate.usdToKesRate || 0).toLocaleString("en-KE")} KES
                  {" · "}
                  Source: {getPaymentMeta(paymentModalListing).exchangeRate.source || "Live"}
                  {" · "}
                  Updated: {formatDateTime(getPaymentMeta(paymentModalListing).exchangeRate.fetchedAt)}
                </p>
              )}
              <div className="kr-uac-modal-field">
                <label className="kr-settings-field-label" htmlFor="listingPaymentDuration">Listing period (months)</label>
                <select
                  id="listingPaymentDuration"
                  className="kr-form-input kr-form-select"
                  value={selectedDurationMonths}
                  onChange={(event) => setSelectedDurationMonths(Number(event.target.value))}
                >
                  {(getPaymentMeta(paymentModalListing).pricingByMonths.length > 0
                    ? getPaymentMeta(paymentModalListing).pricingByMonths
                    : [{ months: 1 }]).map((quote) => (
                      <option key={quote.months} value={quote.months}>
                        {quote.months} month{quote.months === 1 ? "" : "s"}
                      </option>
                  ))}
                </select>
              </div>
              {getPaymentMeta(paymentModalListing).selectedQuote && (
                <p className="kr-listing-payment-note">
                  Monthly fee: USD {Number(getPaymentMeta(paymentModalListing).selectedQuote.monthlyFeeUsd || 0).toLocaleString("en-US")}
                  {" / "}
                  KES {Number(getPaymentMeta(paymentModalListing).selectedQuote.monthlyFeeKes || 0).toLocaleString("en-KE")}
                  {" · "}
                  Discount: {Number(getPaymentMeta(paymentModalListing).selectedQuote.discountPercent || 0)}%
                </p>
              )}
              <div className="kr-listing-provider-options">
                <label className="kr-listing-provider-option">
                  <input
                    type="radio"
                    name="listingPaymentProvider"
                    value="mpesa"
                    checked={selectedProvider === "mpesa"}
                    onChange={(event) => setSelectedProvider(event.target.value)}
                  />
                  MPESA (Kenya)
                </label>
                <label className="kr-listing-provider-option">
                  <input
                    type="radio"
                    name="listingPaymentProvider"
                    value="stripe"
                    checked={selectedProvider === "stripe"}
                    onChange={(event) => setSelectedProvider(event.target.value)}
                  />
                  Stripe (International)
                </label>
              </div>
              <p className="kr-listing-payment-note">
                Recommended: {getPaymentMeta(paymentModalListing).recommendedProvider.toUpperCase()}
              </p>
            </div>
            <div className="kr-portal-filter-modal-actions">
              <button
                type="button"
                className="kr-portal-filter-reset"
                onClick={() => setPaymentModalListing(null)}
                disabled={isStartingPayment}
              >
                Cancel
              </button>
              <button
                type="button"
                className="kr-portal-filter-apply"
                onClick={handleStartCheckout}
                disabled={isStartingPayment}
              >
                {isStartingPayment
                  ? "Starting..."
                  : (getPaymentMeta(paymentModalListing).isExpired
                    ? "Pay and reactivate listing"
                    : (getListingStatus(paymentModalListing) === LISTING_STATUS.DRAFT
                      ? "Pay and publish listing"
                      : "Continue to payment"))}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingListing && (
        <div
          className="kr-portal-filter-modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) setEditingListing(null);
          }}
        >
          <div className="kr-portal-filter-modal kr-listing-edit-modal" role="dialog" aria-modal="true" aria-label="Edit listing">
            <div className="kr-portal-filter-modal-head">
              <div className="kr-portal-filter-modal-head-left">
                <h3 className="kr-portal-filter-modal-title">Edit listing</h3>
                <p className="kr-portal-filter-modal-subtitle">Update details. Premium media is unlocked after payment.</p>
              </div>
              <button
                type="button"
                className="kr-portal-filter-modal-close"
                onClick={() => setEditingListing(null)}
                aria-label="Close edit modal"
              >
                ×
              </button>
            </div>
            <form className="kr-listing-edit-form" onSubmit={handleSaveEdit}>
              <div className="kr-uac-modal-field">
                <label className="kr-settings-field-label" htmlFor="listingEditTitle">Title</label>
                <input
                  id="listingEditTitle"
                  name="title"
                  className="kr-form-input"
                  value={formState.title}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div className="kr-uac-modal-field">
                <label className="kr-settings-field-label" htmlFor="listingEditLocation">Location</label>
                <input
                  id="listingEditLocation"
                  name="location"
                  className="kr-form-input"
                  value={formState.location}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div className="kr-uac-modal-field-row">
                <div className="kr-uac-modal-field">
                  <label className="kr-settings-field-label" htmlFor="listingEditType">Type</label>
                  <select
                    id="listingEditType"
                    name="type"
                    className="kr-form-input kr-form-select"
                    value={formState.type}
                    onChange={handleInputChange}
                    required
                  >
                    <option value="rent">Rent</option>
                    <option value="lease">Lease</option>
                  </select>
                </div>
                <div className="kr-uac-modal-field kr-uac-modal-field--grow">
                  <label className="kr-settings-field-label" htmlFor="listingEditPrice">Price</label>
                  <input
                    id="listingEditPrice"
                    name="price"
                    type="number"
                    min="1"
                    className="kr-form-input"
                    value={formState.price}
                    onChange={handleInputChange}
                    required
                  />
                </div>
              </div>
              <div className="kr-uac-modal-field">
                <label className="kr-settings-field-label" htmlFor="listingEditDescription">Description</label>
                <textarea
                  id="listingEditDescription"
                  name="description"
                  rows="3"
                  className="kr-form-input"
                  value={formState.description}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div className="kr-uac-modal-field">
                <label className="kr-settings-field-label" htmlFor="listingEditImages">Replace images</label>
                <input
                  id="listingEditImages"
                  type="file"
                  className="kr-form-input"
                  accept="image/*"
                  multiple
                  onChange={handleEditImageFileChange}
                />
                <div className="kr-media-meta-row">
                  <small className="kr-media-count">
                    Existing: {Array.isArray(editingListing?.imageUrls) ? editingListing.imageUrls.length : (editingListing?.imageUrl ? 1 : 0)}
                    {" · "}New: {editImageFiles.length}
                  </small>
                </div>
                {editImagePreviews.length > 0 && (
                  <div className="kr-upload-preview-grid-wrap">
                    <p className="kr-upload-preview-grid-title">Selected media preview</p>
                    <div className="kr-upload-preview-grid">
                    {editImagePreviews.map((filePreview, index) => (
                      <div className={`kr-upload-preview-card${filePreview.isVideo ? " kr-upload-preview-card--video" : ""}`} key={filePreview.id}>
                        <span className="kr-upload-preview-kind">
                          {filePreview.isVideo ? "Video" : "Image"}
                        </span>
                        <button
                          type="button"
                          className="kr-upload-preview-remove"
                          aria-label={`Remove ${filePreview.name}`}
                          onClick={() => handleRemoveEditImage(index)}
                        >
                          ×
                        </button>
                        <img
                          src={filePreview.previewUrl}
                          alt={filePreview.name}
                          className="kr-upload-preview-media"
                        />
                        <div className="kr-upload-preview-meta">
                          <span className="kr-upload-preview-name">{filePreview.name}</span>
                          <span className="kr-upload-preview-size">{filePreview.sizeLabel}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  </div>
                )}
              </div>
              <div className="kr-uac-modal-field">
                <label className="kr-settings-field-label" htmlFor="listingEditVideo">Upload video</label>
                <input
                  id="listingEditVideo"
                  type="file"
                  accept="video/*"
                  className="kr-form-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setEditVideoFile(file);
                  }}
                  disabled={!getPaymentMeta(editingListing || {}).premiumMediaUnlocked}
                />
                {!getPaymentMeta(editingListing || {}).premiumMediaUnlocked && (
                  <small className="kr-form-helper-text">
                    Video upload is locked until payment is completed.
                  </small>
                )}
                {editVideoPreview && (
                  <div className="kr-upload-preview-grid-wrap">
                    <p className="kr-upload-preview-grid-title">Selected media preview</p>
                    <div className="kr-upload-preview-grid kr-upload-preview-grid--single">
                    <div className="kr-upload-preview-card kr-upload-preview-card--video" key={editVideoPreview.id}>
                      <span className="kr-upload-preview-kind">Video</span>
                      <button
                        type="button"
                        className="kr-upload-preview-remove"
                        aria-label={`Remove ${editVideoPreview.name}`}
                        onClick={() => setEditVideoFile(null)}
                      >
                        ×
                      </button>
                      <video
                        src={editVideoPreview.previewUrl}
                        className="kr-upload-preview-media"
                        controls
                        preload="metadata"
                      />
                      <div className="kr-upload-preview-meta">
                        <span className="kr-upload-preview-name">{editVideoPreview.name}</span>
                        <span className="kr-upload-preview-size">{editVideoPreview.sizeLabel}</span>
                      </div>
                    </div>
                  </div>
                  </div>
                )}
              </div>
              <div className="kr-uac-modal-footer">
                <button
                  type="button"
                  className="kr-portal-filter-reset"
                  onClick={() => setEditingListing(null)}
                  disabled={isSavingEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="kr-uac-btn kr-uac-btn--reinstate"
                  disabled={isSavingEdit}
                >
                  {isSavingEdit ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}

export default ListingsPage;
