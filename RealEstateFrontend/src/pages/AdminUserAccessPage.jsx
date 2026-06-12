import { useEffect, useMemo, useState } from "react";
import PortalLayout from "../components/PortalLayout";
import {
  assignEmployeeRole,
  banUserAccount,
  clearUserRestrictions,
  createEmployeeRole,
  createAdminUser,
  createEmployeeUser,
  getAccessControlModules,
  getEmployeeRoles,
  getUserAccessProfile,
  getManageableUsers,
  updateEmployeeRole,
  deleteEmployeeRole,
  replaceUserAccessOverrides,
  suspendUserAccount
} from "../services/authService";
import { getStoredUser } from "../utils/session";
import { notify } from "../utils/notify";
import { ACCESS_ACTIONS, MODULE_KEYS, canAccessModule } from "../utils/accessControl";

const SUSPENSION_OPTIONS = [
  { label: "1 hour",   hours: 1   },
  { label: "6 hours",  hours: 6   },
  { label: "12 hours", hours: 12  },
  { label: "24 hours", hours: 24  },
  { label: "3 days",   hours: 72  },
  { label: "7 days",   hours: 168 },
  { label: "30 days",  hours: 720 }
];

const MODULE_ICONS = {
  user_access: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  audit_logs: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12h6"/><path d="M9 16h6"/><path d="M9 8h6"/>
      <path d="M5 3h14a2 2 0 0 1 2 2v14l-4-2-4 2-4-2-4 2V5a2 2 0 0 1 2-2z"/>
    </svg>
  ),
  listing_reports: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
      <line x1="4" y1="22" x2="4" y2="15"/>
    </svg>
  ),
  admin_messages: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  admin_finances: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  pricing: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
      <line x1="7" y1="7" x2="7.01" y2="7"/>
    </svg>
  ),
  system_settings: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  property_moderation: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  )
};

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-KE");
}

function getInitials(fullName) {
  const parts = String(fullName || "U").trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getUserStatus(user) {
  if (user.isBanned) {
    return {
      label: "Banned",
      cls: "kr-uac-status-badge kr-uac-status-badge--banned",
      dotCls: "kr-uac-status-dot kr-uac-status-dot--banned"
    };
  }
  if (user.isSuspended) {
    return {
      label: "Suspended",
      cls: "kr-uac-status-badge kr-uac-status-badge--suspended",
      dotCls: "kr-uac-status-dot kr-uac-status-dot--suspended"
    };
  }
  return {
    label: "Active",
    cls: "kr-uac-status-badge kr-uac-status-badge--active",
    dotCls: "kr-uac-status-dot kr-uac-status-dot--active"
  };
}

function normalizeOverrideEntry(moduleKey, submoduleKey, canView, canManage) {
  return {
    moduleKey: String(moduleKey || "").trim().toLowerCase(),
    submoduleKey: String(submoduleKey || "*").trim().toLowerCase() || "*",
    canView: Boolean(canView || canManage),
    canManage: Boolean(canManage)
  };
}

function PermissionToggle({ checked, onChange, label, disabled }) {
  return (
    <label className={`kr-uac-perm-toggle${checked ? " kr-uac-perm-toggle--on" : ""}${disabled ? " kr-uac-perm-toggle--disabled" : ""}`}>
      <span className="kr-uac-perm-toggle-track" onClick={disabled ? undefined : onChange}>
        <span className="kr-uac-perm-toggle-thumb" />
      </span>
      <span className="kr-uac-perm-toggle-label">{label}</span>
    </label>
  );
}

function StatCard({ value, label, colorClass, icon }) {
  return (
    <div className={`kr-uac-stat ${colorClass}`}>
      <div className="kr-uac-stat-icon">{icon}</div>
      <div className="kr-uac-stat-body">
        <p className="kr-uac-stat-value">{value}</p>
        <p className="kr-uac-stat-label">{label}</p>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}

function AdminUserAccessPage() {
  const currentUser = getStoredUser();
  const canManageUserAccess = canAccessModule(currentUser, MODULE_KEYS.USER_ACCESS, ACCESS_ACTIONS.MANAGE);
  const [activeTab, setActiveTab] = useState("users");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  /* modal state */
  const [modalUser, setModalUser] = useState(null);
  const [suspendHours, setSuspendHours] = useState(24);
  const [suspendReason, setSuspendReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCreateAdminOpen, setIsCreateAdminOpen] = useState(false);
  const [isCreatingAdmin, setIsCreatingAdmin] = useState(false);
  const [newAdminForm, setNewAdminForm] = useState({ fullName: "", email: "", password: "" });

  /* employee state */
  const [employeeRoles, setEmployeeRoles] = useState([]);
  const [accessModules, setAccessModules] = useState([]);
  const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);
  const [newEmployeeForm, setNewEmployeeForm] = useState({ fullName: "", email: "", temporaryPassword: "", employeeRoleId: "" });
  const [overrideEditorUser, setOverrideEditorUser] = useState(null);
  const [overrideEntries, setOverrideEntries] = useState([]);
  const [isSavingOverrides, setIsSavingOverrides] = useState(false);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [newRoleForm, setNewRoleForm] = useState({ roleName: "", roleDescription: "" });
  const [isSavingRole, setIsSavingRole] = useState(false);

  const openModal = (user) => { setModalUser(user); setSuspendHours(24); setSuspendReason(""); setBanReason(""); };
  const closeModal = () => { if (isSubmitting) return; setModalUser(null); };
  const openCreateAdminModal = () => { setNewAdminForm({ fullName: "", email: "", password: "" }); setIsCreateAdminOpen(true); };
  const closeCreateAdminModal = () => { if (isCreatingAdmin) return; setIsCreateAdminOpen(false); };

  useEffect(() => {
    if (!modalUser && !isCreateAdminOpen && !overrideEditorUser) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (modalUser && !isSubmitting) closeModal();
      if (isCreateAdminOpen && !isCreatingAdmin) closeCreateAdminModal();
      if (overrideEditorUser && !isSavingOverrides) setOverrideEditorUser(null);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalUser, isCreateAdminOpen, overrideEditorUser, isSubmitting, isCreatingAdmin, isSavingOverrides]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const [response, rolesResponse, modulesResponse] = await Promise.all([
        getManageableUsers(),
        getEmployeeRoles(),
        getAccessControlModules()
      ]);
      setRows(Array.isArray(response?.data) ? response.data : []);
      setEmployeeRoles(Array.isArray(rolesResponse?.data) ? rolesResponse.data : []);
      setAccessModules(Array.isArray(modulesResponse?.data) ? modulesResponse.data : []);
    } catch (error) {
      notify(error.message || "Failed to load users.", "danger");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadUsers(); }, []);

  const stats = useMemo(() => {
    let active = 0; let suspended = 0; let banned = 0; let employees = 0;
    rows.forEach((r) => {
      if (r.accountType === "employee") employees += 1;
      if (r.isBanned) banned += 1;
      else if (r.isSuspended) suspended += 1;
      else active += 1;
    });
    return { total: rows.length, active, suspended, banned, employees };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        String(r.fullName || "").toLowerCase().includes(q) ||
        String(r.email || "").toLowerCase().includes(q) ||
        String(r.accountType || "").toLowerCase().includes(q) ||
        String(r.employeeRoleName || "").toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

  const afterAction = async (message, variant) => { notify(message, variant); await loadUsers(); setModalUser(null); };

  const handleSuspend = async () => {
    if (!modalUser) return;
    setIsSubmitting(true);
    try {
      await suspendUserAccount(modalUser.id, { durationHours: suspendHours, reason: suspendReason.trim() || `admin_suspension_${suspendHours}h` });
      await afterAction(`${modalUser.fullName} has been suspended.`, "success");
    } catch (error) { notify(error.message || "Failed to suspend user.", "danger"); }
    finally { setIsSubmitting(false); }
  };

  const handleBan = async () => {
    if (!modalUser) return;
    setIsSubmitting(true);
    try {
      await banUserAccount(modalUser.id, { reason: banReason.trim() || "admin_permanent_ban" });
      await afterAction(`${modalUser.fullName} has been permanently banned.`, "warning");
    } catch (error) { notify(error.message || "Failed to ban user.", "danger"); }
    finally { setIsSubmitting(false); }
  };

  const handleReinstate = async (targetUser) => {
    setIsSubmitting(true);
    try {
      await clearUserRestrictions(targetUser.id);
      await afterAction(`${targetUser.fullName}'s access has been reinstated.`, "success");
    } catch (error) { notify(error.message || "Failed to reinstate user.", "danger"); }
    finally { setIsSubmitting(false); }
  };

  const handleCreateAdmin = async (event) => {
    event.preventDefault();
    const fullName = String(newAdminForm.fullName || "").trim();
    const email = String(newAdminForm.email || "").trim().toLowerCase();
    const password = String(newAdminForm.password || "");
    if (!fullName || !email || !password) { notify("Full name, email, and password are required.", "warning"); return; }
    setIsCreatingAdmin(true);
    try {
      await createAdminUser({ fullName, email, password });
      notify("Admin account created successfully.", "success");
      setIsCreateAdminOpen(false);
      await loadUsers();
    } catch (error) { notify(error.message || "Failed to create admin account.", "danger"); }
    finally { setIsCreatingAdmin(false); }
  };

  const handleCreateEmployee = async (event) => {
    event.preventDefault();
    const payload = {
      fullName: String(newEmployeeForm.fullName || "").trim(),
      email: String(newEmployeeForm.email || "").trim().toLowerCase(),
      temporaryPassword: String(newEmployeeForm.temporaryPassword || ""),
      employeeRoleId: newEmployeeForm.employeeRoleId ? Number(newEmployeeForm.employeeRoleId) : null
    };
    if (!payload.fullName || !payload.email || !payload.temporaryPassword) { notify("Full name, email and temporary password are required.", "warning"); return; }
    setIsCreatingEmployee(true);
    try {
      await createEmployeeUser(payload);
      notify("Employee account created successfully.", "success");
      setNewEmployeeForm({ fullName: "", email: "", temporaryPassword: "", employeeRoleId: "" });
      await loadUsers();
    } catch (error) { notify(error.message || "Failed to create employee user.", "danger"); }
    finally { setIsCreatingEmployee(false); }
  };

  const handleEmployeeRoleChange = async (userId, nextRoleId) => {
    try {
      await assignEmployeeRole(userId, { employeeRoleId: nextRoleId ? Number(nextRoleId) : null });
      notify("Employee role assignment updated.", "success");
      await loadUsers();
    } catch (error) { notify(error.message || "Failed to update employee role assignment.", "danger"); }
  };

  const handleCreateRole = async (event) => {
    event.preventDefault();
    const roleName = String(newRoleForm.roleName || "").trim();
    const roleDescription = String(newRoleForm.roleDescription || "").trim();
    if (!roleName) { notify("Role name is required.", "warning"); return; }
    setIsSavingRole(true);
    try {
      await createEmployeeRole({ roleName, roleDescription });
      notify("Employee role created successfully.", "success");
      setNewRoleForm({ roleName: "", roleDescription: "" });
      await loadUsers();
    } catch (error) { notify(error.message || "Failed to create employee role.", "danger"); }
    finally { setIsSavingRole(false); }
  };

  const handleToggleRoleActive = async (role) => {
    setIsSavingRole(true);
    try {
      await updateEmployeeRole(role.id, { roleName: role.roleName, roleDescription: role.roleDescription || "", isActive: !role.isActive });
      notify("Employee role updated.", "success");
      await loadUsers();
    } catch (error) { notify(error.message || "Failed to update employee role.", "danger"); }
    finally { setIsSavingRole(false); }
  };

  const handleDeleteRole = async (role) => {
    if (!window.confirm(`Delete role "${role.roleName}"? This cannot be undone.`)) return;
    setIsSavingRole(true);
    try {
      await deleteEmployeeRole(role.id);
      notify("Employee role deleted.", "success");
      await loadUsers();
    } catch (error) { notify(error.message || "Failed to delete employee role.", "danger"); }
    finally { setIsSavingRole(false); }
  };

  const openOverrideEditor = async (user) => {
    setOverrideEditorUser(user);
    setOverrideEntries([]);
    setOverrideLoading(true);
    try {
      const response = await getUserAccessProfile(user.id);
      setOverrideEntries(Array.isArray(response?.overrides) ? response.overrides : []);
    } catch (error) { notify(error.message || "Failed to load user overrides.", "danger"); }
    finally { setOverrideLoading(false); }
  };

  const getOverrideChecked = (moduleKey, submoduleKey, field) => {
    const nm = String(moduleKey || "").trim().toLowerCase();
    const ns = String(submoduleKey || "*").trim().toLowerCase() || "*";
    const entry = overrideEntries.find((item) => String(item.moduleKey || "").trim().toLowerCase() === nm && String(item.submoduleKey || "*").trim().toLowerCase() === ns);
    return Boolean(entry?.[field]);
  };

  const updateOverrideChecked = (moduleKey, submoduleKey, field, checked) => {
    const nextEntry = normalizeOverrideEntry(
      moduleKey, submoduleKey,
      field === "canView" ? checked : getOverrideChecked(moduleKey, submoduleKey, "canView"),
      field === "canManage" ? checked : getOverrideChecked(moduleKey, submoduleKey, "canManage")
    );
    if (field === "canManage" && checked) nextEntry.canView = true;
    if (field === "canView" && !checked) nextEntry.canManage = false;
    setOverrideEntries((prev) => {
      const next = [...prev];
      const idx = next.findIndex((item) => item.moduleKey === nextEntry.moduleKey && String(item.submoduleKey || "*") === String(nextEntry.submoduleKey || "*"));
      if (!nextEntry.canView && !nextEntry.canManage) { if (idx >= 0) next.splice(idx, 1); return next; }
      if (idx >= 0) next[idx] = nextEntry; else next.push(nextEntry);
      return next;
    });
  };

  const handleSaveOverrides = async () => {
    if (!overrideEditorUser) return;
    setIsSavingOverrides(true);
    try {
      await replaceUserAccessOverrides(overrideEditorUser.id, { overrides: overrideEntries });
      notify("Employee overrides updated successfully.", "success");
      setOverrideEditorUser(null);
      await loadUsers();
    } catch (error) { notify(error.message || "Failed to save employee overrides.", "danger"); }
    finally { setIsSavingOverrides(false); }
  };

  const modalStatus = modalUser ? getUserStatus(modalUser) : null;

  return (
    <PortalLayout
      title="User Access Control"
      subtitle="Manage accounts, employee roles, and module-level permissions."
    >
      {/* ── Stat cards ── */}
      <div className="kr-uac-stats-row">
        <StatCard value={loading ? "—" : stats.total} label="Total accounts" colorClass="kr-uac-stat--blue" icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        }/>
        <StatCard value={loading ? "—" : stats.active} label="Active" colorClass="kr-uac-stat--green" icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        }/>
        <StatCard value={loading ? "—" : stats.employees} label="Employees" colorClass="kr-uac-stat--purple" icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>
          </svg>
        }/>
        <StatCard value={loading ? "—" : stats.suspended} label="Suspended" colorClass="kr-uac-stat--amber" icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        }/>
        <StatCard value={loading ? "—" : stats.banned} label="Banned" colorClass="kr-uac-stat--red" icon={
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
        }/>
      </div>

      {/* ── Tab bar ── */}
      <div className="kr-uac-tab-bar">
        <button type="button" className={`kr-uac-tab${activeTab === "users" ? " active" : ""}`} onClick={() => setActiveTab("users")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          All Users
          <span className="kr-uac-tab-badge">{loading ? "…" : rows.length}</span>
        </button>
        {canManageUserAccess && (
          <button type="button" className={`kr-uac-tab${activeTab === "employees" ? " active" : ""}`} onClick={() => setActiveTab("employees")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>
            </svg>
            Employee Onboarding
            <span className="kr-uac-tab-badge">{loading ? "…" : stats.employees}</span>
          </button>
        )}
        {canManageUserAccess && (
          <button type="button" className={`kr-uac-tab${activeTab === "roles" ? " active" : ""}`} onClick={() => setActiveTab("roles")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
            </svg>
            Role Templates
            <span className="kr-uac-tab-badge">{loading ? "…" : employeeRoles.length}</span>
          </button>
        )}
      </div>

      {/* ── Users tab ── */}
      {activeTab === "users" && (
        <>
          <div className="kr-uac-toolbar">
            <div className="kr-uac-toolbar-left">
              <div className="kr-uac-search-wrap">
                <span className="kr-uac-search-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                </span>
                <input type="text" className="kr-uac-search" placeholder="Search name, email or role…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} disabled={loading}/>
                {searchQuery && (
                  <button type="button" className="kr-uac-search-clear" onClick={() => setSearchQuery("")} aria-label="Clear search">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
              </div>
              {!loading && (
                <span className="kr-uac-toolbar-count">
                  {filteredRows.length !== rows.length ? `${filteredRows.length} of ${rows.length} accounts` : `${rows.length} account${rows.length !== 1 ? "s" : ""}`}
                </span>
              )}
            </div>
            <div className="kr-uac-toolbar-right">
              {canManageUserAccess && (
                <button type="button" className="kr-uac-create-admin-btn" onClick={openCreateAdminModal} disabled={loading}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/>
                    <line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/>
                  </svg>
                  Create admin
                </button>
              )}
              <button type="button" className="kr-uac-refresh-btn" onClick={loadUsers} disabled={loading}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                Refresh
              </button>
            </div>
          </div>

          <div className="kr-uac-panel">
            {loading ? (
              <div className="kr-audit-state"><div className="kr-audit-spinner"/><p className="kr-audit-state-text">Loading user accounts…</p></div>
            ) : filteredRows.length === 0 ? (
              <div className="kr-audit-state">
                <div className="kr-audit-state-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                </div>
                <p className="kr-audit-state-text">{searchQuery ? "No accounts match your search." : "No user accounts found."}</p>
                {searchQuery && <button type="button" className="kr-audit-state-clear" onClick={() => setSearchQuery("")}>Clear search</button>}
              </div>
            ) : (
              <div className="kr-uac-table-wrap">
                <table className="kr-audit-table">
                  <thead>
                    <tr>
                      <th className="kr-audit-th">Account</th>
                      <th className="kr-audit-th">Type / Role</th>
                      <th className="kr-audit-th">Status</th>
                      <th className="kr-audit-th">Restriction</th>
                      <th className="kr-audit-th">Registered</th>
                      <th className="kr-audit-th kr-uac-th-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const status = getUserStatus(row);
                      const isCurrentAdmin = Number(row.id) === Number(currentUser?.id);
                      const isAdmin = row.accountType === "admin";
                      const initials = getInitials(row.fullName);
                      return (
                        <tr key={row.id} className={`kr-audit-row${row.isBanned ? " kr-uac-row--banned" : row.isSuspended ? " kr-uac-row--suspended" : ""}`}>
                          <td className="kr-audit-td">
                            <div className="kr-uac-user-cell">
                              <div className={`kr-uac-avatar kr-uac-avatar--${row.accountType}`}>{initials}</div>
                              <div>
                                <div className="kr-uac-user-name">{row.fullName || "—"}</div>
                                <div className="kr-uac-user-email">{row.email || "—"}</div>
                              </div>
                            </div>
                          </td>
                          <td className="kr-audit-td">
                            <div className="kr-uac-role-cell">
                              <span className={`kr-sidebar-role-badge kr-sidebar-role-${row.accountType}`}>{row.accountType}</span>
                              {row.accountType === "employee" && (
                                <select
                                  className="kr-uac-role-select"
                                  value={row.employeeRoleId || ""}
                                  onChange={(event) => handleEmployeeRoleChange(row.id, event.target.value)}
                                  disabled={!canManageUserAccess}
                                >
                                  <option value="">— no role —</option>
                                  {employeeRoles.map((role) => (
                                    <option key={role.id} value={role.id}>{role.roleName}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </td>
                          <td className="kr-audit-td">
                            <span className={status.cls}><span className={status.dotCls}/>{status.label}</span>
                          </td>
                          <td className="kr-audit-td">
                            {row.isBanned ? (
                              <div className="kr-uac-restriction-info">
                                <span className="kr-uac-restriction-label">Banned</span>
                                <span className="kr-uac-restriction-time">{formatDateTime(row.bannedAt)}</span>
                                {row.banReason && <span className="kr-uac-restriction-reason">{row.banReason.replace(/_/g, " ")}</span>}
                              </div>
                            ) : row.isSuspended ? (
                              <div className="kr-uac-restriction-info">
                                <span className="kr-uac-restriction-label">Until</span>
                                <span className="kr-uac-restriction-time">{formatDateTime(row.suspendedUntil)}</span>
                                {row.suspensionReason && <span className="kr-uac-restriction-reason">{row.suspensionReason.replace(/_/g, " ")}</span>}
                              </div>
                            ) : <span className="kr-uac-no-restriction">—</span>}
                          </td>
                          <td className="kr-audit-td">
                            <span className="kr-audit-timestamp">{formatDateTime(row.createdAt)}</span>
                          </td>
                          <td className="kr-audit-td kr-uac-actions-cell">
                            {isCurrentAdmin ? (
                              <span className="kr-uac-protected-note">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                </svg>
                                Your account
                              </span>
                            ) : isAdmin ? (
                              <span className="kr-uac-protected-note">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                </svg>
                                Admin protected
                              </span>
                            ) : (
                              <div className="kr-uac-table-actions">
                                {canManageUserAccess && (
                                  <button type="button" className="kr-uac-manage-btn" onClick={() => openModal(row)}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="12" r="3"/>
                                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                                    </svg>
                                    Manage
                                  </button>
                                )}
                                {(row.isSuspended || row.isBanned) && (
                                  <button type="button" className="kr-uac-reinstate-quick-btn" onClick={() => handleReinstate(row)}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                                    </svg>
                                    Reinstate
                                  </button>
                                )}
                                {row.accountType === "employee" && canManageUserAccess && (
                                  <button type="button" className="kr-uac-perm-btn" onClick={() => openOverrideEditor(row)}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>
                                    </svg>
                                    Permissions
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Employee Onboarding tab ── */}
      {activeTab === "employees" && canManageUserAccess && (
        <div className="kr-uac-onboarding-wrap">
          <div className="kr-uac-onboarding-card">
            <div className="kr-uac-section-head">
              <div className="kr-uac-section-icon kr-uac-section-icon--blue">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/>
                  <line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/>
                </svg>
              </div>
              <div>
                <h3 className="kr-uac-section-title">Create Employee Account</h3>
                <p className="kr-uac-section-sub">Issue a temporary password — the employee can change it after first login.</p>
              </div>
            </div>
            <form className="kr-uac-employee-fields" onSubmit={handleCreateEmployee}>
              <div className="kr-uac-field-group">
                <label className="kr-settings-field-label">Full name</label>
                <input type="text" className="kr-form-input" placeholder="e.g. Alice Kariuki" value={newEmployeeForm.fullName}
                  onChange={(e) => setNewEmployeeForm((p) => ({ ...p, fullName: e.target.value }))} required/>
              </div>
              <div className="kr-uac-field-group">
                <label className="kr-settings-field-label">Email</label>
                <input type="email" className="kr-form-input" placeholder="alice@company.com" value={newEmployeeForm.email}
                  onChange={(e) => setNewEmployeeForm((p) => ({ ...p, email: e.target.value }))} required/>
              </div>
              <div className="kr-uac-field-group">
                <label className="kr-settings-field-label">Temporary password</label>
                <input type="password" className="kr-form-input" placeholder="Min. 6 characters" minLength={6} value={newEmployeeForm.temporaryPassword}
                  onChange={(e) => setNewEmployeeForm((p) => ({ ...p, temporaryPassword: e.target.value }))} required/>
              </div>
              <div className="kr-uac-field-group">
                <label className="kr-settings-field-label">Role template <span className="kr-uac-optional-tag">optional</span></label>
                <select className="kr-form-input" value={newEmployeeForm.employeeRoleId}
                  onChange={(e) => setNewEmployeeForm((p) => ({ ...p, employeeRoleId: e.target.value }))}>
                  <option value="">No role assigned</option>
                  {employeeRoles.map((role) => <option key={role.id} value={role.id}>{role.roleName}</option>)}
                </select>
              </div>
              <div className="kr-uac-field-group kr-uac-field-group--submit">
                <button type="submit" className="kr-uac-create-admin-btn kr-uac-create-admin-btn--full" disabled={isCreatingEmployee}>
                  {isCreatingEmployee ? (
                    <><span className="kr-uac-spinner-inline"/> Creating…</>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                      Create employee
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Role Templates tab ── */}
      {activeTab === "roles" && canManageUserAccess && (
        <div className="kr-uac-onboarding-wrap">
          <div className="kr-uac-onboarding-card">
            <div className="kr-uac-section-head">
              <div className="kr-uac-section-icon kr-uac-section-icon--purple">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
                </svg>
              </div>
              <div>
                <h3 className="kr-uac-section-title">New Role Template</h3>
                <p className="kr-uac-section-sub">Define baseline permission sets that can be assigned to employees.</p>
              </div>
            </div>
            <form className="kr-uac-employee-fields kr-uac-employee-fields--row" onSubmit={handleCreateRole}>
              <div className="kr-uac-field-group kr-uac-field-group--flex">
                <label className="kr-settings-field-label">Role name</label>
                <input type="text" className="kr-form-input" placeholder="e.g. Support Agent" value={newRoleForm.roleName}
                  onChange={(e) => setNewRoleForm((p) => ({ ...p, roleName: e.target.value }))} required/>
              </div>
              <div className="kr-uac-field-group kr-uac-field-group--flex">
                <label className="kr-settings-field-label">Description <span className="kr-uac-optional-tag">optional</span></label>
                <input type="text" className="kr-form-input" placeholder="Short description" value={newRoleForm.roleDescription}
                  onChange={(e) => setNewRoleForm((p) => ({ ...p, roleDescription: e.target.value }))}/>
              </div>
              <div className="kr-uac-field-group kr-uac-field-group--submit">
                <button type="submit" className="kr-uac-create-admin-btn" disabled={isSavingRole}>
                  {isSavingRole ? "Saving…" : "Add role"}
                </button>
              </div>
            </form>
          </div>

          {employeeRoles.length > 0 ? (
            <div className="kr-uac-roles-grid">
              {employeeRoles.map((role) => (
                <div key={role.id} className={`kr-uac-role-card${role.isActive ? "" : " kr-uac-role-card--inactive"}`}>
                  <div className="kr-uac-role-card-head">
                    <div className="kr-uac-role-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/>
                      </svg>
                    </div>
                    <div className="kr-uac-role-card-info">
                      <p className="kr-uac-role-name">{role.roleName}</p>
                      <p className="kr-uac-role-desc">{role.roleDescription || "No description"}</p>
                    </div>
                    <span className={`kr-uac-role-status${role.isActive ? " kr-uac-role-status--active" : " kr-uac-role-status--inactive"}`}>
                      {role.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="kr-uac-role-card-footer">
                    <span className="kr-uac-role-count">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                      </svg>
                      {role.employeeCount || 0} employee{(role.employeeCount || 0) !== 1 ? "s" : ""}
                    </span>
                    <div className="kr-uac-role-actions">
                      <button type="button" className="kr-uac-role-action-btn" onClick={() => handleToggleRoleActive(role)} disabled={isSavingRole}>
                        {role.isActive ? "Disable" : "Enable"}
                      </button>
                      <button type="button" className="kr-uac-role-action-btn kr-uac-role-action-btn--danger" onClick={() => handleDeleteRole(role)} disabled={isSavingRole}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                        </svg>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="kr-audit-state">
              <div className="kr-audit-state-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/>
                </svg>
              </div>
              <p className="kr-audit-state-text">No role templates yet. Create one above.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Create admin modal ── */}
      {isCreateAdminOpen && (
        <div className="kr-portal-filter-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeCreateAdminModal(); }}>
          <div className="kr-portal-filter-modal kr-uac-modal" role="dialog" aria-modal="true" aria-label="Create admin account">
            <div className="kr-portal-filter-modal-head">
              <div className="kr-portal-filter-modal-head-left">
                <h3 className="kr-portal-filter-modal-title">Create admin account</h3>
                <p className="kr-portal-filter-modal-subtitle">Only existing admins can create another admin.</p>
              </div>
              <button type="button" className="kr-portal-filter-modal-close" onClick={closeCreateAdminModal} disabled={isCreatingAdmin} aria-label="Close"><CloseIcon/></button>
            </div>
            <form className="kr-uac-create-admin-form" onSubmit={handleCreateAdmin}>
              <div className="kr-uac-modal-field">
                <label className="kr-settings-field-label" htmlFor="newAdminFullName">Full name</label>
                <input id="newAdminFullName" type="text" className="kr-form-input" value={newAdminForm.fullName} onChange={(e) => setNewAdminForm((p) => ({ ...p, fullName: e.target.value }))} placeholder="e.g. Jane Admin" disabled={isCreatingAdmin} required/>
              </div>
              <div className="kr-uac-modal-field">
                <label className="kr-settings-field-label" htmlFor="newAdminEmail">Email</label>
                <input id="newAdminEmail" type="email" className="kr-form-input" value={newAdminForm.email} onChange={(e) => setNewAdminForm((p) => ({ ...p, email: e.target.value }))} placeholder="admin@example.com" disabled={isCreatingAdmin} required/>
              </div>
              <div className="kr-uac-modal-field">
                <label className="kr-settings-field-label" htmlFor="newAdminPassword">Password</label>
                <input id="newAdminPassword" type="password" className="kr-form-input" value={newAdminForm.password} onChange={(e) => setNewAdminForm((p) => ({ ...p, password: e.target.value }))} placeholder="Minimum 6 characters" minLength={6} disabled={isCreatingAdmin} required/>
              </div>
              <div className="kr-uac-modal-footer">
                <button type="button" className="kr-portal-filter-reset" onClick={closeCreateAdminModal} disabled={isCreatingAdmin}>Cancel</button>
                <button type="submit" className="kr-uac-btn kr-uac-btn--reinstate" disabled={isCreatingAdmin}>{isCreatingAdmin ? "Creating..." : "Create admin"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Manage user modal ── */}
      {modalUser && (
        <div className="kr-portal-filter-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="kr-portal-filter-modal kr-uac-modal" role="dialog" aria-modal="true" aria-label={`Manage ${modalUser.fullName}`}>
            <div className="kr-portal-filter-modal-head">
              <div className="kr-portal-filter-modal-head-left">
                <div className={`kr-uac-avatar kr-uac-avatar--${modalUser.accountType} kr-uac-modal-avatar`}>{getInitials(modalUser.fullName)}</div>
                <div>
                  <h3 className="kr-portal-filter-modal-title">{modalUser.fullName}</h3>
                  <p className="kr-portal-filter-modal-subtitle">
                    {modalUser.email}
                    <span className={`${modalStatus.cls} kr-uac-modal-status-badge`}><span className={modalStatus.dotCls}/>{modalStatus.label}</span>
                  </p>
                </div>
              </div>
              <button type="button" className="kr-portal-filter-modal-close" onClick={closeModal} disabled={isSubmitting} aria-label="Close"><CloseIcon/></button>
            </div>
            <div className="kr-uac-modal-body">
              {(modalUser.isBanned || modalUser.isSuspended) && (
                <div className={`kr-uac-modal-callout${modalUser.isBanned ? " kr-uac-modal-callout--banned" : " kr-uac-modal-callout--suspended"}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <div>
                    {modalUser.isBanned
                      ? <>Account permanently banned {modalUser.bannedAt ? `on ${formatDateTime(modalUser.bannedAt)}` : ""}.</>
                      : <>Account suspended until <strong>{formatDateTime(modalUser.suspendedUntil)}</strong>.</>}
                  </div>
                </div>
              )}
              {(modalUser.isBanned || modalUser.isSuspended) && (
                <div className="kr-uac-modal-section">
                  <div className="kr-uac-modal-section-head">
                    <span className="kr-uac-modal-section-icon kr-uac-modal-section-icon--green">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                      </svg>
                    </span>
                    <div><p className="kr-uac-modal-section-title">Reinstate account</p><p className="kr-uac-modal-section-sub">Remove all restrictions and restore full access.</p></div>
                  </div>
                  <button type="button" className="kr-uac-btn kr-uac-btn--reinstate kr-uac-modal-action-btn" onClick={() => handleReinstate(modalUser)} disabled={isSubmitting}>{isSubmitting ? "Working…" : "Reinstate access"}</button>
                </div>
              )}
              <div className="kr-uac-modal-section">
                <div className="kr-uac-modal-section-head">
                  <span className="kr-uac-modal-section-icon kr-uac-modal-section-icon--amber">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                    </svg>
                  </span>
                  <div><p className="kr-uac-modal-section-title">Suspend access</p><p className="kr-uac-modal-section-sub">Temporarily block the user for a fixed period.</p></div>
                </div>
                <div className="kr-uac-modal-field-row">
                  <div className="kr-uac-modal-field">
                    <label className="kr-settings-field-label" htmlFor="suspendDuration">Duration</label>
                    <select id="suspendDuration" className="kr-form-input kr-form-select" value={suspendHours} onChange={(e) => setSuspendHours(Number(e.target.value))} disabled={isSubmitting}>
                      {SUSPENSION_OPTIONS.map((opt) => <option key={opt.hours} value={opt.hours}>{opt.label}</option>)}
                    </select>
                  </div>
                  <div className="kr-uac-modal-field kr-uac-modal-field--grow">
                    <label className="kr-settings-field-label" htmlFor="suspendReason">Reason (optional)</label>
                    <input id="suspendReason" type="text" className="kr-form-input" placeholder="e.g. Suspicious activity" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} disabled={isSubmitting}/>
                  </div>
                </div>
                <button type="button" className="kr-uac-btn kr-uac-btn--suspend kr-uac-modal-action-btn" onClick={handleSuspend} disabled={isSubmitting}>
                  {isSubmitting ? "Working…" : `Suspend for ${SUSPENSION_OPTIONS.find((o) => o.hours === suspendHours)?.label || suspendHours + "h"}`}
                </button>
              </div>
              {!modalUser.isBanned && (
                <div className="kr-uac-modal-section kr-uac-modal-section--danger">
                  <div className="kr-uac-modal-section-head">
                    <span className="kr-uac-modal-section-icon kr-uac-modal-section-icon--red">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                      </svg>
                    </span>
                    <div><p className="kr-uac-modal-section-title">Ban permanently</p><p className="kr-uac-modal-section-sub">Permanently block all account access. Can be undone by an admin.</p></div>
                  </div>
                  <div className="kr-uac-modal-field" style={{ marginBottom: "0.65rem" }}>
                    <label className="kr-settings-field-label" htmlFor="banReason">Reason (optional)</label>
                    <input id="banReason" type="text" className="kr-form-input" placeholder="e.g. Fraudulent listing reported" value={banReason} onChange={(e) => setBanReason(e.target.value)} disabled={isSubmitting}/>
                  </div>
                  <button type="button" className="kr-uac-btn kr-uac-btn--ban kr-uac-modal-action-btn" onClick={handleBan} disabled={isSubmitting}>{isSubmitting ? "Working…" : "Ban permanently"}</button>
                </div>
              )}
            </div>
            <div className="kr-uac-modal-footer">
              <button type="button" className="kr-portal-filter-reset" onClick={closeModal} disabled={isSubmitting}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Module override editor modal ── */}
      {overrideEditorUser && (
        <div className="kr-portal-filter-modal-overlay" onClick={(event) => { if (event.target === event.currentTarget && !isSavingOverrides) setOverrideEditorUser(null); }}>
          <div className="kr-portal-filter-modal kr-uac-modal kr-uac-override-modal" role="dialog" aria-modal="true" aria-label="Edit employee module overrides">
            <div className="kr-portal-filter-modal-head">
              <div className="kr-portal-filter-modal-head-left">
                <div className="kr-uac-avatar kr-uac-avatar--employee">{getInitials(overrideEditorUser.fullName)}</div>
                <div>
                  <h3 className="kr-portal-filter-modal-title">Module Permissions</h3>
                  <p className="kr-portal-filter-modal-subtitle">{overrideEditorUser.fullName} · {overrideEditorUser.email}</p>
                </div>
              </div>
              <button type="button" className="kr-portal-filter-modal-close" onClick={() => setOverrideEditorUser(null)} disabled={isSavingOverrides} aria-label="Close"><CloseIcon/></button>
            </div>

            {overrideLoading ? (
              <div className="kr-uac-override-loading">
                <div className="kr-audit-spinner"/>
                <span>Loading current overrides…</span>
              </div>
            ) : (
              <div className="kr-uac-override-matrix">
                {accessModules.map((module) => {
                  const moduleIcon = MODULE_ICONS[module.key] || null;
                  const moduleView = getOverrideChecked(module.key, "*", "canView");
                  const moduleManage = getOverrideChecked(module.key, "*", "canManage");
                  return (
                    <div key={module.key} className="kr-uac-override-row">
                      <div className="kr-uac-override-row-head">
                        <div className="kr-uac-override-module-label">
                          {moduleIcon && <span className="kr-uac-override-module-icon">{moduleIcon}</span>}
                          <span>{module.label}</span>
                        </div>
                        <div className="kr-uac-override-row-toggles">
                          <PermissionToggle
                            checked={moduleView}
                            onChange={() => updateOverrideChecked(module.key, "*", "canView", !moduleView)}
                            label="View"
                          />
                          <PermissionToggle
                            checked={moduleManage}
                            onChange={() => updateOverrideChecked(module.key, "*", "canManage", !moduleManage)}
                            label="Manage"
                          />
                        </div>
                      </div>
                      {Array.isArray(module.submodules) && module.submodules.length > 0 && (
                        <div className="kr-uac-override-subrows">
                          {module.submodules.map((submodule) => {
                            const subView = getOverrideChecked(module.key, submodule.key, "canView");
                            const subManage = getOverrideChecked(module.key, submodule.key, "canManage");
                            return (
                              <div key={submodule.key} className="kr-uac-override-subrow">
                                <span className="kr-uac-override-subrow-label">{submodule.label}</span>
                                <div className="kr-uac-override-row-toggles">
                                  <PermissionToggle checked={subView} onChange={() => updateOverrideChecked(module.key, submodule.key, "canView", !subView)} label="View"/>
                                  <PermissionToggle checked={subManage} onChange={() => updateOverrideChecked(module.key, submodule.key, "canManage", !subManage)} label="Manage"/>
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
            )}

            <div className="kr-uac-modal-footer">
              <button type="button" className="kr-portal-filter-reset" onClick={() => setOverrideEditorUser(null)} disabled={isSavingOverrides}>Cancel</button>
              <button type="button" className="kr-uac-btn kr-uac-btn--reinstate" onClick={handleSaveOverrides} disabled={isSavingOverrides || overrideLoading}>
                {isSavingOverrides ? (
                  <><span className="kr-uac-spinner-inline"/> Saving…</>
                ) : "Save overrides"}
              </button>
            </div>
          </div>
        </div>
      )}

    </PortalLayout>
  );
}

export default AdminUserAccessPage;
