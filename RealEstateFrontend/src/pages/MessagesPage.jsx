import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PortalLayout from "../components/PortalLayout";
import {
  getAdminConversationMessages,
  getAdminConversations,
  getConversationMessages,
  getMyConversations,
  markConversationAsRead,
  sendConversationMessage
} from "../services/messageService";
import { getRealtimeSocket } from "../services/realtimeSocket";
import { playIncomingMessageTone } from "../utils/messageTone";
import { notify } from "../utils/notify";
import { getStoredUser } from "../utils/session";
import { ACCESS_ACTIONS, MODULE_KEYS, canAccessModule } from "../utils/accessControl";
import {
  getStoredPreferences,
  isIncomingMessageToneEnabled,
  setStoredPreferences
} from "../utils/userPreferences";

/* ── helpers ── */
function avatarInitials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return String(parts[0]?.[0] || "?").toUpperCase();
}

function formatTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-KE", { day: "2-digit", month: "short" });
}

function formatBubbleTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
}

/* ── avatar colour derived from string ── */
const AVATAR_PALETTES = [
  ["#1e3a5f", "#d4e7ff"],
  ["#7c3aed", "#ede9fe"],
  ["#065f46", "#d1fae5"],
  ["#b45309", "#fef3c7"],
  ["#9f1239", "#ffe4e6"],
  ["#0e7490", "#cffafe"]
];
function avatarPalette(name) {
  const code = String(name || "")
    .split("")
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_PALETTES[code % AVATAR_PALETTES.length];
}

/* ── Avatar component ── */
function Avatar({ name, size = 36 }) {
  const [bg, fg] = avatarPalette(name);
  return (
    <span
      className="kr-msg-avatar"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {avatarInitials(name)}
    </span>
  );
}

/* ── empty state ── */
function EmptyConversations() {
  return (
    <div className="kr-msg-zero">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <p>No inquiries yet</p>
      <span>When someone messages you about a listing, it will appear here.</span>
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="kr-msg-zero kr-msg-zero--thread">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 12h4l2-2" />
      </svg>
      <p>No messages yet</p>
      <span>Send the first message to kick off the conversation.</span>
    </div>
  );
}

/* ── send icon ── */
function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

const ROLE_COLORS = { admin: "#7c3aed", lister: "#065f46", viewer: "#1e3a5f", employee: "#7c3aed" };

/* ── main page ── */
function MessagesPage({ forceOversightMode = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = getStoredUser();
  const currentUserId = Number(currentUser?.id) || null;
  const canViewConversationOversight = canAccessModule(
    currentUser,
    MODULE_KEYS.ADMIN_MESSAGES,
    ACCESS_ACTIONS.VIEW
  );
  const isOversightMode = Boolean(forceOversightMode || canViewConversationOversight);

  const [conversations, setConversations] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [toneEnabled, setToneEnabled] = useState(() => isIncomingMessageToneEnabled());
  const [socketConnected, setSocketConnected] = useState(false);
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);

  const selectedConversationIdRef = useRef(null);
  const threadEndRef = useRef(null);
  const textareaRef = useRef(null);

  const selectedConversationId = Number(searchParams.get("conversation")) || null;
  const selectedConversation = useMemo(() => {
    return conversations.find((c) => Number(c.id) === selectedConversationId) || null;
  }, [conversations, selectedConversationId]);

  /* keep ref in sync */
  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  /* auto-scroll to newest message */
  useEffect(() => {
    if (!loadingMessages) {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loadingMessages]);

  /* ── data loaders ── */
  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      const res = isOversightMode
        ? await getAdminConversations({ search: search.trim(), limit: 100 })
        : await getMyConversations({ limit: 50 });
      const data = Array.isArray(res?.data) ? res.data : [];
      setConversations(data);
      if (data.length > 0) {
        const currentId = selectedConversationIdRef.current;
        const stillPresent = data.some((c) => Number(c.id) === Number(currentId));
        if (!currentId || !stillPresent) {
          const next = new URLSearchParams(window.location.search);
          next.set("conversation", String(data[0].id));
          setSearchParams(next, { replace: true });
        }
      }
    } catch (err) {
      notify(
        err.message || (isOversightMode ? "Could not load conversation logs." : "Could not load conversations."),
        "warning"
      );
    } finally {
      setLoadingConversations(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOversightMode, search]);

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) { setMessages([]); return; }
    setLoadingMessages(true);
    try {
      const res = isOversightMode
        ? await getAdminConversationMessages(conversationId, { limit: 500 })
        : await getConversationMessages(conversationId, { limit: 200 });
      setMessages(Array.isArray(res?.data) ? res.data : []);
      if (!isOversightMode) {
        await markConversationAsRead(conversationId);
        window.dispatchEvent(new CustomEvent("messages:badge-refresh"));
      }
    } catch (err) {
      notify(err.message || "Could not load messages.", "warning");
    } finally {
      setLoadingMessages(false);
    }
  }, [isOversightMode]);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => {
    if (!selectedConversationId) return;
    loadMessages(selectedConversationId);
    textareaRef.current?.focus();
  }, [selectedConversationId, loadMessages]);

  /* ── socket ── */
  useEffect(() => {
    const socket = getRealtimeSocket();

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    if (socket.connected) setSocketConnected(true);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    const onConversationUpdated = (payload) => {
      const convId = Number(payload?.conversationId);
      if (!Number.isFinite(convId) || convId <= 0) return;
      setConversations((prev) => {
        const idx = prev.findIndex((c) => Number(c.id) === convId);
        if (idx === -1) { loadConversations(); return prev; }
        const next = [...prev];
        const cur = next[idx];
        next[idx] = {
          ...cur,
          lastMessagePreview: payload?.lastMessagePreview ?? cur.lastMessagePreview,
          lastMessageAt: payload?.lastMessageAt ?? cur.lastMessageAt,
          lastMessageSenderId: payload?.lastMessageSenderId ?? cur.lastMessageSenderId,
          unreadCount: isOversightMode
            ? cur.unreadCount
            :
            Number(payload?.lastMessageSenderId) !== Number(currentUserId)
              ? Number(cur.unreadCount || 0) + 1
              : cur.unreadCount
        };
        return next.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
      });
    };

    const onNewMessage = async (payload) => {
      const incoming = payload?.message;
      const convId = Number(payload?.conversationId);
      if (!incoming || !Number.isFinite(convId) || convId <= 0) return;
      const selId = Number(selectedConversationIdRef.current);
      if (selId === convId) {
        setMessages((prev) => {
          if (prev.some((m) => Number(m.id) === Number(incoming.id))) return prev;
          if (isOversightMode) {
            return [...prev, {
              id: Number(incoming.id),
              conversationId: convId,
              senderUserId: Number(incoming.senderUserId),
              senderFullName: incoming.senderFullName || "User",
              senderAccountType: incoming.senderAccountType || "viewer",
              messageText: incoming.messageText,
              createdAt: incoming.createdAt
            }];
          }
          return [...prev, {
            id: Number(incoming.id),
            conversationId: convId,
            senderUserId: Number(incoming.senderUserId),
            messageText: incoming.messageText,
            createdAt: incoming.createdAt,
            readAt: null,
            isOwnMessage: Number(incoming.senderUserId) === currentUserId
          }];
        });
        if (!isOversightMode && Number(incoming.senderUserId) !== currentUserId) {
          await markConversationAsRead(convId);
          window.dispatchEvent(new CustomEvent("messages:badge-refresh"));
        }
      }
      if (isOversightMode || Number(incoming.senderUserId) !== currentUserId) {
        if (isIncomingMessageToneEnabled()) playIncomingMessageTone();
        notify(isOversightMode ? "New message in monitored conversations." : "New message received.", "info");
      }
    };

    const convUpdateEvent = isOversightMode ? "admin:conversation-updated" : "messages:conversation-updated";
    const newMessageEvent = isOversightMode ? "admin:new-message" : "messages:new-message";
    socket.on(convUpdateEvent, onConversationUpdated);
    socket.on(newMessageEvent, onNewMessage);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off(convUpdateEvent, onConversationUpdated);
      socket.off(newMessageEvent, onNewMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, isOversightMode]);

  /* ── actions ── */
  const handleSelectConversation = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set("conversation", String(id));
    setSearchParams(next, { replace: false });
    setIsMobileChatOpen(true);
  };

  const handleMobileBack = () => {
    setIsMobileChatOpen(false);
  };

  const handleSendMessage = async () => {
    if (isOversightMode) return;
    const trimmed = String(messageText || "").trim();
    if (trimmed.length < 2) { notify("Please type at least 2 characters.", "warning"); return; }
    if (!selectedConversationId) { notify("Pick a conversation first.", "warning"); return; }
    setSending(true);
    try {
      await sendConversationMessage(selectedConversationId, { message: trimmed });
      setMessageText("");
      await Promise.all([loadMessages(selectedConversationId), loadConversations()]);
    } catch (err) {
      notify(err.message || "Could not send message.", "danger");
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleToggleTone = () => {
    const next = !toneEnabled;
    setToneEnabled(next);
    setStoredPreferences({ ...getStoredPreferences(), incomingMessageTone: next });
    notify(next ? "Message tone enabled." : "Message tone muted.", "info");
  };

  const handleApplySearch = () => {
    if (!isOversightMode) return;
    const next = new URLSearchParams(searchParams);
    if (search.trim()) next.set("q", search.trim());
    else next.delete("q");
    setSearchParams(next, { replace: true });
    loadConversations();
  };

  return (
    <PortalLayout
      title={isOversightMode ? "Conversation Oversight" : "Messages"}
      subtitle={
        isOversightMode
          ? "Read-only view of private conversations between listers and viewers."
          : "Private conversations about your listings."
      }
    >
      <div className={`kr-msg-shell${isMobileChatOpen ? " is-mobile-chat-open" : ""}`}>

        {/* ── sidebar ── */}
        <aside className="kr-msg-sidebar">
          <div className="kr-msg-sidebar-header">
            <div className="kr-msg-sidebar-title-row">
              <span className="kr-msg-sidebar-title">{isOversightMode ? "All Conversations" : "Conversations"}</span>
              <div className="kr-msg-sidebar-actions">
                <button
                  type="button"
                  className={`kr-msg-icon-btn kr-msg-tone-toggle ${toneEnabled ? "active" : ""}`}
                  onClick={handleToggleTone}
                  title={toneEnabled ? "Mute incoming tone" : "Enable incoming tone"}
                  aria-pressed={toneEnabled}
                >
                  {toneEnabled ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
                      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
                      <path d="M18 8a6 6 0 0 0-9.33-5" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  className="kr-msg-icon-btn"
                  onClick={loadConversations}
                  disabled={loadingConversations}
                  title="Refresh conversations"
                >
                  <svg
                    width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className={loadingConversations ? "kr-msg-spin" : ""}
                  >
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="kr-msg-ws-status">
              <span className={`kr-msg-ws-dot ${socketConnected ? "connected" : "disconnected"}`} />
              <span>{socketConnected ? "Live" : "Connecting…"}</span>
            </div>
            {isOversightMode && (
              <div className="kr-msg-search-row">
                <input
                  type="search"
                  className="kr-msg-search-input"
                  placeholder="Search name, email, or listing…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleApplySearch(); }}
                />
                <button type="button" className="kr-msg-search-btn" onClick={handleApplySearch}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          <div className="kr-msg-conv-list">
            {loadingConversations ? (
              <div className="kr-msg-list-loading">
                {[1, 2, 3].map((i) => <div key={i} className="kr-msg-list-skeleton" />)}
              </div>
            ) : conversations.length === 0 ? (
              isOversightMode ? (
                <div className="kr-msg-zero">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <p>No results</p>
                  <span>No conversations match your search.</span>
                </div>
              ) : (
                <EmptyConversations />
              )
            ) : (
              conversations.map((item) => {
                const active = Number(item.id) === selectedConversationId;
                const hasUnread = !isOversightMode && Number(item.unreadCount || 0) > 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`kr-msg-conv-item ${active ? "active" : ""} ${hasUnread ? "has-unread" : ""}`}
                    onClick={() => handleSelectConversation(item.id)}
                  >
                    {isOversightMode ? (
                      <div className="kr-msg-conv-avatars">
                        <Avatar name={item.viewer?.fullName} size={28} />
                        <Avatar name={item.lister?.fullName} size={28} />
                      </div>
                    ) : (
                      <Avatar name={item.otherUser?.fullName} />
                    )}
                    <div className="kr-msg-conv-body">
                      <div className="kr-msg-conv-row">
                        <span className="kr-msg-conv-name">
                          {isOversightMode
                            ? `${item.viewer?.fullName} ↔ ${item.lister?.fullName}`
                            : (item.otherUser?.fullName || "User")}
                        </span>
                        <span className="kr-msg-conv-time">{formatTime(item.lastMessageAt)}</span>
                      </div>
                      <p className="kr-msg-conv-listing">{item.listing?.title || `Listing #${item.propertyId}`}</p>
                      <p className="kr-msg-conv-preview">{item.lastMessagePreview || "Start the conversation…"}</p>
                    </div>
                    {hasUnread && (
                      <span className="kr-msg-badge">{item.unreadCount}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ── chat main ── */}
        <section className="kr-msg-chat">
          {!selectedConversation ? (
            <div className="kr-msg-pick-prompt">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <h3>Select a conversation</h3>
              <p>Choose a conversation from the left to view messages.</p>
            </div>
          ) : (
            <>
              {/* chat header */}
              <div className="kr-msg-chat-header">
                <button
                  type="button"
                  className="kr-msg-back-btn"
                  onClick={handleMobileBack}
                  aria-label="Back to conversations"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>
                {isOversightMode ? (
                  <div className="kr-msg-conv-avatars" style={{ flexShrink: 0 }}>
                    <Avatar name={selectedConversation.viewer?.fullName} size={38} />
                    <Avatar name={selectedConversation.lister?.fullName} size={38} />
                  </div>
                ) : (
                  <Avatar name={selectedConversation.otherUser?.fullName} size={40} />
                )}
                <div className="kr-msg-chat-header-info">
                  <strong>
                    {isOversightMode
                      ? (selectedConversation.listing?.title || `Listing #${selectedConversation.propertyId}`)
                      : (selectedConversation.otherUser?.fullName || "Conversation")}
                  </strong>
                  {isOversightMode ? (
                    <span>
                      <span className="kr-msg-role-chip" style={{ background: "#d4e7ff", color: "#1e3a5f" }}>viewer</span>
                      {selectedConversation.viewer?.fullName}
                      {" "}&nbsp;↔&nbsp;{" "}
                      <span className="kr-msg-role-chip" style={{ background: "#d1fae5", color: "#065f46" }}>lister</span>
                      {selectedConversation.lister?.fullName}
                    </span>
                  ) : (
                    <span>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
                      </svg>
                      {selectedConversation.listing?.title || `Listing #${selectedConversation.propertyId}`}
                    </span>
                  )}
                </div>
                {isOversightMode && (
                  <div className="kr-msg-chat-header-meta">
                    <span className="kr-msg-admin-badge">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      Read-only
                    </span>
                  </div>
                )}
              </div>

              {/* thread */}
              <div className="kr-msg-thread">
                {loadingMessages ? (
                  <div className="kr-msg-thread-loading">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className={`kr-msg-bubble-skeleton ${i % 2 === 0 ? "right" : "left"}`} />
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <EmptyThread />
                ) : (
                  <>
                    {messages.map((msg, idx) => {
                      const prevMsg = messages[idx - 1];
                      const showDate =
                        !prevMsg ||
                        new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();
                      return (
                        <div key={msg.id}>
                          {showDate && (
                            <div className="kr-msg-date-divider">
                              <span>{new Date(msg.createdAt).toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" })}</span>
                            </div>
                          )}
                          <div className={`kr-msg-row ${isOversightMode ? "kr-msg-row--admin" : ""} ${isOversightMode ? (msg.senderAccountType === "lister" ? "own" : "other") : (msg.isOwnMessage ? "own" : "other")}`}>
                            {isOversightMode ? (
                              <Avatar name={msg.senderFullName} size={28} />
                            ) : (
                              !msg.isOwnMessage && <Avatar name={selectedConversation.otherUser?.fullName} size={28} />
                            )}
                            <div className="kr-msg-bubble">
                              {isOversightMode && (
                                <span className="kr-msg-sender-label" style={{ color: ROLE_COLORS[msg.senderAccountType] || "#1e3a5f" }}>
                                  {msg.senderFullName}
                                  <span
                                    className="kr-msg-role-chip"
                                    style={{
                                      background: `${(ROLE_COLORS[msg.senderAccountType] || "#1e3a5f")}15`,
                                      color: ROLE_COLORS[msg.senderAccountType] || "#1e3a5f"
                                    }}
                                  >
                                    {msg.senderAccountType}
                                  </span>
                                </span>
                              )}
                              <p>{msg.messageText}</p>
                              <time>{formatBubbleTime(msg.createdAt)}</time>
                              {!isOversightMode && msg.isOwnMessage && msg.readAt && (
                                <svg className="kr-msg-read-tick" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={threadEndRef} />
                  </>
                )}
              </div>

              {!isOversightMode && (
                <div className="kr-msg-compose">
                  <textarea
                    ref={textareaRef}
                    className="kr-msg-compose-input"
                    placeholder="Type a message… (Ctrl+Enter to send)"
                    rows={3}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sending}
                  />
                  <button
                    type="button"
                    className="kr-msg-send-btn"
                    onClick={handleSendMessage}
                    disabled={sending || messageText.trim().length < 2}
                    aria-label="Send message"
                  >
                    {sending ? (
                      <span className="kr-msg-btn-spinner" />
                    ) : (
                      <SendIcon />
                    )}
                    <span>{sending ? "Sending" : "Send"}</span>
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </PortalLayout>
  );
}

export default MessagesPage;
