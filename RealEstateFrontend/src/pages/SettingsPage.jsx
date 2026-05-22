import { useEffect, useState } from "react";
import PortalLayout from "../components/PortalLayout";
import { updateAccountProfile } from "../services/authService";
import { notify } from "../utils/notify";
import { getStoredTheme, getStoredUser, setStoredTheme, setStoredUser } from "../utils/session";
import { getStoredPreferences, setStoredPreferences } from "../utils/userPreferences";

function PillToggle({ name, checked, onChange, label, description }) {
  return (
    <label className="kr-toggle-row" htmlFor={`toggle-${name}`}>
      <div className="kr-toggle-info">
        <span className="kr-toggle-label">{label}</span>
        {description && <span className="kr-toggle-desc">{description}</span>}
      </div>
      <button
        type="button"
        id={`toggle-${name}`}
        role="switch"
        aria-checked={checked}
        className={`kr-pill-toggle${checked ? " on" : ""}`}
        onClick={() => onChange({ target: { name, checked: !checked } })}
      >
        <span className="kr-pill-thumb"></span>
      </button>
    </label>
  );
}

function SettingsPage() {
  const [user, setUser] = useState(() => getStoredUser());
  const [theme, setTheme] = useState(() => getStoredTheme());
  const [preferences, setPreferences] = useState(() => getStoredPreferences());
  const [activeSection, setActiveSection] = useState("profile");
  const [profileForm, setProfileForm] = useState(() => ({
    fullName: getStoredUser()?.fullName || "",
    email: getStoredUser()?.email || ""
  }));
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const initials = (() => {
    const parts = (user?.fullName || "U").split(" ");
    return parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : parts[0][0].toUpperCase();
  })();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    setStoredTheme(theme);
  }, [theme]);

  const handlePreferenceChange = (event) => {
    const { name, checked } = event.target;
    setPreferences((prev) => ({ ...prev, [name]: checked }));
  };

  const handleProfileInputChange = (event) => {
    const { name, value } = event.target;
    setProfileForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSaveProfile = async () => {
    if (!user?.id) {
      notify("Session expired. Please log in again.", "warning");
      return;
    }

    const fullName = profileForm.fullName.trim();
    const email = profileForm.email.trim().toLowerCase();

    if (!fullName || !email) {
      notify("Full name and email are required.", "warning");
      return;
    }

    setIsSavingProfile(true);
    try {
      const response = await updateAccountProfile({
        userId: user.id,
        fullName,
        email
      });
      const updatedUser = response.user;
      setUser(updatedUser);
      setStoredUser(updatedUser);
      setProfileForm({
        fullName: updatedUser.fullName || "",
        email: updatedUser.email || ""
      });
      notify("Profile updated successfully.", "success");
    } catch (error) {
      notify(error.message || "Could not update profile right now.", "danger");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const savePreferences = () => {
    try {
      setStoredPreferences(preferences);
      notify("Settings saved successfully.", "success");
    } catch {
      notify("Could not save settings right now.", "danger");
    }
  };

  const SECTIONS = [
    {
      id: "profile",
      label: "Profile",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      )
    },
    {
      id: "appearance",
      label: "Appearance",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      )
    },
    {
      id: "preferences",
      label: "Preferences",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/>
          <line x1="12" y1="18" x2="20" y2="18"/>
          <circle cx="2" cy="6" r="1" fill="currentColor" stroke="none"/>
          <circle cx="6" cy="12" r="1" fill="currentColor" stroke="none"/>
          <circle cx="10" cy="18" r="1" fill="currentColor" stroke="none"/>
        </svg>
      )
    }
  ];

  return (
    <PortalLayout
      title="Settings"
      subtitle="Manage your profile, appearance, and notification preferences."
    >
      <div className="kr-settings-layout">
        {/* Side nav */}
        <aside className="kr-settings-side-nav">
          {SECTIONS.map((sec) => (
            <button
              key={sec.id}
              type="button"
              className={`kr-settings-side-link${activeSection === sec.id ? " active" : ""}`}
              onClick={() => setActiveSection(sec.id)}
            >
              <span className="kr-settings-side-icon">{sec.icon}</span>
              {sec.label}
            </button>
          ))}
        </aside>

        {/* Main content */}
        <div className="kr-settings-content">

          {/* ── Profile ── */}
          {activeSection === "profile" && (
            <div className="kr-settings-card">
              {/* Avatar banner */}
              <div className="kr-settings-profile-banner">
                <div className="kr-settings-profile-avatar">{initials}</div>
                <div>
                  <p className="kr-settings-profile-name">{user?.fullName || "—"}</p>
                  <p className="kr-settings-profile-email">{user?.email || "—"}</p>
                  <span className={`kr-sidebar-role-badge kr-sidebar-role-${user?.accountType || "viewer"}`}>
                    {user?.accountType || "viewer"}
                  </span>
                </div>
              </div>

              <h2 className="kr-settings-card-title">Account Details</h2>
              <p className="kr-settings-card-sub">Update your profile information below and save your changes.</p>
              <div className="kr-settings-grid">
                <div className="kr-settings-field">
                  <label className="kr-settings-field-label">Full Name</label>
                  <input
                    type="text"
                    className="kr-form-input"
                    name="fullName"
                    value={profileForm.fullName}
                    onChange={handleProfileInputChange}
                  />
                </div>
                <div className="kr-settings-field">
                  <label className="kr-settings-field-label">Email Address</label>
                  <input
                    type="email"
                    className="kr-form-input"
                    name="email"
                    value={profileForm.email}
                    onChange={handleProfileInputChange}
                  />
                </div>
                <div className="kr-settings-field">
                  <label className="kr-settings-field-label">Account Type</label>
                  <input type="text" className="kr-form-input text-capitalize" value={user?.accountType || ""} readOnly />
                </div>
              </div>
              <div className="kr-settings-actions">
                <button
                  type="button"
                  className="kr-settings-save-btn"
                  onClick={handleSaveProfile}
                  disabled={isSavingProfile}
                >
                  {isSavingProfile ? "Saving..." : "Save Profile"}
                </button>
              </div>
            </div>
          )}

          {/* ── Appearance ── */}
          {activeSection === "appearance" && (
            <div className="kr-settings-card">
              <h2 className="kr-settings-card-title">Appearance</h2>
              <p className="kr-settings-card-sub">Choose how your portal looks. Your preference is saved automatically.</p>
              <div className="kr-theme-cards">
                {[
                  { id: "light", label: "Light", previewClass: "kr-theme-preview--light" },
                  { id: "dark",  label: "Dark",  previewClass: "kr-theme-preview--dark"  }
                ].map(({ id, label, previewClass }) => {
                  const isActive = theme === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`kr-theme-card${isActive ? " active" : ""}`}
                      onClick={() => setTheme(id)}
                      aria-pressed={isActive}
                    >
                      <div className={`kr-theme-preview ${previewClass}`}>
                        <div className="kr-theme-preview-bar"></div>
                        <div className="kr-theme-preview-content">
                          <div className="kr-theme-preview-line long"></div>
                          <div className="kr-theme-preview-line short"></div>
                        </div>
                        {isActive && (
                          <span className="kr-theme-active-badge" aria-hidden="true">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          </span>
                        )}
                      </div>
                      <div className="kr-theme-card-label">
                        {label}
                        {isActive && <span className="kr-theme-active-pill">Active</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Preferences ── */}
          {activeSection === "preferences" && (
            <div className="kr-settings-card">
              <h2 className="kr-settings-card-title">Preferences</h2>
              <p className="kr-settings-card-sub">Control your notification and visibility settings.</p>
              <div className="kr-settings-toggles">
                <PillToggle
                  name="emailUpdates"
                  checked={preferences.emailUpdates}
                  onChange={handlePreferenceChange}
                  label="Email Updates"
                  description="Receive emails when new listings are published in your area."
                />
                <PillToggle
                  name="inquiryAlerts"
                  checked={preferences.inquiryAlerts}
                  onChange={handlePreferenceChange}
                  label="Inquiry Alerts"
                  description="Get notified when someone submits an inquiry on your listings."
                />
                <PillToggle
                  name="profileVisible"
                  checked={preferences.profileVisible}
                  onChange={handlePreferenceChange}
                  label="Profile Visibility"
                  description="Allow your profile to be visible to other users in the portal."
                />
                <PillToggle
                  name="incomingMessageTone"
                  checked={preferences.incomingMessageTone}
                  onChange={handlePreferenceChange}
                  label="Incoming Message Tone"
                  description="Play a short tone whenever a new in-app message arrives in real time."
                />
              </div>

              <div className="kr-settings-actions">
                <button type="button" className="kr-settings-save-btn" onClick={savePreferences}>
                  Save Preferences
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}

export default SettingsPage;
