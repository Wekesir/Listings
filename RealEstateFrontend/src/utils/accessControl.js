export const ACCESS_ACTIONS = Object.freeze({
  VIEW: "view",
  MANAGE: "manage"
});

export const MODULE_KEYS = Object.freeze({
  USER_ACCESS: "user_access",
  AUDIT_LOGS: "audit_logs",
  LISTING_REPORTS: "listing_reports",
  ADMIN_MESSAGES: "admin_messages",
  ADMIN_FINANCES: "admin_finances",
  PRICING: "pricing",
  SYSTEM_SETTINGS: "system_settings",
  PROPERTY_MODERATION: "property_moderation"
});

const ADMIN_ONLY_MODULES = new Set([MODULE_KEYS.PROPERTY_MODERATION]);

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

export function isAdminOnlyArea(moduleKey) {
  const normalizedModuleKey = String(moduleKey || "").trim().toLowerCase();
  return ADMIN_ONLY_MODULES.has(normalizedModuleKey);
}

export function canAccessModule(user, moduleKey, action = ACCESS_ACTIONS.VIEW, submoduleKey = "*") {
  if (!user) return false;
  const accountType = String(user.accountType || "").trim().toLowerCase();
  if (accountType === "admin") return true;
  if (accountType !== "employee") return false;
  if (isAdminOnlyArea(moduleKey)) return false;

  const normalizedModuleKey = String(moduleKey || "").trim().toLowerCase();
  const normalizedSubmoduleKey = String(submoduleKey || "*").trim().toLowerCase() || "*";
  const normalizedAction = String(action || ACCESS_ACTIONS.VIEW).trim().toLowerCase() === ACCESS_ACTIONS.MANAGE
    ? ACCESS_ACTIONS.MANAGE
    : ACCESS_ACTIONS.VIEW;
  const permissionMap = normalizePermissionMap(user.permissions);
  const modulePermissions = permissionMap[normalizedModuleKey];
  if (!modulePermissions) return false;

  if (normalizedSubmoduleKey !== "*") {
    const submodulePermissions = modulePermissions.submodules?.[normalizedSubmoduleKey];
    if (submodulePermissions) {
      return normalizedAction === ACCESS_ACTIONS.MANAGE
        ? Boolean(submodulePermissions.manage)
        : Boolean(submodulePermissions.view || submodulePermissions.manage);
    }
  }

  return normalizedAction === ACCESS_ACTIONS.MANAGE
    ? Boolean(modulePermissions.manage)
    : Boolean(modulePermissions.view || modulePermissions.manage);
}
