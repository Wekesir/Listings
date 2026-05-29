const { ACCESS_ACTIONS, hasModulePermission } = require("../utils/accessControl");

function ensureAuthenticated(req, res) {
  const sessionUser = req.session?.user;
  if (!sessionUser) {
    res.status(401).json({
      message: "Session expired. Please log in again."
    });
    return null;
  }
  return sessionUser;
}

function requireAdmin(req, res, next) {
  const sessionUser = ensureAuthenticated(req, res);
  if (!sessionUser) return;
  if (String(sessionUser.accountType || "").trim().toLowerCase() !== "admin") {
    return res.status(403).json({
      message: "Only admin accounts can perform this action."
    });
  }
  return next();
}

function requireModulePermission(moduleKey, action = ACCESS_ACTIONS.VIEW, submoduleKey = "*") {
  return (req, res, next) => {
    const sessionUser = ensureAuthenticated(req, res);
    if (!sessionUser) return;
    if (!hasModulePermission(sessionUser, moduleKey, action, submoduleKey)) {
      return res.status(403).json({
        message: "You do not have permission to access this module."
      });
    }
    return next();
  };
}

module.exports = {
  ensureAuthenticated,
  requireAdmin,
  requireModulePermission
};
