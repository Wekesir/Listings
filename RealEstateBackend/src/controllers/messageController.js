const properties = require("../data/properties");
const { pool } = require("../config/db");
const { emitConversationUpdated, emitNewMessage, emitListingMetricsUpdated } = require("../realtime/socket");
const { sendNewMessageNotificationEmail } = require("../services/auth/emailService");
const { createUnreadEmailScheduler } = require("../utils/unreadEmailScheduler");
const { ACCESS_ACTIONS, MODULE_KEYS, hasModulePermission } = require("../utils/accessControl");

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;
const MIN_MESSAGE_LENGTH = 2;
const MAX_MESSAGE_LENGTH = 5000;
const UNREAD_EMAIL_DELAY_MS = Math.max(15000, Number(process.env.UNREAD_MESSAGE_EMAIL_DELAY_MS || 90000));
const APP_FRONTEND_URL = String(process.env.APP_FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");

function getSessionUser(req) {
  return req.session?.user || null;
}

function parsePositiveInt(rawValue, fallback) {
  const value = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function normalizeMessage(rawValue) {
  return String(rawValue || "").trim();
}

function emitListerMetricsUpdate(listerUserId, propertyId, source) {
  const numericListerId = Number(listerUserId);
  const numericPropertyId = Number(propertyId);
  if (!Number.isFinite(numericListerId) || numericListerId <= 0) return;
  if (!Number.isFinite(numericPropertyId) || numericPropertyId <= 0) return;
  emitListingMetricsUpdated(numericListerId, {
    listerUserId: numericListerId,
    propertyId: numericPropertyId,
    source: String(source || "unknown"),
    occurredAt: new Date().toISOString()
  });
}

function resolveRecipientUserId(conversation, senderUserId) {
  const viewerUserId = Number(conversation?.viewerUserId);
  const listerUserId = Number(conversation?.listerUserId);
  const senderId = Number(senderUserId);
  if (senderId === viewerUserId) return listerUserId;
  if (senderId === listerUserId) return viewerUserId;
  return null;
}

function buildUnreadEmailTimerKey(conversationId, recipientUserId) {
  const numericConversationId = Number(conversationId);
  const numericRecipientId = Number(recipientUserId);
  if (!Number.isFinite(numericConversationId) || numericConversationId <= 0) return null;
  if (!Number.isFinite(numericRecipientId) || numericRecipientId <= 0) return null;
  return `${numericConversationId}:${numericRecipientId}`;
}

async function sendUnreadMessageEmailIfStillUnread({
  conversationId,
  recipientUserId,
  senderUserId
}) {
  const numericConversationId = Number(conversationId);
  const numericRecipientId = Number(recipientUserId);
  const numericSenderId = Number(senderUserId);
  if (!Number.isFinite(numericConversationId) || numericConversationId <= 0) return;
  if (!Number.isFinite(numericRecipientId) || numericRecipientId <= 0) return;
  if (!Number.isFinite(numericSenderId) || numericSenderId <= 0) return;

  try {
    const [conversationRows] = await pool.execute(
      `
        SELECT
          c.id,
          c.property_id AS propertyId,
          c.viewer_user_id AS viewerUserId,
          c.lister_user_id AS listerUserId,
          recipient.email AS recipientEmail,
          recipient.full_name AS recipientName,
          recipient.email_verified AS recipientEmailVerified,
          sender.full_name AS senderName
        FROM listing_conversations c
        INNER JOIN users recipient ON recipient.id = ?
        INNER JOIN users sender ON sender.id = ?
        WHERE c.id = ?
          AND (c.viewer_user_id = ? OR c.lister_user_id = ?)
        LIMIT 1
      `,
      [numericRecipientId, numericSenderId, numericConversationId, numericRecipientId, numericRecipientId]
    );
    const conversation = conversationRows[0];
    if (!conversation) return;
    if (!conversation.recipientEmail || !Boolean(conversation.recipientEmailVerified)) return;

    const [unreadRows] = await pool.execute(
      `
        SELECT COUNT(*) AS unreadCount
        FROM listing_messages
        WHERE conversation_id = ?
          AND sender_user_id <> ?
          AND read_at IS NULL
      `,
      [numericConversationId, numericRecipientId]
    );
    const unreadCount = Number(unreadRows?.[0]?.unreadCount || 0);
    if (unreadCount <= 0) return;

    const [previewRows] = await pool.execute(
      `
        SELECT message_text AS messageText
        FROM listing_messages
        WHERE conversation_id = ?
          AND sender_user_id <> ?
          AND read_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      [numericConversationId, numericRecipientId]
    );
    const messagePreview = String(previewRows?.[0]?.messageText || "").trim().slice(0, 280);

    const listing = properties.find((item) => Number(item.id) === Number(conversation.propertyId));
    await sendNewMessageNotificationEmail({
      toEmail: conversation.recipientEmail,
      recipientName: conversation.recipientName,
      senderName: conversation.senderName,
      listingTitle: listing?.title || `Listing #${conversation.propertyId}`,
      listingLocation: listing?.location || "",
      unreadCount,
      messagePreview,
      conversationUrl: `${APP_FRONTEND_URL}/messages?conversation=${numericConversationId}`
    });
  } catch (error) {
    console.error("message-unread-email-failed:", error.message);
  }
}

const unreadEmailScheduler = createUnreadEmailScheduler({
  delayMs: UNREAD_EMAIL_DELAY_MS,
  handler: (payload) => sendUnreadMessageEmailIfStillUnread(payload)
});

function scheduleUnreadMessageEmailNotification({
  conversationId,
  recipientUserId,
  senderUserId
}) {
  const numericConversationId = Number(conversationId);
  const numericRecipientId = Number(recipientUserId);
  const numericSenderId = Number(senderUserId);
  if (!Number.isFinite(numericConversationId) || numericConversationId <= 0) return;
  if (!Number.isFinite(numericRecipientId) || numericRecipientId <= 0) return;
  if (!Number.isFinite(numericSenderId) || numericSenderId <= 0) return;

  const timerKey = buildUnreadEmailTimerKey(numericConversationId, numericRecipientId);
  if (!timerKey) return;
  unreadEmailScheduler.schedule(timerKey, {
    conversationId: numericConversationId,
    recipientUserId: numericRecipientId,
    senderUserId: numericSenderId
  });
}

function isSoftDeletedListing(property) {
  return Boolean(property?.isSoftDeleted);
}

function mapConversationRowToResponse(row, currentUserId) {
  const viewerId = Number(row.viewerUserId);
  const listerId = Number(row.listerUserId);
  const currentId = Number(currentUserId);
  const currentIsViewer = currentId === viewerId;
  const otherUser = currentIsViewer
    ? {
        id: listerId,
        fullName: row.listerFullName,
        email: row.listerEmail,
        accountType: "lister"
      }
    : {
        id: viewerId,
        fullName: row.viewerFullName,
        email: row.viewerEmail,
        accountType: "viewer"
      };

  const listing = properties.find((item) => Number(item.id) === Number(row.propertyId));
  return {
    id: Number(row.id),
    propertyId: Number(row.propertyId),
    listing: listing
      ? {
          id: Number(listing.id),
          title: listing.title,
          location: listing.location,
          imageUrl: listing.imageUrl || "",
          isSoftDeleted: Boolean(listing.isSoftDeleted)
        }
      : {
          id: Number(row.propertyId),
          title: "Listing unavailable",
          location: "",
          imageUrl: "",
          isSoftDeleted: true
        },
    viewerUserId: viewerId,
    listerUserId: listerId,
    otherUser,
    lastMessagePreview: row.lastMessagePreview || "",
    lastMessageAt: row.lastMessageAt,
    lastMessageSenderId: row.lastMessageSenderId ? Number(row.lastMessageSenderId) : null,
    unreadCount: Number(row.unreadCount || 0),
    createdAt: row.createdAt
  };
}

async function getConversationForAccess(conversationId) {
  const [rows] = await pool.execute(
    `
      SELECT
        c.id,
        c.property_id AS propertyId,
        c.viewer_user_id AS viewerUserId,
        c.lister_user_id AS listerUserId,
        c.last_message_sender_id AS lastMessageSenderId,
        c.last_message_preview AS lastMessagePreview,
        c.created_at AS createdAt,
        c.last_message_at AS lastMessageAt,
        viewer.full_name AS viewerFullName,
        viewer.email AS viewerEmail,
        lister.full_name AS listerFullName,
        lister.email AS listerEmail
      FROM listing_conversations c
      INNER JOIN users viewer ON viewer.id = c.viewer_user_id
      INNER JOIN users lister ON lister.id = c.lister_user_id
      WHERE c.id = ?
      LIMIT 1
    `,
    [Number(conversationId)]
  );
  return rows[0] || null;
}

async function createListingInquiryConversation(req, res) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({
      message: "Please create an account or log in to send an inquiry."
    });
  }

  const propertyId = Number(req.params.propertyId);
  if (!Number.isFinite(propertyId) || propertyId <= 0) {
    return res.status(400).json({ message: "Invalid property id." });
  }

  const listing = properties.find((item) => Number(item.id) === propertyId);
  if (!listing || isSoftDeletedListing(listing)) {
    return res.status(404).json({ message: "Listing not found." });
  }

  const listerUserId = Number(listing.ownerId);
  const viewerUserId = Number(sessionUser.id);
  if (!Number.isFinite(listerUserId) || listerUserId <= 0) {
    return res.status(400).json({ message: "This listing cannot receive inquiries yet." });
  }
  if (!Number.isFinite(viewerUserId) || viewerUserId <= 0) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (viewerUserId === listerUserId) {
    return res.status(400).json({ message: "You cannot inquire about your own listing." });
  }

  const messageText = normalizeMessage(req.body?.message);
  if (messageText.length < MIN_MESSAGE_LENGTH) {
    return res.status(400).json({
      message: `Message must be at least ${MIN_MESSAGE_LENGTH} characters.`
    });
  }
  if (messageText.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      message: `Message must be at most ${MAX_MESSAGE_LENGTH} characters.`
    });
  }

  const [listerRows] = await pool.execute(
    `
      SELECT id, account_type
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [listerUserId]
  );
  const lister = listerRows[0];
  if (!lister || String(lister.account_type || "").toLowerCase() !== "lister") {
    return res.status(400).json({
      message: "This listing owner is unavailable for inquiries."
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [conversationInsert] = await connection.execute(
      `
        INSERT INTO listing_conversations (
          property_id,
          viewer_user_id,
          lister_user_id,
          last_message_at
        )
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          id = LAST_INSERT_ID(id),
          last_message_at = CURRENT_TIMESTAMP
      `,
      [propertyId, viewerUserId, listerUserId]
    );
    const conversationId = Number(conversationInsert.insertId);

    const [messageInsert] = await connection.execute(
      `
        INSERT INTO listing_messages (
          conversation_id,
          sender_user_id,
          message_text,
          created_at
        )
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [conversationId, viewerUserId, messageText]
    );

    await connection.execute(
      `
        UPDATE listing_conversations
        SET
          last_message_sender_id = ?,
          last_message_preview = ?,
          last_message_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [viewerUserId, messageText.slice(0, 255), conversationId]
    );

    await connection.commit();

    const emittedAt = new Date().toISOString();
    const realtimePayload = {
      conversationId,
      propertyId,
      viewerUserId,
      listerUserId,
      lastMessageAt: emittedAt,
      lastMessageSenderId: viewerUserId,
      lastMessagePreview: messageText.slice(0, 255),
      message: {
        id: Number(messageInsert.insertId),
        conversationId,
        senderUserId: viewerUserId,
        senderFullName: sessionUser.fullName || null,
        senderAccountType: sessionUser.accountType || "viewer",
        messageText,
        createdAt: emittedAt
      }
    };
    emitConversationUpdated([viewerUserId, listerUserId], realtimePayload);
    emitNewMessage([viewerUserId, listerUserId], realtimePayload);
    emitListerMetricsUpdate(listerUserId, propertyId, "inquiry_created");
    scheduleUnreadMessageEmailNotification({
      conversationId,
      recipientUserId: listerUserId,
      senderUserId: viewerUserId
    });

    return res.status(201).json({
      message: "Inquiry sent successfully.",
      conversationId,
      createdMessageId: Number(messageInsert.insertId)
    });
  } catch (_error) {
    await connection.rollback();
    return res.status(500).json({
      message: "Could not send inquiry right now. Please try again."
    });
  } finally {
    connection.release();
  }
}

async function listMyConversations(req, res) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  const currentUserId = Number(sessionUser.id);
  const page = parsePositiveInt(req.query?.page, 1);
  const limit = Math.min(parsePositiveInt(req.query?.limit, DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
  const offset = (page - 1) * limit;
  const propertyIdFilter = parsePositiveInt(req.query?.propertyId, null);

  const whereParts = ["(c.viewer_user_id = ? OR c.lister_user_id = ?)"];
  const whereValues = [currentUserId, currentUserId];
  if (Number.isInteger(propertyIdFilter)) {
    whereParts.push("c.property_id = ?");
    whereValues.push(propertyIdFilter);
  }
  const whereClause = `WHERE ${whereParts.join(" AND ")}`;

  try {
    const [rows] = await pool.execute(
      `
        SELECT
          c.id,
          c.property_id AS propertyId,
          c.viewer_user_id AS viewerUserId,
          c.lister_user_id AS listerUserId,
          c.last_message_sender_id AS lastMessageSenderId,
          c.last_message_preview AS lastMessagePreview,
          c.created_at AS createdAt,
          c.last_message_at AS lastMessageAt,
          viewer.full_name AS viewerFullName,
          viewer.email AS viewerEmail,
          lister.full_name AS listerFullName,
          lister.email AS listerEmail,
          (
            SELECT COUNT(*)
            FROM listing_messages lm
            WHERE lm.conversation_id = c.id
              AND lm.sender_user_id <> ?
              AND lm.read_at IS NULL
          ) AS unreadCount
        FROM listing_conversations c
        INNER JOIN users viewer ON viewer.id = c.viewer_user_id
        INNER JOIN users lister ON lister.id = c.lister_user_id
        ${whereClause}
        ORDER BY c.last_message_at DESC, c.id DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      [...whereValues, currentUserId]
    );

    const [countRows] = await pool.execute(
      `
        SELECT COUNT(*) AS total
        FROM listing_conversations c
        ${whereClause}
      `,
      whereValues
    );
    const total = Number(countRows?.[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.status(200).json({
      data: rows.map((row) => mapConversationRowToResponse(row, currentUserId)),
      pagination: {
        total,
        page,
        limit,
        totalPages
      }
    });
  } catch (_error) {
    return res.status(500).json({
      message: "Could not load conversations right now."
    });
  }
}

async function getMyUnreadMessageCount(req, res) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  const currentUserId = Number(sessionUser.id);
  if (!Number.isFinite(currentUserId) || currentUserId <= 0) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  try {
    const [rows] = await pool.execute(
      `
        SELECT COUNT(*) AS unreadCount
        FROM listing_messages lm
        INNER JOIN listing_conversations c ON c.id = lm.conversation_id
        WHERE (c.viewer_user_id = ? OR c.lister_user_id = ?)
          AND lm.sender_user_id <> ?
          AND lm.read_at IS NULL
      `,
      [currentUserId, currentUserId, currentUserId]
    );

    return res.status(200).json({
      unreadCount: Number(rows?.[0]?.unreadCount || 0)
    });
  } catch (_error) {
    return res.status(500).json({
      message: "Could not load unread message count right now."
    });
  }
}

async function listConversationMessages(req, res) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  const conversationId = Number(req.params.conversationId);
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return res.status(400).json({ message: "Invalid conversation id." });
  }

  const conversation = await getConversationForAccess(conversationId);
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found." });
  }

  const currentUserId = Number(sessionUser.id);
  const isAdmin = hasModulePermission(sessionUser, MODULE_KEYS.ADMIN_MESSAGES, ACCESS_ACTIONS.VIEW);
  const isParticipant =
    Number(conversation.viewerUserId) === currentUserId ||
    Number(conversation.listerUserId) === currentUserId;
  if (!isAdmin && !isParticipant) {
    return res.status(403).json({
      message: "You are not allowed to view this conversation."
    });
  }

  const page = parsePositiveInt(req.query?.page, 1);
  const limit = Math.min(parsePositiveInt(req.query?.limit, 50), MAX_PAGE_LIMIT);
  const offset = (page - 1) * limit;

  try {
    const [rows] = await pool.execute(
      `
        SELECT
          lm.id,
          lm.conversation_id AS conversationId,
          lm.sender_user_id AS senderUserId,
          lm.message_text AS messageText,
          lm.read_at AS readAt,
          lm.created_at AS createdAt,
          sender.full_name AS senderFullName,
          sender.account_type AS senderAccountType
        FROM listing_messages lm
        INNER JOIN users sender ON sender.id = lm.sender_user_id
        WHERE lm.conversation_id = ?
        ORDER BY lm.created_at ASC, lm.id ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      [conversationId]
    );

    const [countRows] = await pool.execute(
      `
        SELECT COUNT(*) AS total
        FROM listing_messages
        WHERE conversation_id = ?
      `,
      [conversationId]
    );
    const total = Number(countRows?.[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    if (!isAdmin) {
      await pool.execute(
        `
          UPDATE listing_messages
          SET read_at = CURRENT_TIMESTAMP
          WHERE conversation_id = ?
            AND sender_user_id <> ?
            AND read_at IS NULL
        `,
        [conversationId, currentUserId]
      );
    }

    return res.status(200).json({
      conversation: mapConversationRowToResponse(conversation, currentUserId),
      data: rows.map((row) => ({
        id: Number(row.id),
        conversationId: Number(row.conversationId),
        senderUserId: Number(row.senderUserId),
        senderFullName: row.senderFullName,
        senderAccountType: row.senderAccountType,
        messageText: row.messageText,
        createdAt: row.createdAt,
        readAt: row.readAt,
        isOwnMessage: Number(row.senderUserId) === currentUserId
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages
      }
    });
  } catch (_error) {
    return res.status(500).json({
      message: "Could not load messages right now."
    });
  }
}

async function sendConversationMessage(req, res) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (String(sessionUser.accountType || "").toLowerCase() === "admin") {
    return res.status(403).json({
      message: "Admin accounts can view conversations but cannot send participant messages."
    });
  }

  const conversationId = Number(req.params.conversationId);
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return res.status(400).json({ message: "Invalid conversation id." });
  }

  const conversation = await getConversationForAccess(conversationId);
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found." });
  }

  const currentUserId = Number(sessionUser.id);
  const isParticipant =
    Number(conversation.viewerUserId) === currentUserId ||
    Number(conversation.listerUserId) === currentUserId;
  if (!isParticipant) {
    return res.status(403).json({
      message: "You are not allowed to send messages in this conversation."
    });
  }

  const messageText = normalizeMessage(req.body?.message);
  if (messageText.length < MIN_MESSAGE_LENGTH) {
    return res.status(400).json({
      message: `Message must be at least ${MIN_MESSAGE_LENGTH} characters.`
    });
  }
  if (messageText.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      message: `Message must be at most ${MAX_MESSAGE_LENGTH} characters.`
    });
  }

  try {
    const [insertResult] = await pool.execute(
      `
        INSERT INTO listing_messages (
          conversation_id,
          sender_user_id,
          message_text,
          created_at
        )
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [conversationId, currentUserId, messageText]
    );

    await pool.execute(
      `
        UPDATE listing_conversations
        SET
          last_message_sender_id = ?,
          last_message_preview = ?,
          last_message_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [currentUserId, messageText.slice(0, 255), conversationId]
    );

    const emittedAt = new Date().toISOString();
    const viewerUserId = Number(conversation.viewerUserId);
    const listerUserId = Number(conversation.listerUserId);
    const realtimePayload = {
      conversationId,
      propertyId: Number(conversation.propertyId),
      viewerUserId,
      listerUserId,
      lastMessageAt: emittedAt,
      lastMessageSenderId: currentUserId,
      lastMessagePreview: messageText.slice(0, 255),
      message: {
        id: Number(insertResult.insertId),
        conversationId,
        senderUserId: currentUserId,
        senderFullName: sessionUser.fullName || null,
        senderAccountType: sessionUser.accountType || "viewer",
        messageText,
        createdAt: emittedAt
      }
    };
    emitConversationUpdated([viewerUserId, listerUserId], realtimePayload);
    emitNewMessage([viewerUserId, listerUserId], realtimePayload);
    const senderIsViewer = currentUserId === viewerUserId;
    if (senderIsViewer) {
      emitListerMetricsUpdate(listerUserId, Number(conversation.propertyId), "message_sent");
    }
    const recipientUserId = resolveRecipientUserId(conversation, currentUserId);
    if (senderIsViewer && recipientUserId === listerUserId) {
      scheduleUnreadMessageEmailNotification({
        conversationId,
        recipientUserId,
        senderUserId: currentUserId
      });
    }

    return res.status(201).json({
      message: "Message sent.",
      messageId: Number(insertResult.insertId)
    });
  } catch (_error) {
    return res.status(500).json({
      message: "Could not send message right now."
    });
  }
}

async function markConversationAsRead(req, res) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }

  const conversationId = Number(req.params.conversationId);
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return res.status(400).json({ message: "Invalid conversation id." });
  }

  const conversation = await getConversationForAccess(conversationId);
  if (!conversation) {
    return res.status(404).json({ message: "Conversation not found." });
  }

  const currentUserId = Number(sessionUser.id);
  const isParticipant =
    Number(conversation.viewerUserId) === currentUserId ||
    Number(conversation.listerUserId) === currentUserId;
  if (!isParticipant) {
    return res.status(403).json({
      message: "You are not allowed to update this conversation."
    });
  }

  try {
    await pool.execute(
      `
        UPDATE listing_messages
        SET read_at = CURRENT_TIMESTAMP
        WHERE conversation_id = ?
          AND sender_user_id <> ?
          AND read_at IS NULL
      `,
      [conversationId, currentUserId]
    );
    return res.status(200).json({ message: "Conversation marked as read." });
  } catch (_error) {
    return res.status(500).json({
      message: "Could not update message read state right now."
    });
  }
}

async function listAdminConversations(req, res) {
  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (!hasModulePermission(sessionUser, MODULE_KEYS.ADMIN_MESSAGES, ACCESS_ACTIONS.VIEW)) {
    return res.status(403).json({
      message: "You do not have permission to view all private conversations."
    });
  }

  const page = parsePositiveInt(req.query?.page, 1);
  const limit = Math.min(parsePositiveInt(req.query?.limit, DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
  const offset = (page - 1) * limit;
  const search = String(req.query?.search || "").trim().toLowerCase();

  const whereParts = [];
  const whereValues = [];
  if (search) {
    whereParts.push(`
      (
        LOWER(viewer.full_name) LIKE ?
        OR LOWER(viewer.email) LIKE ?
        OR LOWER(lister.full_name) LIKE ?
        OR LOWER(lister.email) LIKE ?
        OR CAST(c.property_id AS CHAR) LIKE ?
      )
    `);
    const like = `%${search}%`;
    whereValues.push(like, like, like, like, like);
  }
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  try {
    const [rows] = await pool.execute(
      `
        SELECT
          c.id,
          c.property_id AS propertyId,
          c.viewer_user_id AS viewerUserId,
          c.lister_user_id AS listerUserId,
          c.last_message_sender_id AS lastMessageSenderId,
          c.last_message_preview AS lastMessagePreview,
          c.created_at AS createdAt,
          c.last_message_at AS lastMessageAt,
          viewer.full_name AS viewerFullName,
          viewer.email AS viewerEmail,
          lister.full_name AS listerFullName,
          lister.email AS listerEmail
        FROM listing_conversations c
        INNER JOIN users viewer ON viewer.id = c.viewer_user_id
        INNER JOIN users lister ON lister.id = c.lister_user_id
        ${whereClause}
        ORDER BY c.last_message_at DESC, c.id DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      whereValues
    );

    const [countRows] = await pool.execute(
      `
        SELECT COUNT(*) AS total
        FROM listing_conversations c
        INNER JOIN users viewer ON viewer.id = c.viewer_user_id
        INNER JOIN users lister ON lister.id = c.lister_user_id
        ${whereClause}
      `,
      whereValues
    );
    const total = Number(countRows?.[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.status(200).json({
      data: rows.map((row) => {
        const listing = properties.find((item) => Number(item.id) === Number(row.propertyId));
        return {
          id: Number(row.id),
          propertyId: Number(row.propertyId),
          listing: listing
            ? {
                id: Number(listing.id),
                title: listing.title,
                location: listing.location,
                isSoftDeleted: Boolean(listing.isSoftDeleted)
              }
            : {
                id: Number(row.propertyId),
                title: "Listing unavailable",
                location: "",
                isSoftDeleted: true
              },
          viewer: {
            id: Number(row.viewerUserId),
            fullName: row.viewerFullName,
            email: row.viewerEmail
          },
          lister: {
            id: Number(row.listerUserId),
            fullName: row.listerFullName,
            email: row.listerEmail
          },
          lastMessagePreview: row.lastMessagePreview || "",
          lastMessageAt: row.lastMessageAt,
          lastMessageSenderId: row.lastMessageSenderId ? Number(row.lastMessageSenderId) : null,
          createdAt: row.createdAt
        };
      }),
      pagination: {
        total,
        page,
        limit,
        totalPages
      }
    });
  } catch (_error) {
    return res.status(500).json({
      message: "Could not load admin conversation log right now."
    });
  }
}

module.exports = {
  createListingInquiryConversation,
  listMyConversations,
  getMyUnreadMessageCount,
  listConversationMessages,
  sendConversationMessage,
  markConversationAsRead,
  listAdminConversations,
  __testables: {
    resolveRecipientUserId,
    buildUnreadEmailTimerKey
  }
};
