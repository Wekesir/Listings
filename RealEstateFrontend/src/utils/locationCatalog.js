const COUNTRY_LOCATIONS = {
  KE: [
    "Baringo",
    "Bomet",
    "Bungoma",
    "Busia",
    "Elgeyo-Marakwet",
    "Embu",
    "Garissa",
    "Homa Bay",
    "Isiolo",
    "Kajiado",
    "Kakamega",
    "Kericho",
    "Kiambu",
    "Kilifi",
    "Kirinyaga",
    "Kisii",
    "Kisumu",
    "Kitui",
    "Kwale",
    "Laikipia",
    "Lamu",
    "Machakos",
    "Makueni",
    "Mandera",
    "Marsabit",
    "Meru",
    "Migori",
    "Mombasa",
    "Murang'a",
    "Nairobi",
    "Nakuru",
    "Nandi",
    "Narok",
    "Nyamira",
    "Nyandarua",
    "Nyeri",
    "Samburu",
    "Siaya",
    "Taita-Taveta",
    "Tana River",
    "Tharaka-Nithi",
    "Trans Nzoia",
    "Turkana",
    "Uasin Gishu",
    "Vihiga",
    "Wajir",
    "West Pokot"
  ]
};

function normalizeCountryCode(rawValue) {
  const value = String(rawValue || "").trim().toUpperCase();
  if (!value) return "";
  if (value.length === 2) return value;
  if (value === "KENYA") return "KE";
  return value.slice(0, 2);
}

function getCountryLocations(countryCode) {
  const normalized = normalizeCountryCode(countryCode);
  return COUNTRY_LOCATIONS[normalized] || [];
}

function inferCountryCodeFromLocale() {
  if (typeof navigator === "undefined") return "";
  const locale =
    String(navigator.language || "").trim() ||
    String(navigator.languages?.[0] || "").trim();
  if (!locale) return "";
  const region = locale.split("-")[1] || "";
  return normalizeCountryCode(region);
}

function inferCountryCodeFromUser(user) {
  if (!user || typeof user !== "object") return "";
  const directCountry = normalizeCountryCode(
    user.countryCode || user.country || user.locationCountry || user.regionCountry
  );
  if (directCountry) return directCountry;

  const phone = String(user.phone || user.phoneNumber || "").replace(/\s+/g, "");
  if (phone.startsWith("+254") || phone.startsWith("254")) return "KE";
  return "";
}

function resolveUserCountryCode(user) {
  return inferCountryCodeFromUser(user) || inferCountryCodeFromLocale() || "KE";
}

export {
  getCountryLocations,
  resolveUserCountryCode
};
