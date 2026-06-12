import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getProperties, submitInquiry } from "../services/propertyService";
import { useShortlist } from "../hooks/useShortlist";
import { notify } from "../utils/notify";
import {
  getFallbackImage,
  hasCustomImage,
  resolvePropertyImageUrl
} from "../utils/propertyMedia";
import PropertyMediaBadge from "../components/PropertyMediaBadge";
import "../styles/home-revamp.css";

/* ── CountUpVal: animates a number from 0 → end when it scrolls into view ── */
function CountUpVal({ end, suffix = "", prefix = "", duration = 1800 }) {
  const [count, setCount] = useState(0);
  const elRef = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    if (typeof end !== "number" || isNaN(end)) return;
    const el = elRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const t0 = performance.now();
          const tick = (now) => {
            const p = Math.min((now - t0) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            setCount(Math.round(eased * end));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [end, duration]);

  const display = end >= 1000 ? count.toLocaleString("en-KE") : count;
  return (
    <span ref={elRef}>
      {prefix}{display}{suffix}
    </span>
  );
}

function formatPrice(price, type) {
  const value = Number(price);
  if (Number.isNaN(value)) return "Price on request";
  const suffix = type === "lease" ? "/ mo (lease)" : "/ mo (rent)";
  return `KSh ${value.toLocaleString("en-KE")} ${suffix}`;
}

function getPropertyFeatures(id) {
  const beds = (id % 4) + 1;
  const baths = beds > 2 ? 2 : 1;
  const area = 40 + (id * 17) % 120;
  return { beds, baths, area };
}

const NAIROBI_AREAS = [
  "Westlands", "Karen", "Kilimani", "Runda", "Lavington", "Parklands", "Syokimau", "Ngong Road"
];

const HOW_IT_WORKS_STEPS = [
  {
    step: "01",
    title: "Browse & filter",
    body: "Explore verified rentals and leases across Nairobi with filters for budget, location, and property type.",
    tone: "blue"
  },
  {
    step: "02",
    title: "Shortlist favorites",
    body: "Save the properties you love and compare them side by side before booking a viewing.",
    tone: "amber"
  },
  {
    step: "03",
    title: "Connect fast",
    body: "Send inquiries in one click and get matched with the right landlord or tenant in days, not weeks.",
    tone: "green"
  }
];

const TESTIMONIALS = [
  {
    quote: "I shortlisted five apartments in one evening and signed a lease in Karen within a week. The process felt effortless.",
    name: "Grace Mwangi",
    role: "Tenant · Kilimani",
    initials: "GM",
    tone: "blue"
  },
  {
    quote: "Listing my units on KenReal brought qualified leads faster than any agent I had used before. Worth every shilling.",
    name: "James Ochieng",
    role: "Property owner · Westlands",
    initials: "JO",
    tone: "amber"
  },
  {
    quote: "Clean interface, verified listings, and responsive support. This is how property search should work in Kenya.",
    name: "Amina Hassan",
    role: "Tenant · Parklands",
    initials: "AH",
    tone: "purple"
  }
];

const HERO_SHOWCASE_FALLBACK = [
  { id: "demo-1", title: "Modern 2-Bed Apartment", location: "Westlands, Nairobi", type: "rent", price: 85000 },
  { id: "demo-2", title: "Garden Villa with Pool", location: "Karen, Nairobi", type: "lease", price: 120000 },
  { id: "demo-3", title: "Studio near CBD", location: "Kilimani, Nairobi", type: "rent", price: 45000 }
];

function HomePage() {
  const navigate = useNavigate();
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [inquiryForm, setInquiryForm] = useState({ name: "", email: "", message: "" });
  const [inquirySubmitting, setInquirySubmitting] = useState(false);
  const [heroSearch, setHeroSearch] = useState("");
  const [heroType, setHeroType] = useState("all");
  const { shortlistedLookup, toggleShortlist } = useShortlist();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
  }, []);

  useEffect(() => {
    const doc = document.documentElement;
    const onScroll = () => {
      setScrolled(window.scrollY > 20);
      const max = doc.scrollHeight - window.innerHeight;
      doc.style.setProperty("--kr-scroll", max > 0 ? String(window.scrollY / max) : "0");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      doc.style.removeProperty("--kr-scroll");
    };
  }, []);

  /* Lock body scroll and close drawer on Escape while it is open */
  useEffect(() => {
    document.body.style.overflow = navOpen ? "hidden" : "";
    const onKey = (e) => { if (e.key === "Escape") setNavOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [navOpen]);

  useEffect(() => {
    const loadProperties = async () => {
      try {
        const data = await getProperties();
        setProperties(data);
      } catch (_err) {
        const msg = "Unable to load listings right now. Please try again shortly.";
        setError(msg);
        notify(msg, "warning");
      } finally {
        setLoading(false);
      }
    };
    loadProperties();
  }, []);

  const featuredProperties = useMemo(() => {
    const paid = [];
    const standard = [];
    properties.forEach((item) => {
      if (item?.isSoftDeleted) return;
      if (String(item?.paymentStatus || "").toLowerCase() === "paid") paid.push(item);
      else standard.push(item);
    });
    paid.sort((a, b) => Number(b.id) - Number(a.id));
    standard.sort((a, b) => Number(b.id) - Number(a.id));
    return [...paid, ...standard].slice(0, 6);
  }, [properties]);

  const promotedCount = useMemo(
    () => properties.filter((item) => String(item?.paymentStatus || "").toLowerCase() === "paid").length,
    [properties]
  );

  const heroShowcase = useMemo(() => {
    if (featuredProperties.length >= 3) return featuredProperties.slice(0, 3);
    if (featuredProperties.length > 0) return featuredProperties;
    return HERO_SHOWCASE_FALLBACK;
  }, [featuredProperties]);

  /* Scroll-reveal: adds animate.css classes when elements enter the viewport.
     Re-runs after loading so dynamically rendered cards are picked up. */
  useEffect(() => {
    const els = document.querySelectorAll("[data-animate]:not(.animate__animated)");
    if (!els.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target;
            const anim = el.dataset.animate ?? "fadeInUp";
            const delay = el.dataset.animateDelay ?? "0";
            el.style.animationDelay = `${delay}ms`;
            el.classList.add("animate__animated", "animate__faster", `animate__${anim}`);
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [loading, featuredProperties.length]);

  const handleHeroSearch = (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    const term = heroSearch.trim();
    if (term) params.set("search", term);
    if (heroType !== "all") params.set("type", heroType);
    const qs = params.toString();
    navigate(qs ? `/browse?${qs}` : "/browse");
  };

  const getPreviewLink = (item) => {
    const id = String(item.id ?? "");
    if (id && !id.startsWith("demo-")) {
      return `/listings/${item.id}`;
    }
    const params = new URLSearchParams();
    const area = item.location?.split(",")[0]?.trim();
    if (area) params.set("search", area);
    if (item.type) params.set("type", item.type);
    const qs = params.toString();
    return qs ? `/browse?${qs}` : "/browse";
  };

  const [contactForm, setContactForm] = useState({
    name: "",
    email: "",
    subject: "",
    message: ""
  });
  const [contactSubmitting, setContactSubmitting] = useState(false);

  const handleContactFieldChange = (event) => {
    const { name, value } = event.target;
    setContactForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleContactSubmit = (event) => {
    event.preventDefault();
    const trimmed = {
      name: contactForm.name.trim(),
      email: contactForm.email.trim(),
      subject: contactForm.subject.trim(),
      message: contactForm.message.trim()
    };
    if (!trimmed.name || !trimmed.email || !trimmed.message) {
      notify("Please fill in your name, email, and message.", "warning");
      return;
    }
    setContactSubmitting(true);
    setTimeout(() => {
      notify(
        `Thanks ${trimmed.name.split(" ")[0]} — we'll get back to you at ${trimmed.email} shortly.`,
        "success"
      );
      setContactForm({ name: "", email: "", subject: "", message: "" });
      setContactSubmitting(false);
    }, 600);
  };

  useEffect(() => {
    setInquiryForm({ name: "", email: "", message: "" });
  }, [selectedProperty]);

  const handleInquiryInputChange = (event) => {
    const { name, value } = event.target;
    setInquiryForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleInquirySubmit = async (event) => {
    event.preventDefault();
    if (!selectedProperty) return;
    setInquirySubmitting(true);
    try {
      await submitInquiry(selectedProperty.id, inquiryForm);
      notify("Inquiry submitted successfully. Our team will contact you soon.", "success");
      setInquiryForm({ name: "", email: "", message: "" });
    } catch (submitError) {
      notify(submitError.message || "Could not submit inquiry right now.", "danger");
    } finally {
      setInquirySubmitting(false);
    }
  };

  const statItems = [
    { end: 200, suffix: "+", label: "Verified Properties", icon: "🏠", tone: "blue" },
    { end: 8500, suffix: "+", label: "Monthly Inquiries", icon: "💬", tone: "green" },
    { end: 4, suffix: " days", label: "Avg. Match Time", icon: "⚡", tone: "amber" },
    { end: 98, suffix: "%", label: "Satisfaction Rate", icon: "⭐", tone: "purple" }
  ];

  return (
    <div className="kr-home kr-home--v2">
      {/* Scroll progress indicator */}
      <div className="kr-v2-progress" aria-hidden="true" />

      {/* ─────────── Navbar ─────────── */}
      <nav className={`site-navbar site-navbar--home sticky-top ${scrolled ? "site-navbar--scrolled" : ""}`}>
        <div className="kr-nav-glow-strip" aria-hidden="true" />
        <div className="container kr-nav-inner">
          <Link to="/" className="navbar-brand-logo">
            <span className="brand-icon">
              <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
                <rect width="64" height="64" rx="14" fill="#1e3a5f" />
                <circle cx="47" cy="17" r="7" fill="#e8a020" />
                <text x="14" y="42" fontFamily="Arial, sans-serif" fontSize="24" fontWeight="700" fill="#ffffff">KR</text>
              </svg>
            </span>
            <span className="brand-text">
              KenReal<span className="brand-dot"></span>Estates
            </span>
          </Link>

          {/* Desktop centre links */}
          <ul className="navbar-nav d-none d-lg-flex flex-row mb-0 mx-auto kr-nav-pill-track">
            <li className="nav-item">
              <Link className="nav-link kr-nav-link" to="/browse">Listings</Link>
            </li>
            <li className="nav-item">
              <a className="nav-link kr-nav-link" href="#why-us">Why KenReal</a>
            </li>
            <li className="nav-item">
              <a className="nav-link kr-nav-link" href="#contact">Contact Us</a>
            </li>
          </ul>

          {/* Desktop CTA */}
          <div className="d-none d-lg-flex gap-2 align-items-center kr-nav-cta-group">
            <>
              <a href="/login" className="kr-nav-login-btn">Login</a>
              <a href="/register" className="kr-nav-signup-btn">Sign Up Free</a>
            </>
          </div>

          {/* Mobile actions */}
          <div className="kr-nav-mobile-actions d-lg-none">
            <Link to="/browse" className="kr-nav-mobile-browse">Browse</Link>
            <button
              className={`kr-nav-hamburger ${navOpen ? "kr-nav-hamburger--open" : ""}`}
              onClick={() => setNavOpen((v) => !v)}
              aria-label={navOpen ? "Close menu" : "Open menu"}
              aria-expanded={navOpen}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile backdrop */}
      <div
        className={`kr-nav-backdrop ${navOpen ? "kr-nav-backdrop--visible" : ""}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />

      {/* Mobile slide-in drawer */}
      <div
        className={`kr-nav-drawer ${navOpen ? "kr-nav-drawer--open" : ""}`}
        aria-hidden={!navOpen}
        role="dialog"
        aria-label="Navigation menu"
      >
        <div className="kr-nav-drawer-header">
          <span className="kr-nav-drawer-brand">
            KenReal<span className="kr-nav-drawer-dot" />Estates
          </span>
          <button className="kr-nav-drawer-close" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <nav className="kr-nav-drawer-nav">
          <Link
            className={`kr-nav-drawer-link${location.pathname === "/browse" ? " active" : ""}`}
            to="/browse"
            onClick={() => setNavOpen(false)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Listings
          </Link>
          <div className="kr-nav-drawer-divider" />
          <a
            className={`kr-nav-drawer-link${location.hash === "#why-us" ? " active" : ""}`}
            href="#why-us"
            onClick={() => setNavOpen(false)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Why KenReal
          </a>
          <div className="kr-nav-drawer-divider" />
          <a
            className={`kr-nav-drawer-link${location.hash === "#contact" ? " active" : ""}`}
            href="#contact"
            onClick={() => setNavOpen(false)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Contact Us
          </a>
        </nav>

        <div className="kr-nav-drawer-footer">
          <>
            <a href="/login" className="kr-nav-login-btn" style={{ textAlign: "center" }}>Login</a>
            <a href="/register" className="kr-nav-signup-btn" style={{ textAlign: "center" }}>Sign Up Free</a>
          </>
        </div>
      </div>

      {/* ─────────── Hero ─────────── */}
      <header className="kr-hero">
        {/* Decorative shapes + color orbs */}
        <div className="kr-hero-mesh" aria-hidden="true"></div>
        <div className="kr-hero-glow-floor" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--amber kr-glow-blob--hero-3" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--green kr-glow-blob--hero-4" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--blue kr-glow-blob--hero-5" aria-hidden="true"></div>
        <div className="kr-hero-geo kr-hero-geo-1"></div>
        <div className="kr-hero-geo kr-hero-geo-2"></div>
        <div className="kr-hero-geo kr-hero-geo-3"></div>
        <div className="kr-hero-orb kr-hero-orb-1" aria-hidden="true"></div>
        <div className="kr-hero-orb kr-hero-orb-2" aria-hidden="true"></div>
        <div className="kr-hero-orb kr-hero-orb-3" aria-hidden="true"></div>

        <div className="container">
          <div className="row align-items-center g-5">
            <div className="col-lg-6 anim-fade-up">
              <span className="kr-hero-badge">
                <span className="kr-hero-badge-dot"></span>
                Trusted Since 2015 · Nairobi, Kenya
              </span>
              <h1 className="kr-hero-title">
                {"Find your perfect".split(" ").map((word, i) => (
                  <span key={word} className="kr-title-word" style={{ "--d": `${i * 90}ms` }}>
                    {word}&nbsp;
                  </span>
                ))}
                <br />
                <span className="kr-hero-title-accent kr-title-word" style={{ "--d": "300ms" }}>
                  rental or lease
                </span>
                <br />
                {"with confidence.".split(" ").map((word, i) => (
                  <span key={word} className="kr-title-word" style={{ "--d": `${420 + i * 90}ms` }}>
                    {word}&nbsp;
                  </span>
                ))}
              </h1>
              <p className="kr-hero-sub">
                KenReal Estates connects property owners and tenants through a
                smart shortlist-first experience built for modern real estate in Kenya.
              </p>

              <form className="kr-hero-search" onSubmit={handleHeroSearch}>
                <div className="kr-hero-search-main">
                  <span className="kr-hero-search-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                  </span>
                  <input
                    type="search"
                    className="kr-hero-search-input"
                    placeholder="Search Westlands, Karen, Kilimani…"
                    value={heroSearch}
                    onChange={(e) => setHeroSearch(e.target.value)}
                    aria-label="Search properties"
                  />
                </div>
                <div className="kr-hero-search-types" role="group" aria-label="Property type">
                  {["all", "rent", "lease"].map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={`kr-hero-search-type${heroType === type ? " kr-hero-search-type--active" : ""}`}
                      onClick={() => setHeroType(type)}
                    >
                      {type === "all" ? "All" : type.charAt(0).toUpperCase() + type.slice(1)}
                    </button>
                  ))}
                </div>
                <button type="submit" className="kr-hero-search-submit">
                  Search
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                  </svg>
                </button>
              </form>

              <div className="kr-hero-area-chips">
                <span className="kr-hero-area-label">Popular:</span>
                {NAIROBI_AREAS.slice(0, 5).map((area) => (
                  <Link
                    key={area}
                    to={`/browse?search=${encodeURIComponent(area)}`}
                    className="kr-hero-area-chip"
                  >
                    {area}
                  </Link>
                ))}
              </div>

              <div className="d-flex gap-3 flex-wrap mb-4 mt-4">
                <Link to="/browse" className="kr-hero-cta-primary">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "0.4rem" }}>
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  </svg>
                  Browse Properties
                </Link>
                <a href="/register" className="kr-hero-cta-ghost">List Your Property →</a>
              </div>

              {/* Trust indicators */}
              <div className="kr-hero-trust">
                <div className="kr-hero-trust-item">
                  <strong>
                    {loading ? "—" : <CountUpVal end={properties.length} suffix="+" />}
                  </strong>
                  <span>Active listings</span>
                </div>
                <div className="kr-hero-trust-divider"></div>
                <div className="kr-hero-trust-item">
                  <strong><CountUpVal end={8500} suffix="+" /></strong>
                  <span>Monthly inquiries</span>
                </div>
                <div className="kr-hero-trust-divider"></div>
                <div className="kr-hero-trust-item">
                  <strong><CountUpVal end={98} suffix="%" /></strong>
                  <span>Satisfaction rate</span>
                </div>
              </div>
            </div>

            <div className="col-lg-5 offset-lg-1 anim-fade-up anim-delay-2">
              <div className="kr-hero-visual">
                <div className="kr-hero-visual-glow" aria-hidden="true"></div>
                <div className="kr-glow-blob kr-glow-blob--cyan kr-glow-blob--hero-1" aria-hidden="true"></div>
                <div className="kr-glow-blob kr-glow-blob--purple kr-glow-blob--hero-2" aria-hidden="true"></div>
                {heroShowcase.map((item, index) => (
                  <Link
                    key={item.id}
                    to={getPreviewLink(item)}
                    className={`kr-hero-preview kr-hero-preview--${index}`}
                    data-animate="fadeInUp"
                    data-animate-delay={120 + index * 100}
                  >
                    <div
                      className={`kr-hero-preview-media kr-card-image-${item.type || "rent"} ${
                        hasCustomImage(item.imageUrl) ? "" : "kr-has-fallback-image"
                      }`}
                    >
                      <img
                        src={resolvePropertyImageUrl(item.imageUrl, item.type || "rent")}
                        alt={item.title}
                        className="kr-hero-preview-photo"
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.onerror = null;
                          event.currentTarget.src = getFallbackImage(item.type || "rent");
                        }}
                      />
                      <span className={`kr-hero-preview-type kr-badge-${item.type || "rent"}`}>
                        {item.type || "rent"}
                      </span>
                    </div>
                    <div className="kr-hero-preview-body">
                      <h3 className="kr-hero-preview-title">{item.title}</h3>
                      <p className="kr-hero-preview-location">{item.location}</p>
                      <p className="kr-hero-preview-price">{formatPrice(item.price, item.type || "rent")}</p>
                    </div>
                  </Link>
                ))}
                <div className="kr-hero-live-badge">
                  <span className="kr-snapshot-live-dot"></span>
                  {loading ? "Loading listings…" : `${properties.length} live on platform`}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ─────────── Stats strip ─────────── */}
      <div className="kr-stats-strip">
        <div className="kr-glow-blob kr-glow-blob--blue kr-glow-blob--stats-left" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--amber kr-glow-blob--stats-right" aria-hidden="true"></div>
        <div className="container">
          <div className="kr-stats-grid">
            {statItems.map(({ end, suffix, label, icon, tone }, i) => (
              <div
                className={`kr-stat-item kr-stat-item--${tone}`}
                key={label}
                data-animate="fadeInUp"
                data-animate-delay={i * 90}
              >
                <span className="kr-stat-icon">{icon}</span>
                <strong className="kr-stat-val">
                  <CountUpVal end={end} suffix={suffix} />
                </strong>
                <span className="kr-stat-label">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─────────── Locations marquee ─────────── */}
      <div className="kr-v2-marquee" aria-hidden="true">
        <div className="kr-v2-marquee-track">
          {[...NAIROBI_AREAS, ...NAIROBI_AREAS].map((area, i) => (
            <span className="kr-v2-marquee-item" key={`${area}-${i}`}>
              <span className="kr-v2-marquee-dot" />
              {area}
            </span>
          ))}
        </div>
      </div>

      {/* ─────────── How it works ─────────── */}
      <section className="kr-how-section" aria-labelledby="how-it-works-title">
        <div className="kr-glow-blob kr-glow-blob--green kr-glow-blob--how" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--purple kr-glow-blob--how-2" aria-hidden="true"></div>
        <div className="container">
          <div className="kr-section-header kr-section-header-center" data-animate="fadeInDown">
            <p className="kr-section-eyebrow">Simple process</p>
            <h2 id="how-it-works-title" className="kr-section-title">How KenReal works</h2>
            <div className="kr-section-divider" style={{ margin: "0.75rem auto 0" }}></div>
            <p className="kr-how-sub">
              From first search to signed lease — three clear steps designed for renters and property owners alike.
            </p>
          </div>
          <div className="kr-how-grid">
            {HOW_IT_WORKS_STEPS.map(({ step, title, body, tone }, i) => (
              <article
                key={step}
                className={`kr-how-card kr-how-card--${tone}`}
                data-animate="fadeInUp"
                data-animate-delay={i * 100}
              >
                <span className="kr-how-step">{step}</span>
                <h3 className="kr-how-title">{title}</h3>
                <p className="kr-how-body">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Audience split ─────────── */}
      <section className="kr-audience-section">
        <div className="kr-glow-blob kr-glow-blob--blue kr-glow-blob--audience" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--amber kr-glow-blob--audience-2" aria-hidden="true"></div>
        <div className="container">
          <div className="kr-audience-grid">
            <article className="kr-audience-card kr-audience-card--tenant" data-animate="fadeInLeft">
              <span className="kr-audience-eyebrow">For tenants</span>
              <h3 className="kr-audience-title">Find a home you&apos;ll love</h3>
              <p className="kr-audience-body">
                Browse curated rentals and leases, shortlist your favorites, and reach landlords without the back-and-forth.
              </p>
              <ul className="kr-audience-list">
                <li>Verified listings across Nairobi</li>
                <li>One-click shortlist &amp; compare</li>
                <li>Direct inquiry to property owners</li>
              </ul>
              <Link to="/browse" className="kr-audience-cta">Start browsing →</Link>
            </article>
            <article className="kr-audience-card kr-audience-card--lister" data-animate="fadeInRight" data-animate-delay="120">
              <span className="kr-audience-eyebrow">For property owners</span>
              <h3 className="kr-audience-title">List smarter, fill faster</h3>
              <p className="kr-audience-body">
                Publish sponsored listings, manage inquiries from one dashboard, and reach serious tenants ready to move.
              </p>
              <ul className="kr-audience-list">
                <li>Promoted visibility on the platform</li>
                <li>Media-rich property profiles</li>
                <li>Transparent pricing &amp; receipts</li>
              </ul>
              <Link to="/register" className="kr-audience-cta kr-audience-cta--light">List your property →</Link>
            </article>
          </div>
        </div>
      </section>

      {/* ─────────── Featured Listings (teaser) ─────────── */}
      <section id="listings" className="kr-listings-section">
        <div className="kr-glow-blob kr-glow-blob--amber kr-glow-blob--listings" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--cyan kr-glow-blob--listings-2" aria-hidden="true"></div>
        <div className="kr-section-bg-deco kr-section-bg-deco--listings" aria-hidden="true"></div>
        <div className="container" style={{ position: "relative", zIndex: 1 }}>

          <div className="kr-section-header" data-animate="fadeInDown">
            <div>
              <p className="kr-section-eyebrow">Our Properties</p>
              <h2 className="kr-section-title">Featured Opportunities</h2>
              <div className="kr-section-divider"></div>
            </div>
            <p className="kr-section-desc">
              A quick look at promoted and recently listed properties. Head to the full
              listings page to filter by location, type, price and more.
            </p>
          </div>

          {loading && (
            <div className="kr-loading-state">
              <div className="kr-loading-spinner"></div>
              <p>Loading featured listings…</p>
            </div>
          )}

          {!loading && error && (
            <div className="kr-empty-state">
              <div className="kr-empty-state-icon">⚠️</div>
              <h5 className="fw-bold mb-2">Couldn't load listings</h5>
              <p className="mb-3">{error}</p>
              <Link to="/browse" className="kr-reset-btn">Try the listings page</Link>
            </div>
          )}

          {!loading && !error && (
            <>
              <div className="kr-featured-meta">
                <span className="kr-featured-count">
                  Showing <strong>{featuredProperties.length}</strong> of{" "}
                  <strong>{properties.length}</strong> listings
                </span>
                {promotedCount > 0 && (
                  <span className="kr-featured-promoted-pill">
                    ✦ {promotedCount} promoted
                  </span>
                )}
              </div>

              <div className="row g-4">
                {featuredProperties.map((item, i) => {
                  const features = getPropertyFeatures(item.id);
                  const isPromoted = String(item?.paymentStatus || "").toLowerCase() === "paid";
                  const saved = shortlistedLookup.has(item.id);
                  return (
                    <div
                      className="col-md-6 col-lg-4"
                      key={item.id}
                      data-animate="fadeInUp"
                      data-animate-delay={i * 80}
                    >
                      <div className={`kr-property-card ${isPromoted ? "kr-property-card--promoted" : ""}`}>
                        <div
                          className={`kr-card-image kr-card-image-${item.type} ${
                            hasCustomImage(item.imageUrl) ? "" : "kr-has-fallback-image"
                          }`}
                        >
                          <img
                            src={resolvePropertyImageUrl(item.imageUrl, item.type)}
                            alt={item.title}
                            className="kr-card-image-photo"
                            loading="lazy"
                            onError={(event) => {
                              event.currentTarget.onerror = null;
                              event.currentTarget.src = getFallbackImage(item.type);
                              event.currentTarget
                                .closest(".kr-card-image")
                                ?.classList.add("kr-has-fallback-image");
                            }}
                          />
                          <span className="kr-fallback-badge">Illustrative image</span>
                          {isPromoted && (
                            <span className="kr-promoted-badge" title="Sponsored listing">
                              ✦ Promoted
                            </span>
                          )}
                          <PropertyMediaBadge item={item} />
                          <span className={`kr-card-image-badge kr-badge-${item.type}`}>{item.type}</span>
                          <button
                            type="button"
                            className={`kr-card-shortlist-btn ${saved ? "active" : ""}`}
                            title={saved ? "Remove from shortlist" : "Add to shortlist"}
                            onClick={() => toggleShortlist(item.id)}
                          >
                            {saved ? "★" : "☆"}
                          </button>
                        </div>

                        <div className="kr-card-features">
                          <span className="kr-card-feature">🛏 {features.beds} bed{features.beds > 1 ? "s" : ""}</span>
                          <span className="kr-card-feature-sep">·</span>
                          <span className="kr-card-feature">🚿 {features.baths} bath{features.baths > 1 ? "s" : ""}</span>
                          <span className="kr-card-feature-sep">·</span>
                          <span className="kr-card-feature">📐 {features.area} m²</span>
                        </div>

                        <div className="kr-card-body">
                          <h5 className="kr-card-title">{item.title}</h5>
                          <p className="kr-card-location">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                            </svg>
                            {item.location}
                          </p>
                          {item.description && (
                            <p className="kr-card-description">{item.description}</p>
                          )}

                          <div className="kr-card-price-box">
                            <p className="kr-card-price-label">Monthly Rate</p>
                            <p className="kr-card-price">{formatPrice(item.price, item.type)}</p>
                          </div>

                          <div className="kr-card-actions">
                            <button
                              type="button"
                              className="kr-card-btn-view"
                              data-bs-toggle="modal"
                              data-bs-target="#propertyDetailsModal"
                              onClick={() => setSelectedProperty(item)}
                            >
                              View Details
                            </button>
                            <button
                              type="button"
                              className={`kr-card-btn-shortlist ${saved ? "active" : ""}`}
                              onClick={() => toggleShortlist(item.id)}
                            >
                              {saved ? "★ Saved" : "☆ Save"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="kr-featured-cta">
                <p className="kr-featured-cta-text">
                  Looking for more? Browse the complete catalog with search, location,
                  price and type filters.
                </p>
                <Link to="/browse" className="kr-hero-cta-primary">
                  View all listings
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "0.4rem" }}>
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ─────────── Contact Us ─────────── */}
      <section id="contact" className="kr-contact-section">
        <div className="kr-glow-blob kr-glow-blob--cyan kr-glow-blob--contact" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--purple kr-glow-blob--contact-2" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--amber kr-glow-blob--contact-3" aria-hidden="true"></div>
        <div className="container">
          <div className="kr-section-header kr-section-header-center" data-animate="fadeInDown">
            <p className="kr-section-eyebrow">Get In Touch</p>
            <h2 className="kr-section-title">Contact Us</h2>
            <div className="kr-section-divider" style={{ margin: "0.75rem auto 0" }}></div>
            <p className="kr-contact-sub">
              Questions about a listing, or ready to list your own property? Our
              Nairobi team is a message away.
            </p>
          </div>

          <div className="kr-contact-grid">
            {/* Info card */}
            <aside className="kr-contact-info" data-animate="fadeInLeft" data-animate-delay="100">
              <div className="kr-contact-info-card">
                <h3 className="kr-contact-info-title">Reach us directly</h3>
                <p className="kr-contact-info-sub">
                  Prefer email or a quick call? Use the channels below.
                </p>

                <ul className="kr-contact-info-list">
                  <li className="kr-contact-info-item">
                    <span className="kr-contact-info-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                    </span>
                    <div>
                      <p className="kr-contact-info-label">Email</p>
                      <a href="mailto:hello@kenreal.co.ke" className="kr-contact-info-value">
                        hello@kenreal.co.ke
                      </a>
                    </div>
                  </li>

                  <li className="kr-contact-info-item">
                    <span className="kr-contact-info-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.86.32 1.7.6 2.5a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.58-1.58a2 2 0 0 1 2.11-.45c.8.28 1.64.48 2.5.6A2 2 0 0 1 22 16.92z" />
                      </svg>
                    </span>
                    <div>
                      <p className="kr-contact-info-label">Phone</p>
                      <a href="tel:+254712345678" className="kr-contact-info-value">
                        +254 712 345 678
                      </a>
                      <p className="kr-contact-info-note">Mon–Fri · 8am – 6pm EAT</p>
                    </div>
                  </li>

                  <li className="kr-contact-info-item">
                    <span className="kr-contact-info-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    </span>
                    <div>
                      <p className="kr-contact-info-label">Office</p>
                      <p className="kr-contact-info-value">
                        Delta Towers, 5th Floor<br />
                        Waiyaki Way, Westlands<br />
                        Nairobi, Kenya
                      </p>
                    </div>
                  </li>
                </ul>

                <div className="kr-contact-map">
                  <iframe
                    title="KenReal Estates office in Westlands, Nairobi"
                    src="https://www.google.com/maps?q=Westlands%20Nairobi&output=embed"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    allowFullScreen
                  ></iframe>
                </div>

                <div className="kr-contact-socials">
                  <p className="kr-contact-info-label">Follow us</p>
                  <div className="kr-contact-social-row">
                    <a href="https://facebook.com/kenrealestates" target="_blank" rel="noopener noreferrer" className="kr-contact-social" aria-label="Facebook">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12Z" />
                      </svg>
                      <span>@kenrealestates</span>
                    </a>
                    <a href="https://twitter.com/kenrealke" target="_blank" rel="noopener noreferrer" className="kr-contact-social" aria-label="X / Twitter">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M18.244 2H21l-6.54 7.47L22 22h-6.406l-4.997-6.53L4.8 22H2l7.02-8.02L2 2h6.55l4.517 5.97L18.244 2Zm-1.12 18h1.77L7.01 4H5.14l11.984 16Z" />
                      </svg>
                      <span>@kenrealke</span>
                    </a>
                    <a href="https://instagram.com/kenrealestates" target="_blank" rel="noopener noreferrer" className="kr-contact-social" aria-label="Instagram">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="2" y="2" width="20" height="20" rx="5" />
                        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                      </svg>
                      <span>@kenrealestates</span>
                    </a>
                    <a href="https://linkedin.com/company/kenreal-estates" target="_blank" rel="noopener noreferrer" className="kr-contact-social" aria-label="LinkedIn">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.44-2.13 2.94v5.67H9.36V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.44A2.07 2.07 0 1 1 5.34 3.3a2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77A1.76 1.76 0 0 0 0 1.72v20.56A1.77 1.77 0 0 0 1.77 24h20.46A1.77 1.77 0 0 0 24 22.28V1.72A1.77 1.77 0 0 0 22.22 0Z" />
                      </svg>
                      <span>KenReal Estates</span>
                    </a>
                    <a href="https://wa.me/254712345678" target="_blank" rel="noopener noreferrer" className="kr-contact-social" aria-label="WhatsApp">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M20.52 3.48A11.88 11.88 0 0 0 12 0C5.37 0 .06 5.31.06 11.94c0 2.1.55 4.15 1.6 5.96L0 24l6.27-1.64a11.94 11.94 0 0 0 5.72 1.46h.01c6.63 0 11.94-5.31 11.94-11.94 0-3.19-1.24-6.19-3.42-8.4ZM12 21.52h-.01a9.6 9.6 0 0 1-4.9-1.34l-.35-.21-3.72.97.99-3.63-.23-.37a9.57 9.57 0 0 1-1.47-5.05c0-5.29 4.31-9.6 9.6-9.6 2.57 0 4.98 1 6.79 2.81a9.58 9.58 0 0 1 2.81 6.79c0 5.29-4.31 9.6-9.5 9.63Zm5.27-7.2c-.29-.14-1.71-.84-1.97-.94-.27-.1-.46-.14-.65.14-.2.29-.75.94-.93 1.13-.17.19-.34.22-.63.07-.29-.14-1.22-.45-2.33-1.44-.86-.77-1.44-1.72-1.61-2.01-.17-.29-.02-.44.13-.58.13-.13.29-.34.43-.51.14-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.07-.14-.65-1.56-.89-2.14-.23-.56-.47-.48-.65-.49h-.55c-.19 0-.51.07-.78.36-.27.29-1.02 1-1.02 2.44 0 1.44 1.04 2.83 1.19 3.03.14.19 2.05 3.12 4.96 4.37.69.3 1.23.48 1.65.62.69.22 1.32.19 1.82.11.56-.08 1.71-.7 1.95-1.37.24-.67.24-1.24.17-1.37-.07-.14-.26-.22-.55-.36Z" />
                      </svg>
                      <span>Chat on WhatsApp</span>
                    </a>
                  </div>
                </div>
              </div>
            </aside>

            {/* Contact form */}
            <form className="kr-contact-form" onSubmit={handleContactSubmit} noValidate data-animate="fadeInRight" data-animate-delay="200">
              <div className="kr-contact-form-head">
                <h3 className="kr-contact-form-title">Send us a message</h3>
                <p className="kr-contact-form-sub">
                  Fill in the form and a member of our team will reply within one business day.
                </p>
              </div>

              <div className="row g-3">
                <div className="col-md-6">
                  <label className="kr-contact-label" htmlFor="contactName">Full name</label>
                  <input
                    id="contactName"
                    name="name"
                    type="text"
                    className="kr-contact-input"
                    placeholder="Jane Wanjiku"
                    value={contactForm.name}
                    onChange={handleContactFieldChange}
                    autoComplete="name"
                    required
                  />
                </div>
                <div className="col-md-6">
                  <label className="kr-contact-label" htmlFor="contactEmail">Email address</label>
                  <input
                    id="contactEmail"
                    name="email"
                    type="email"
                    className="kr-contact-input"
                    placeholder="you@example.com"
                    value={contactForm.email}
                    onChange={handleContactFieldChange}
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="col-12">
                  <label className="kr-contact-label" htmlFor="contactSubject">Subject</label>
                  <input
                    id="contactSubject"
                    name="subject"
                    type="text"
                    className="kr-contact-input"
                    placeholder="e.g. Interested in the 3-bedroom in Karen"
                    value={contactForm.subject}
                    onChange={handleContactFieldChange}
                  />
                </div>
                <div className="col-12">
                  <label className="kr-contact-label" htmlFor="contactMessage">Message</label>
                  <textarea
                    id="contactMessage"
                    name="message"
                    className="kr-contact-input kr-contact-textarea"
                    rows={5}
                    placeholder="Tell us how we can help…"
                    value={contactForm.message}
                    onChange={handleContactFieldChange}
                    required
                  />
                </div>
              </div>

              <div className="kr-contact-form-footer">
                <p className="kr-contact-privacy">
                  By submitting this form you agree to be contacted about your
                  enquiry. We never share your details.
                </p>
                <button
                  type="submit"
                  className="kr-contact-submit"
                  disabled={contactSubmitting}
                >
                  {contactSubmitting ? "Sending…" : "Send Message →"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* ─────────── Why KenReal ─────────── */}
      <section id="why-us" className="kr-why-section">
        <div className="kr-glow-blob kr-glow-blob--cyan kr-glow-blob--why" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--purple kr-glow-blob--why-2" aria-hidden="true"></div>
        <div className="kr-why-bg-deco" aria-hidden="true">
          <img
            src="https://images.unsplash.com/photo-1486325212027-8081e485255e?auto=format&fit=crop&w=1800&q=75"
            alt=""
            className="kr-why-bg-img"
            loading="lazy"
          />
          <div className="kr-why-bg-overlay"></div>
          <div className="kr-why-deco-blob kr-why-deco-blob-1"></div>
          <div className="kr-why-deco-blob kr-why-deco-blob-2"></div>
          <div className="kr-why-deco-grid"></div>
        </div>
        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <div className="kr-section-header kr-section-header-center" data-animate="fadeInDown">
            <p className="kr-section-eyebrow">Our Advantage</p>
            <h2 className="kr-section-title">Why Choose KenReal Estates?</h2>
            <div className="kr-section-divider" style={{ margin: "0.75rem auto 0" }}></div>
            <p className="kr-why-sub">
              We make finding or listing property straightforward, transparent, and stress-free.
            </p>
          </div>
          <div className="row g-4">
            {[
              { icon: "🏠", title: "Curated Listings", body: "Verified rental and lease properties from trusted owners and agencies across the region.", accent: "#1e3a5f", tag: "200+ vetted properties" },
              { icon: "⭐", title: "Smart Shortlisting", body: "Save and compare multiple properties at once before making your final decision.", accent: "#e8a020", tag: "One-click saving" },
              { icon: "⚡", title: "Fast Support", body: "A responsive team ready to assist both landlords and renters at every step.", accent: "#2d5a8e", tag: "Response under 24 hrs" },
              { icon: "🔒", title: "Secure Platform", body: "Your personal information and inquiries are handled with strict confidentiality.", accent: "#145a47", tag: "SSL + encrypted data" },
              { icon: "📱", title: "Mobile-First", body: "Fully optimized for any device so you can browse and shortlist on the go.", accent: "#6d3a8e", tag: "Works on any screen" },
              { icon: "📊", title: "Market Insights", body: "Access fair rental benchmarks to help you make informed decisions with confidence.", accent: "#8e3a3a", tag: "Live pricing data" },
            ].map(({ icon, title, body, accent, tag }, i) => (
              <div
                className="col-md-6 col-lg-4"
                key={title}
                data-animate="fadeInUp"
                data-animate-delay={i * 90}
              >
                <div className="kr-value-card" style={{ "--card-accent": accent }}>
                  <div className="kr-value-num-bg" aria-hidden="true">0{i + 1}</div>
                  <div className="kr-value-card-inner">
                    <div className="kr-value-icon-wrap">
                      <span className="kr-value-icon-emoji" role="img" aria-label={title}>{icon}</span>
                    </div>
                    <h3 className="kr-value-title">{title}</h3>
                    <p className="kr-value-body">{body}</p>
                    <div className="kr-value-tag">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      {tag}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── Testimonials ─────────── */}
      <section className="kr-testimonials-section" aria-labelledby="testimonials-title">
        <div className="kr-testimonials-bg" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--purple kr-glow-blob--testimonials" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--amber kr-glow-blob--testimonials-2" aria-hidden="true"></div>
        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <div className="kr-section-header kr-section-header-center" data-animate="fadeInDown">
            <p className="kr-section-eyebrow">Community voices</p>
            <h2 id="testimonials-title" className="kr-section-title">Trusted by renters &amp; owners</h2>
            <div className="kr-section-divider" style={{ margin: "0.75rem auto 0" }}></div>
          </div>
          <div className="kr-testimonials-grid">
            {TESTIMONIALS.map(({ quote, name, role, initials, tone }, i) => (
              <blockquote
                key={name}
                className={`kr-testimonial kr-testimonial--${tone}`}
                data-animate="fadeInUp"
                data-animate-delay={i * 90}
              >
                <p className="kr-testimonial-quote">&ldquo;{quote}&rdquo;</p>
                <footer className="kr-testimonial-footer">
                  <span className="kr-testimonial-avatar">{initials}</span>
                  <div>
                    <cite className="kr-testimonial-name">{name}</cite>
                    <span className="kr-testimonial-role">{role}</span>
                  </div>
                </footer>
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────── CTA ─────────── */}
      <section id="join" className="kr-cta-section">
        <div className="kr-glow-blob kr-glow-blob--amber kr-glow-blob--cta" aria-hidden="true"></div>
        <div className="kr-glow-blob kr-glow-blob--cyan kr-glow-blob--cta-2" aria-hidden="true"></div>
        <div className="container">
          <div className="kr-cta-card" data-animate="zoomIn">
            <div className="kr-cta-orb kr-cta-orb-1"></div>
            <div className="kr-cta-orb kr-cta-orb-2"></div>
            <div className="kr-cta-orb kr-cta-orb-3"></div>
            <div className="kr-cta-mesh" aria-hidden="true"></div>
            <div className="kr-cta-inner">
              <div className="kr-cta-text">
                <span className="kr-cta-eyebrow">Join KenReal Today</span>
                <h3 className="kr-cta-title">Ready to move or list today?</h3>
                <p className="kr-cta-sub">
                  Join thousands of Kenyans making smarter property decisions with KenReal Estates.
                </p>
              </div>
              <div className="kr-cta-actions">
                <a href="/register" className="kr-cta-btn-primary">
                  Get Started Free →
                </a>
                <Link to="/browse" className="kr-cta-btn-ghost">
                  Browse Listings
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── Property Details Modal ─────────── */}
      <div
        className="modal fade"
        id="propertyDetailsModal"
        tabIndex="-1"
        aria-labelledby="propertyDetailsModalLabel"
        aria-hidden="true"
      >
        <div className="modal-dialog modal-dialog-centered modal-lg modal-fullscreen-sm-down">
          <div className="kr-modal-content">
            {/* Modal image hero */}
            {selectedProperty && (
              <div
                className={`kr-modal-hero kr-modal-hero-${selectedProperty.type} ${
                  hasCustomImage(selectedProperty.imageUrl) ? "" : "kr-has-fallback-image"
                }`}
              >
                <img
                  src={resolvePropertyImageUrl(selectedProperty.imageUrl, selectedProperty.type)}
                  alt={selectedProperty.title}
                  className="kr-modal-hero-photo"
                  onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = getFallbackImage(selectedProperty.type);
                    event.currentTarget
                      .closest(".kr-modal-hero")
                      ?.classList.add("kr-has-fallback-image");
                  }}
                />
                <span className="kr-fallback-badge kr-modal-fallback-badge">Illustrative image</span>
                <div className="kr-modal-hero-icon">
                  {selectedProperty.type === "lease" ? "🏢" : "🏠"}
                </div>
                <div className="kr-modal-hero-overlay">
                  <span className={`kr-card-image-badge kr-badge-${selectedProperty.type}`}>{selectedProperty.type}</span>
                  <h5 className="kr-modal-hero-title" id="propertyDetailsModalLabel">
                    {selectedProperty.title}
                  </h5>
                </div>
                <button
                  type="button"
                  className="kr-modal-close"
                  data-bs-dismiss="modal"
                  aria-label="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )}

            <div className="modal-body p-4">
              {selectedProperty ? (
                <div>
                  {/* Info chips */}
                  <div className="kr-modal-chips">
                    <div className="kr-modal-chip">
                      <span className="kr-modal-chip-icon">📍</span>
                      <div>
                        <small>Location</small>
                        <strong>{selectedProperty.location}</strong>
                      </div>
                    </div>
                    <div className="kr-modal-chip">
                      <span className="kr-modal-chip-icon">🏷️</span>
                      <div>
                        <small>Type</small>
                        <strong className="text-capitalize">{selectedProperty.type}</strong>
                      </div>
                    </div>
                    <div className="kr-modal-chip kr-modal-chip-price">
                      <span className="kr-modal-chip-icon">💰</span>
                      <div>
                        <small>Monthly Rate</small>
                        <strong>{formatPrice(selectedProperty.price, selectedProperty.type)}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Feature badges */}
                  <div className="kr-modal-features">
                    {(() => {
                      const f = getPropertyFeatures(selectedProperty.id);
                      return (
                        <>
                          <span className="kr-modal-feature-badge">🛏 {f.beds} Bedroom{f.beds > 1 ? "s" : ""}</span>
                          <span className="kr-modal-feature-badge">🚿 {f.baths} Bathroom{f.baths > 1 ? "s" : ""}</span>
                          <span className="kr-modal-feature-badge">📐 {f.area} m²</span>
                          <span className="kr-modal-feature-badge">🔑 {selectedProperty.type === "lease" ? "Long lease" : "Monthly rent"}</span>
                        </>
                      );
                    })()}
                  </div>

                  <p className="kr-modal-desc">
                    {selectedProperty.description
                      ? selectedProperty.description
                      : "This listing is available through KenReal Estates. Contact our team to schedule a visit and get assistance with the next steps in your property journey."}
                  </p>

                  <div className="kr-modal-divider">
                    <span>Send an Inquiry</span>
                  </div>

                  <form id="propertyInquiryForm" onSubmit={handleInquirySubmit} className="kr-modal-form">
                    <div className="row g-3">
                      <div className="col-sm-6">
                        <label htmlFor="inquiryName" className="kr-field-label">Full Name</label>
                        <input id="inquiryName" type="text" name="name" className="form-control kr-modal-input" placeholder="Your full name" value={inquiryForm.name} onChange={handleInquiryInputChange} required />
                      </div>
                      <div className="col-sm-6">
                        <label htmlFor="inquiryEmail" className="kr-field-label">Email Address</label>
                        <input id="inquiryEmail" type="email" name="email" className="form-control kr-modal-input" placeholder="you@example.com" value={inquiryForm.email} onChange={handleInquiryInputChange} required />
                      </div>
                      <div className="col-12">
                        <label htmlFor="inquiryMessage" className="kr-field-label">Message</label>
                        <textarea
                          id="inquiryMessage"
                          name="message"
                          rows="3"
                          className="form-control kr-modal-input"
                          placeholder="I am interested in this property. Please share next steps."
                          value={inquiryForm.message}
                          onChange={handleInquiryInputChange}
                          required
                        ></textarea>
                      </div>
                    </div>
                  </form>
                </div>
              ) : (
                <p className="mb-0 text-muted">No property selected.</p>
              )}
            </div>

            <div className="kr-modal-footer">
              {selectedProperty && (
                <button
                  type="button"
                  className={`kr-modal-shortlist-btn ${shortlistedLookup.has(selectedProperty.id) ? "active" : ""}`}
                  onClick={() => toggleShortlist(selectedProperty.id)}
                >
                  {shortlistedLookup.has(selectedProperty.id) ? "★ Shortlisted" : "☆ Shortlist"}
                </button>
              )}
              {selectedProperty && (
                <button type="submit" className="kr-modal-submit-btn" form="propertyInquiryForm" disabled={inquirySubmitting}>
                  {inquirySubmitting ? (
                    <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Sending…</>
                  ) : "Send Inquiry →"}
                </button>
              )}
              <button type="button" className="kr-modal-close-btn" data-bs-dismiss="modal">Close</button>
            </div>
          </div>
        </div>
      </div>

      {/* ─────────── Back to top ─────────── */}
      <button
        type="button"
        className={`kr-v2-top-btn ${scrolled ? "kr-v2-top-btn--visible" : ""}`}
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Back to top"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
      </button>

      {/* ─────────── Footer ─────────── */}
      <footer className="kr-footer">
        <div className="kr-footer-glow" aria-hidden="true"></div>
        <div className="container">
          <div className="kr-footer-grid">
            <div className="kr-footer-brand">
              <div className="kr-footer-logo">KenReal<span className="kr-footer-dot"></span>Estates</div>
              <p className="kr-footer-tagline">
                Nairobi's trusted platform for finding rentals and leases. Connecting tenants and landlords since 2015.
              </p>
              <div className="kr-footer-socials">
                <a href="#" className="kr-social-btn" aria-label="Twitter">𝕏</a>
                <a href="#" className="kr-social-btn" aria-label="LinkedIn">in</a>
                <a href="#" className="kr-social-btn" aria-label="Instagram">◎</a>
              </div>
            </div>

            <div className="kr-footer-col">
              <p className="kr-footer-col-title">Explore</p>
              <ul className="kr-footer-links">
                <li><Link to="/browse">Browse Listings</Link></li>
                <li><a href="#why-us">Why KenReal</a></li>
                <li><a href="#contact">Contact Us</a></li>
              </ul>
            </div>

            <div className="kr-footer-col">
              <p className="kr-footer-col-title">Account</p>
              <ul className="kr-footer-links">
                <li><a href="/register">Create Account</a></li>
                <li><a href="/login">Log In</a></li>
                <li><a href="/register">List Your Property</a></li>
              </ul>
            </div>

            <div className="kr-footer-col">
              <p className="kr-footer-col-title">Contact</p>
              <ul className="kr-footer-links">
                <li><a href="mailto:hello@kenreal.co.ke">hello@kenreal.co.ke</a></li>
                <li><span>Westlands, Nairobi</span></li>
                <li><span>Mon–Fri, 8am–6pm EAT</span></li>
              </ul>
            </div>
          </div>

          <div className="kr-footer-bottom">
            <small>© {new Date().getFullYear()} KenReal Estates. All rights reserved.</small>
            <div className="kr-footer-bottom-links">
              <a href="#">Privacy Policy</a>
              <a href="#">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default HomePage;
