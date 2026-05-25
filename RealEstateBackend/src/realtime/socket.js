const { Server } = require("socket.io");
const { ACCESS_ACTIONS, MODULE_KEYS, hasModulePermission } = require("../utils/accessControl");

let ioInstance = null;

function userRoom(userId) {
  return `user:${Number(userId)}`;
}

function initRealtime(httpServer, sessionMiddleware) {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true
    }
  });

  ioInstance.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
  });

  ioInstance.use((socket, next) => {
    const sessionUser = socket.request?.session?.user;
    const userId = Number(sessionUser?.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return next(new Error("Unauthorized socket session"));
    }
    socket.user = sessionUser;
    return next();
  });

  ioInstance.on("connection", (socket) => {
    const sessionUser = socket.user || socket.request?.session?.user;
    const userId = Number(sessionUser?.id);
    const accountType = String(sessionUser?.accountType || "").toLowerCase();
    const canMonitorAllConversations = hasModulePermission(
      sessionUser,
      MODULE_KEYS.ADMIN_MESSAGES,
      ACCESS_ACTIONS.VIEW
    );

    socket.join(userRoom(userId));
    if (canMonitorAllConversations) {
      socket.join("admins");
    }

    socket.emit("realtime:connected", {
      userId,
      accountType
    });
  });

  return ioInstance;
}

function emitConversationUpdated(userIds, payload) {
  if (!ioInstance) return;
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  ids
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .forEach((id) => {
      ioInstance.to(userRoom(id)).emit("messages:conversation-updated", payload);
    });
  ioInstance.to("admins").emit("admin:conversation-updated", payload);
}

function emitNewMessage(userIds, payload) {
  if (!ioInstance) return;
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  ids
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .forEach((id) => {
      ioInstance.to(userRoom(id)).emit("messages:new-message", payload);
    });
  ioInstance.to("admins").emit("admin:new-message", payload);
}

function emitListingMetricsUpdated(userId, payload) {
  if (!ioInstance) return;
  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId) || numericUserId <= 0) return;
  ioInstance.to(userRoom(numericUserId)).emit("listings:metrics-updated", payload || {});
}

module.exports = {
  initRealtime,
  emitConversationUpdated,
  emitNewMessage,
  emitListingMetricsUpdated
};
