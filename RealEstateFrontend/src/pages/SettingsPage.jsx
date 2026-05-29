import { useEffect, useState } from "react";
import PortalLayout from "../components/PortalLayout";
import {
  assignEmployeeRole,
  getAccessControlModules,
  getEmployeeRoles,
  getEmailDeliveryConfiguration,
  getManageableUsers,
  getUserAccessProfile,
  replaceUserAccessOverrides,
  triggerSponsorshipExpiryRun,
  updateAccountProfile,
  updateEmailDeliveryConfiguration
} from "../services/authService";
import { notify } from "../utils/notify";
import { getStoredTheme, getStoredUser, setStoredTheme, setStoredUser } from "../utils/session";
import { getStoredPreferences, setStoredPreferences } from "../utils/userPreferences";
import { ACCESS_ACTIONS, MODULE_KEYS, canAccessModule } from "../utils/accessControl";

const COUNTRY_OPTIONS = [
  { code: "KE", label: "Kenya" },
  { code: "UG", label: "Uganda" },
  { code: "TZ", label: "Tanzania" },
  { code: "RW", label: "Rwanda" },
  { code: "BI", label: "Burundi" },
  { code: "ET", label: "Ethiopia" },
  { code: "SS", label: "South Sudan" },
  { code: "SO", label: "Somalia" }
];

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
    email: getStoredUser()?.email || "",
    countryCode: String(getStoredUser()?.countryCode || "KE").toUpperCase()
  }));
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [emailDeliveryProvider, setEmailDeliveryProvider] = useState("resend");
  const [emailDeliveryOptions, setEmailDeliveryOptions] = useState([]);
  const [isLoadingEmailDelivery, setIsLoadingEmailDelivery] = useState(false);
  const [isSavingEmailDelivery, setIsSavingEmailDelivery] = useState(false);
  const [isRunningSponsorshipJob, setIsRunningSponsorshipJob] = useState(false);
  const [lastSponsorshipJobResult, setLastSponsorshipJobResult] = useState(null);
  const isAdmin = user?.accountType === "admin";
  const isEmployee = user?.accountType === "employee";
  const canViewSystemSettings = canAccessModule(user, MODULE_KEYS.SYSTEM_SETTINGS, ACCESS_ACTIONS.VIEW);
  const canManageSystemSettings = canAccessModule(user, MODULE_KEYS.SYSTEM_SETTINGS, ACCESS_ACTIONS.MANAGE);
  const [accessModules, setAccessModules] = useState([]);
  const [adminEmployees, setAdminEmployees] = useState([]);
  const [employeeRoles, setEmployeeRoles] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedEmployeeRoleId, setSelectedEmployeeRoleId] = useState("");
  const [selectedEmployeeOverrides, setSelectedEmployeeOverrides] = useState([]);
  const [isLoadingAccessControl, setIsLoadingAccessControl] = useState(false);
  const [isSavingAccessControl, setIsSavingAccessControl] = useState(false);
  const [myAccessProfile, setMyAccessProfile] = useState(null);
  const [isLoadingMyAccess, setIsLoadingMyAccess] = useState(false);

  const initials = (() => {
    const parts = (user?.fullName || "U").split(" ");
    return parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : parts[0][0].toUpperCase();
  })();

  const upsertOverrideEntry = (moduleKey, submoduleKey, nextField, checked) => {
    const normalizedModule = String(moduleKey || "").trim().toLowerCase();
    const normalizedSubmodule = String(submoduleKey || "*").trim().toLowerCase() || "*";
    setSelectedEmployeeOverrides((prev) => {
      const next = Array.isArray(prev) ? [...prev] : [];
      const entryIndex = next.findIndex(
        (entry) =>
          String(entry.moduleKey || "").trim().toLowerCase() === normalizedModule &&
          String(entry.submoduleKey || "*").trim().toLowerCase() === normalizedSubmodule
      );
      const current = entryIndex >= 0
        ? { ...next[entryIndex] }
        : { moduleKey: normalizedModule, submoduleKey: normalizedSubmodule, canView: false, canManage: false };
      if (nextField === "canManage") {
        current.canManage = Boolean(checked);
        if (checked) current.canView = true;
      } else {
        current.canView = Boolean(checked);
        if (!checked) current.canManage = false;
      }
      if (!current.canView && !current.canManage) {
        if (entryIndex >= 0) next.splice(entryIndex, 1);
        return next;
      }
      if (entryIndex >= 0) next[entryIndex] = current;
      else next.push(current);
      return next;
    });
  };

  const getOverrideState = (moduleKey, submoduleKey, field) => {
    const normalizedModule = String(moduleKey || "").trim().toLowerCase();
    const normalizedSubmodule = String(submoduleKey || "*").trim().toLowerCase() || "*";
    const match = selectedEmployeeOverrides.find(
      (entry) =>
        String(entry.moduleKey || "").trim().toLowerCase() === normalizedModule &&
        String(entry.submoduleKey || "*").trim().toLowerCase() === normalizedSubmodule
    );
    return Boolean(match?.[field]);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    setStoredTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!canViewSystemSettings) {
      return;
    }

    const loadEmailDeliveryConfig = async () => {
      setIsLoadingEmailDelivery(true);
      try {
        const response = await getEmailDeliveryConfiguration();
        setEmailDeliveryProvider(response?.provider || "resend");
        setEmailDeliveryOptions(
          Array.isArray(response?.availableProviders) ? response.availableProviders : []
        );
      } catch (error) {
        notify(error.message || "Could not load email delivery settings.", "danger");
      } finally {
        setIsLoadingEmailDelivery(false);
      }
    };

    loadEmailDeliveryConfig();
  }, [canViewSystemSettings]);

  useEffect(() => {
    if (!isAdmin) return;
    if (activeSection !== "access-control") return;

    const loadAccessControlData = async () => {
      setIsLoadingAccessControl(true);
      try {
        const [modulesResponse, usersResponse, rolesResponse] = await Promise.all([
          getAccessControlModules(),
          getManageableUsers(),
          getEmployeeRoles()
        ]);
        const modules = Array.isArray(modulesResponse?.data) ? modulesResponse.data : [];
        const allUsers = Array.isArray(usersResponse?.data) ? usersResponse.data : [];
        const employees = allUsers.filter((item) => item.accountType === "employee");
        const roles = Array.isArray(rolesResponse?.data) ? rolesResponse.data : [];
        setAccessModules(modules);
        setAdminEmployees(employees);
        setEmployeeRoles(roles);

        const defaultEmployeeId = selectedEmployeeId || String(employees[0]?.id || "");
        setSelectedEmployeeId(defaultEmployeeId);
        if (defaultEmployeeId) {
          const accessProfile = await getUserAccessProfile(defaultEmployeeId);
          setSelectedEmployeeRoleId(
            accessProfile?.employeeRoleId ? String(accessProfile.employeeRoleId) : ""
          );
          setSelectedEmployeeOverrides(Array.isArray(accessProfile?.overrides) ? accessProfile.overrides : []);
        } else {
          setSelectedEmployeeRoleId("");
          setSelectedEmployeeOverrides([]);
        }
      } catch (error) {
        notify(error.message || "Failed to load access control settings.", "danger");
      } finally {
        setIsLoadingAccessControl(false);
      }
    };

    loadAccessControlData();
  }, [activeSection, isAdmin, selectedEmployeeId]);

  useEffect(() => {
    if (!isEmployee) return;
    if (activeSection !== "my-access") return;

    const loadMyAccess = async () => {
      setIsLoadingMyAccess(true);
      try {
        const [modulesResponse, accessResponse] = await Promise.all([
          getAccessControlModules(),
          getUserAccessProfile("me")
        ]);
        setAccessModules(Array.isArray(modulesResponse?.data) ? modulesResponse.data : []);
        setMyAccessProfile(accessResponse || null);
      } catch (error) {
        notify(error.message || "Failed to load your access profile.", "danger");
      } finally {
        setIsLoadingMyAccess(false);
      }
    };

    loadMyAccess();
  }, [activeSection, isEmployee]);

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
    const countryCode = String(profileForm.countryCode || "KE").trim().toUpperCase();

    if (!fullName || !email || !countryCode) {
      notify("Full name, email, and country are required.", "warning");
      return;
    }

    setIsSavingProfile(true);
    try {
      const response = await updateAccountProfile({
        userId: user.id,
        fullName,
        email,
        countryCode
      });
      const updatedUser = response.user;
      setUser(updatedUser);
      setStoredUser(updatedUser);
      setProfileForm({
        fullName: updatedUser.fullName || "",
        email: updatedUser.email || "",
        countryCode: String(updatedUser.countryCode || "KE").toUpperCase()
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

  const handleSaveEmailDeliveryProvider = async () => {
    if (!isAdmin) {
      notify("Only admin users can update email delivery settings.", "warning");
      return;
    }
    setIsSavingEmailDelivery(true);
    try {
      const response = await updateEmailDeliveryConfiguration({
        provider: emailDeliveryProvider
      });
      notify(response.message || "Email delivery provider updated.", "success");
    } catch (error) {
      notify(error.message || "Could not update email delivery provider.", "danger");
    } finally {
      setIsSavingEmailDelivery(false);
    }
  };

  const handleRunSponsorshipExpiryJob = async () => {
    setIsRunningSponsorshipJob(true);
    try {
      const response = await triggerSponsorshipExpiryRun();
      setLastSponsorshipJobResult(response?.result || null);
      notify(response?.message || "Sponsorship maintenance run completed.", "success");
    } catch (error) {
      const message = error.message || "Could not run sponsorship maintenance job.";
      notify(message, "danger");
    } finally {
      setIsRunningSponsorshipJob(false);
    }
  };

  const handleSelectEmployeeForAccess = async (event) => {
    const employeeId = String(event.target.value || "");
    setSelectedEmployeeId(employeeId);
    if (!employeeId) {
      setSelectedEmployeeRoleId("");
      setSelectedEmployeeOverrides([]);
      return;
    }
    setIsLoadingAccessControl(true);
    try {
      const accessProfile = await getUserAccessProfile(employeeId);
      setSelectedEmployeeRoleId(
        accessProfile?.employeeRoleId ? String(accessProfile.employeeRoleId) : ""
      );
      setSelectedEmployeeOverrides(Array.isArray(accessProfile?.overrides) ? accessProfile.overrides : []);
    } catch (error) {
      notify(error.message || "Failed to load selected employee permissions.", "danger");
    } finally {
      setIsLoadingAccessControl(false);
    }
  };

  const handleSaveEmployeeAccessControl = async () => {
    if (!selectedEmployeeId) {
      notify("Select an employee first.", "warning");
      return;
    }
    setIsSavingAccessControl(true);
    try {
      await assignEmployeeRole(selectedEmployeeId, {
        employeeRoleId: selectedEmployeeRoleId ? Number(selectedEmployeeRoleId) : null
      });
      await replaceUserAccessOverrides(selectedEmployeeId, {
        overrides: selectedEmployeeOverrides
      });
      notify("Employee access control updated successfully.", "success");
    } catch (error) {
      notify(error.message || "Failed to update employee access control.", "danger");
    } finally {
      setIsSavingAccessControl(false);
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
  if (isAdmin) {
    SECTIONS.push({
      id: "access-control",
      label: "Access Control",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="M9 12l2 2 4-4"/>
        </svg>
      )
    });
  }
  if (canViewSystemSettings) {
    SECTIONS.push({
      id: "email-delivery",
      label: "Email Delivery",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16v16H4z"/>
          <path d="m4 8 8 5 8-5"/>
        </svg>
      )
    });
  }
  if (canManageSystemSettings) {
    SECTIONS.push({
      id: "maintenance",
      label: "Maintenance",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
      )
    });
  }
  if (isEmployee) {
    SECTIONS.push({
      id: "my-access",
      label: "My Access",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      )
    });
  }

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
                <div className="kr-settings-field">
                  <label className="kr-settings-field-label">Country</label>
                  <select
                    className="kr-form-input"
                    name="countryCode"
                    value={profileForm.countryCode}
                    onChange={handleProfileInputChange}
                  >
                    {COUNTRY_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
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

          {activeSection === "access-control" && isAdmin && (
            <div className="kr-settings-card">
              <h2 className="kr-settings-card-title">Employee Access Control</h2>
              <p className="kr-settings-card-sub">
                Select an employee, assign a role template, then fine-tune per-module permissions with the toggles below.
              </p>

              {isLoadingAccessControl ? (
                <div className="kr-settings-ac-loading">
                  <div className="kr-audit-spinner"/>
                  <span>Loading access control data…</span>
                </div>
              ) : (
                <>
                  {adminEmployees.length === 0 ? (
                    <div className="kr-settings-ac-empty">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                      <p>No employee accounts yet. Create employees from the <strong>User Access Control</strong> page.</p>
                    </div>
                  ) : (
                    <>
                      <div className="kr-settings-ac-selectors">
                        <div className="kr-settings-field">
                          <label className="kr-settings-field-label">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "0.3rem", verticalAlign: "middle" }}>
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                            </svg>
                            Employee
                          </label>
                          <select className="kr-form-input" value={selectedEmployeeId} onChange={handleSelectEmployeeForAccess}>
                            {adminEmployees.map((employee) => (
                              <option key={employee.id} value={employee.id}>{employee.fullName} ({employee.email})</option>
                            ))}
                          </select>
                        </div>
                        <div className="kr-settings-field">
                          <label className="kr-settings-field-label">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "0.3rem", verticalAlign: "middle" }}>
                              <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/>
                            </svg>
                            Role Template
                          </label>
                          <select className="kr-form-input" value={selectedEmployeeRoleId} onChange={(event) => setSelectedEmployeeRoleId(event.target.value)} disabled={!selectedEmployeeId}>
                            <option value="">No role assigned</option>
                            {employeeRoles.map((role) => <option key={role.id} value={role.id}>{role.roleName}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="kr-settings-ac-matrix-label">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                        Module permission overrides
                      </div>

                      <div className="kr-settings-ac-matrix">
                        {accessModules.map((module) => {
                          const moduleView = getOverrideState(module.key, "*", "canView");
                          const moduleManage = getOverrideState(module.key, "*", "canManage");
                          return (
                            <div key={module.key} className={`kr-settings-ac-row${!selectedEmployeeId ? " kr-settings-ac-row--disabled" : ""}`}>
                              <div className="kr-settings-ac-row-head">
                                <span className="kr-settings-ac-module-name">{module.label}</span>
                                <div className="kr-settings-ac-toggles">
                                  <button
                                    type="button"
                                    className={`kr-settings-ac-pill${moduleView ? " kr-settings-ac-pill--on" : ""}`}
                                    onClick={() => selectedEmployeeId && upsertOverrideEntry(module.key, "*", "canView", !moduleView)}
                                    disabled={!selectedEmployeeId}
                                    aria-pressed={moduleView}
                                  >
                                    View
                                  </button>
                                  <button
                                    type="button"
                                    className={`kr-settings-ac-pill${moduleManage ? " kr-settings-ac-pill--on kr-settings-ac-pill--manage" : ""}`}
                                    onClick={() => selectedEmployeeId && upsertOverrideEntry(module.key, "*", "canManage", !moduleManage)}
                                    disabled={!selectedEmployeeId}
                                    aria-pressed={moduleManage}
                                  >
                                    Manage
                                  </button>
                                </div>
                              </div>
                              {Array.isArray(module.submodules) && module.submodules.length > 0 && (
                                <div className="kr-settings-ac-subrows">
                                  {module.submodules.map((submodule) => {
                                    const subView = getOverrideState(module.key, submodule.key, "canView");
                                    const subManage = getOverrideState(module.key, submodule.key, "canManage");
                                    return (
                                      <div key={submodule.key} className="kr-settings-ac-subrow">
                                        <span className="kr-settings-ac-subrow-label">{submodule.label}</span>
                                        <div className="kr-settings-ac-toggles">
                                          <button type="button" className={`kr-settings-ac-pill kr-settings-ac-pill--sm${subView ? " kr-settings-ac-pill--on" : ""}`}
                                            onClick={() => selectedEmployeeId && upsertOverrideEntry(module.key, submodule.key, "canView", !subView)}
                                            disabled={!selectedEmployeeId} aria-pressed={subView}>View</button>
                                          <button type="button" className={`kr-settings-ac-pill kr-settings-ac-pill--sm${subManage ? " kr-settings-ac-pill--on kr-settings-ac-pill--manage" : ""}`}
                                            onClick={() => selectedEmployeeId && upsertOverrideEntry(module.key, submodule.key, "canManage", !subManage)}
                                            disabled={!selectedEmployeeId} aria-pressed={subManage}>Manage</button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="kr-settings-actions">
                        <button type="button" className="kr-settings-save-btn" onClick={handleSaveEmployeeAccessControl} disabled={!selectedEmployeeId || isSavingAccessControl}>
                          {isSavingAccessControl ? "Saving…" : "Save Access Control"}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {activeSection === "my-access" && isEmployee && (
            <div className="kr-settings-card">
              <h2 className="kr-settings-card-title">My Effective Access</h2>
              <p className="kr-settings-card-sub">
                Read-only view of the modules and actions currently granted to your account.
              </p>

              {isLoadingMyAccess ? (
                <div className="kr-settings-ac-loading">
                  <div className="kr-audit-spinner"/>
                  <span>Loading your access profile…</span>
                </div>
              ) : (
                <>
                  <div className="kr-settings-my-role-banner">
                    <div className="kr-settings-my-role-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/>
                      </svg>
                    </div>
                    <div>
                      <p className="kr-settings-my-role-label">Assigned role</p>
                      <p className="kr-settings-my-role-name">{myAccessProfile?.employeeRoleName || "No role assigned"}</p>
                    </div>
                  </div>

                  <div className="kr-settings-my-modules">
                    {accessModules.map((module) => {
                      const canView = canAccessModule(user, module.key, "view");
                      const canManage = canAccessModule(user, module.key, "manage");
                      const hasAnyAccess = canView || canManage;
                      return (
                        <div key={module.key} className={`kr-settings-my-module${hasAnyAccess ? " kr-settings-my-module--granted" : " kr-settings-my-module--denied"}`}>
                          <div className="kr-settings-my-module-left">
                            <div className={`kr-settings-my-module-dot${hasAnyAccess ? " kr-settings-my-module-dot--granted" : ""}`}/>
                            <span className="kr-settings-my-module-name">{module.label}</span>
                          </div>
                          <div className="kr-settings-my-module-perms">
                            <span className={`kr-settings-my-perm${canView ? " kr-settings-my-perm--on" : ""}`}>
                              {canView ? (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              ) : (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                              )}
                              View
                            </span>
                            <span className={`kr-settings-my-perm${canManage ? " kr-settings-my-perm--manage" : ""}`}>
                              {canManage ? (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              ) : (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                              )}
                              Manage
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {activeSection === "email-delivery" && canViewSystemSettings && (
            <div className="kr-settings-card">
              <h2 className="kr-settings-card-title">System Email Delivery</h2>
              <p className="kr-settings-card-sub">
                Select how the platform sends emails to clients. For MVP, use Resend.
              </p>
              <div className="kr-settings-grid">
                <div className="kr-settings-field">
                  <label className="kr-settings-field-label">Active Provider</label>
                  <select
                    className="kr-form-input"
                    value={emailDeliveryProvider}
                    onChange={(event) => setEmailDeliveryProvider(event.target.value)}
                    disabled={isLoadingEmailDelivery || isSavingEmailDelivery || !canManageSystemSettings}
                  >
                    {(emailDeliveryOptions.length
                      ? emailDeliveryOptions
                      : [
                          { id: "resend", label: "Resend (recommended for MVP)" },
                          { id: "smtp", label: "SMTP (custom mail server)" },
                          { id: "disabled", label: "Disabled (no outbound email)" }
                        ]
                    ).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="kr-settings-actions">
                <button
                  type="button"
                  className="kr-settings-save-btn"
                  onClick={handleSaveEmailDeliveryProvider}
                  disabled={isLoadingEmailDelivery || isSavingEmailDelivery || !canManageSystemSettings}
                >
                  {isSavingEmailDelivery ? "Saving..." : "Save Email Provider"}
                </button>
              </div>
            </div>
          )}

          {activeSection === "maintenance" && canManageSystemSettings && (
            <div className="kr-settings-card">
              <h2 className="kr-settings-card-title">System Maintenance</h2>
              <p className="kr-settings-card-sub">
                Run background jobs on demand for QA and troubleshooting. Scheduled cron runs continue automatically.
              </p>

              <div className="kr-settings-maintenance-panel">
                <div className="kr-settings-maintenance-header">
                  <div>
                    <h3 className="kr-settings-maintenance-title">Sponsored Listing Expiry</h3>
                    <p className="kr-settings-maintenance-desc">
                      Sends 24-hour warnings, downgrades expired sponsored listings, and sends expiry notices.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="kr-settings-save-btn"
                    onClick={handleRunSponsorshipExpiryJob}
                    disabled={isRunningSponsorshipJob}
                  >
                    {isRunningSponsorshipJob ? "Running..." : "Run Now"}
                  </button>
                </div>

                {lastSponsorshipJobResult && (
                  <div className="kr-settings-maintenance-results">
                    <p className="kr-settings-maintenance-results-label">
                      Last run
                      {lastSponsorshipJobResult.processedAt
                        ? ` · ${new Date(lastSponsorshipJobResult.processedAt).toLocaleString()}`
                        : ""}
                      {lastSponsorshipJobResult.skipped ? " · skipped (already running)" : ""}
                    </p>
                    <div className="kr-settings-maintenance-stats">
                      <div className="kr-settings-maintenance-stat">
                        <span className="kr-settings-maintenance-stat-value">
                          {Number(lastSponsorshipJobResult.warnedCount || 0)}
                          <span className="kr-settings-maintenance-stat-total">
                            /{Number(lastSponsorshipJobResult.warningCandidates || 0)}
                          </span>
                        </span>
                        <span className="kr-settings-maintenance-stat-label">Warnings sent</span>
                      </div>
                      <div className="kr-settings-maintenance-stat">
                        <span className="kr-settings-maintenance-stat-value">
                          {Number(lastSponsorshipJobResult.downgradedCount || 0)}
                          <span className="kr-settings-maintenance-stat-total">
                            /{Number(lastSponsorshipJobResult.downgradeCandidates || 0)}
                          </span>
                        </span>
                        <span className="kr-settings-maintenance-stat-label">Listings downgraded</span>
                      </div>
                      <div className="kr-settings-maintenance-stat">
                        <span className="kr-settings-maintenance-stat-value">
                          {Number(lastSponsorshipJobResult.expiredNotifiedCount || 0)}
                          <span className="kr-settings-maintenance-stat-total">
                            /{Number(lastSponsorshipJobResult.expiredNoticeCandidates || 0)}
                          </span>
                        </span>
                        <span className="kr-settings-maintenance-stat-label">Expiry notices</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </PortalLayout>
  );
}

export default SettingsPage;
