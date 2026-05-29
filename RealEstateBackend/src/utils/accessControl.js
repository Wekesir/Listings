const ACCESS_ACTIONS = Object.freeze({
  VIEW: "view",
  MANAGE: "manage"
});

const MODULE_KEYS = Object.freeze({
  USER_ACCESS: "user_access",
  AUDIT_LOGS: "audit_logs",
  LISTING_REPORTS: "listing_reports",
  ADMIN_MESSAGES: "admin_messages",
  ADMIN_FINANCES: "admin_finances",
  PRICING: "pricing",
  SYSTEM_SETTINGS: "system_settings",
  PROPERTY_MODERATION: "property_moderation"
});

const MODULE_REGISTRY = Object.freeze([
  {
    key: MODULE_KEYS.USER_ACCESS,
    label: "User Access",
    submodules: [
      { key: "users", label: "Users" },
      { key: "roles", label: "Roles" },
      { key: "overrides", label: "Overrides" }
    ]
  },
  {
    key: MODULE_KEYS.AUDIT_LOGS,
    label: "Audit Logs",
    submodules: [
      { key: "view", label: "View Logs" },
      { key: "delete", label: "Delete Logs" }
    ]
  },
  {
    key: MODULE_KEYS.LISTING_REPORTS,
    label: "Listing Reports",
    submodules: [
      { key: "review", label: "Review Reports" },
      { key: "resolve", label: "Resolve Reports" }
    ]
  },
  {
    key: MODULE_KEYS.ADMIN_MESSAGES,
    label: "Conversation Oversight",
    submodules: [
      { key: "conversations", label: "View Conversations" }
    ]
  },
  {
    key: MODULE_KEYS.ADMIN_FINANCES,
    label: "Finances",
    submodules: [
      { key: "summary", label: "Finance Summary" },
      { key: "payments", label: "Payments" },
      { key: "export", label: "Export CSV/PDF" }
    ]
  },
  {
    key: MODULE_KEYS.PRICING,
    label: "Pricing",
    submodules: [
      { key: "view", label: "View Pricing Rules" },
      { key: "manage", label: "Manage Pricing Rules" }
    ]
  },
  {
    key: MODULE_KEYS.SYSTEM_SETTINGS,
    label: "System Settings",
    submodules: [
      { key: "email_delivery", label: "Email Delivery" }
    ]
  },
  {
    key: MODULE_KEYS.PROPERTY_MODERATION,
    label: "Property Moderation",
    submodules: [
      { key: "soft_delete", label: "Soft Delete Listing" },
      { key: "restore", label: "Restore Listing" }
    ]
  }
]);

function normalizeAccessAction(rawAction) {
  return String(rawAction || ACCESS_ACTIONS.VIEW).trim().toLowerCase() === ACCESS_ACTIONS.MANAGE
    ? ACCESS_ACTIONS.MANAGE
    : ACCESS_ACTIONS.VIEW;
}

function normalizeAccessEntry(rawEntry = {}) {
  const moduleKey = String(rawEntry.moduleKey || rawEntry.module_key || "")
    .trim()
    .toLowerCase();
  const submoduleKey = String(rawEntry.submoduleKey || rawEntry.submodule_key || "*")
    .trim()
    .toLowerCase() || "*";
  const canView = Boolean(rawEntry.canView ?? rawEntry.can_view);
  const canManage = Boolean(rawEntry.canManage ?? rawEntry.can_manage);
  return {
    moduleKey,
    submoduleKey,
    canView: canView || canManage,
    canManage
  };
}

function normalizePermissionMap(permissionMap) {
  if (!permissionMap || typeof permissionMap !== "object") return {};
  const normalized = {};
  Object.entries(permissionMap).forEach(([moduleKey, moduleValue]) => {
    const normalizedModuleKey = String(moduleKey || "").trim().toLowerCase();
    if (!normalizedModuleKey || !moduleValue || typeof moduleValue !== "object") return;
    const moduleView = Boolean(moduleValue.view);
    const moduleManage = Boolean(moduleValue.manage);
    const submodules = {};
    if (moduleValue.submodules && typeof moduleValue.submodules === "object") {
      Object.entries(moduleValue.submodules).forEach(([submoduleKey, submoduleValue]) => {
        const normalizedSubmoduleKey = String(submoduleKey || "").trim().toLowerCase();
        if (!normalizedSubmoduleKey || !submoduleValue || typeof submoduleValue !== "object") return;
        const subView = Boolean(submoduleValue.view);
        const subManage = Boolean(submoduleValue.manage);
        submodules[normalizedSubmoduleKey] = {
          view: subView || subManage,
          manage: subManage
        };
      });
    }
    normalized[normalizedModuleKey] = {
      view: moduleView || moduleManage,
      manage: moduleManage,
      submodules
    };
  });
  return normalized;
}

function applyAccessEntriesToMap(baseMap, entries) {
  const map = normalizePermissionMap(baseMap);
  const normalizedEntries = Array.isArray(entries) ? entries.map(normalizeAccessEntry) : [];
  normalizedEntries.forEach((entry) => {
    if (!entry.moduleKey) return;
    if (!map[entry.moduleKey]) {
      map[entry.moduleKey] = { view: false, manage: false, submodules: {} };
    }
    const moduleRef = map[entry.moduleKey];
    if (entry.submoduleKey === "*" || !entry.submoduleKey) {
      moduleRef.view = entry.canView;
      moduleRef.manage = entry.canManage;
      return;
    }
    moduleRef.submodules[entry.submoduleKey] = {
      view: entry.canView,
      manage: entry.canManage
    };
    const submoduleValues = Object.values(moduleRef.submodules);
    moduleRef.view = moduleRef.view || submoduleValues.some((item) => Boolean(item.view));
    moduleRef.manage = moduleRef.manage || submoduleValues.some((item) => Boolean(item.manage));
  });
  return map;
}

function hasModulePermission(user, moduleKey, action = ACCESS_ACTIONS.VIEW, submoduleKey = "*") {
  if (!user) return false;
  const accountType = String(user.accountType || user.account_type || "").trim().toLowerCase();
  if (accountType === "admin") return true;
  if (accountType !== "employee") return false;

  const normalizedModuleKey = String(moduleKey || "").trim().toLowerCase();
  if (!normalizedModuleKey) return false;
  const normalizedSubmoduleKey = String(submoduleKey || "*").trim().toLowerCase() || "*";
  const normalizedAction = normalizeAccessAction(action);
  const permissionMap = normalizePermissionMap(user.permissions || user.permissionMap);
  const modulePermission = permissionMap[normalizedModuleKey];
  if (!modulePermission) return false;

  if (normalizedSubmoduleKey !== "*") {
    const scopedPermission = modulePermission.submodules?.[normalizedSubmoduleKey];
    if (scopedPermission) {
      return normalizedAction === ACCESS_ACTIONS.MANAGE
        ? Boolean(scopedPermission.manage)
        : Boolean(scopedPermission.view || scopedPermission.manage);
    }
  }

  return normalizedAction === ACCESS_ACTIONS.MANAGE
    ? Boolean(modulePermission.manage)
    : Boolean(modulePermission.view || modulePermission.manage);
}

module.exports = {
  ACCESS_ACTIONS,
  MODULE_KEYS,
  MODULE_REGISTRY,
  normalizeAccessAction,
  normalizeAccessEntry,
  normalizePermissionMap,
  applyAccessEntriesToMap,
  hasModulePermission
};
