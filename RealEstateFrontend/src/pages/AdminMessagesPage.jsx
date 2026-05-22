import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PortalLayout from "../components/PortalLayout";
import {
  getAdminConversationMessages,
  getAdminConversations
} from "../services/messageService";
import { getRealtimeSocket } from "../services/realtimeSocket";
import { playIncomingMessageTone } from "../utils/messageTone";
import { notify } from "../utils/notify";
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

function formatTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-KE", { day: "2-digit", month: "short" });
}

function formatBubbleTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
}

const ROLE_COLORS = { admin: "#7c3aed", lister: "#065f46", viewer: "#1e3a5f" };

/* ── page ── */
function AdminMessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [toneEnabled, setToneEnabled] = useState(() => isIncomingMessageToneEnabled());
  const [socketConnected, setSocketConnected] = useState(false);

  const threadEndRef = useRef(null);

  const selectedConversationId = Number(searchParams.get("conversation")) || null;
  const selectedConversation = useMemo(
    () => conversations.find((c) => Number(c.id) === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  /* auto-scroll */
  useEffect(() => {
    if (!loadingMessages) {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loadingMessages]);

  /* ── data ── */
  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      const res = await getAdminConversations({ search: search.trim(), limit: 100 });
      const data = Array.isArray(res?.data) ? res.data : [];
      setConversations(data);
      if (data.length > 0) {
        const curId = Number(new URLSearchParams(window.location.search).get("conversation"));
        const still = data.some((c) => Number(c.id) === curId);
        if (!curId || !still) {
          const next = new URLSearchParams(window.location.search);
          next.set("conversation", String(data[0].id));
          setSearchParams(next, { replace: true });
        }
      }
    } catch (err) {
      notify(err.message || "Could not load conversation logs.", "warning");
    } finally {
      setLoadingConversations(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) { setMessages([]); return; }
    setLoadingMessages(true);
    try {
      const res = await getAdminConversationMessages(conversationId, { limit: 500 });
      setMessages(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      notify(err.message || "Could not load messages.", "warning");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => {
    if (!selectedConversationId) return;
    loadMessages(selectedConversationId);
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
        next[idx] = {
          ...next[idx],
          lastMessagePreview: payload?.lastMessagePreview ?? next[idx].lastMessagePreview,
          lastMessageAt: payload?.lastMessageAt ?? next[idx].lastMessageAt,
          lastMessageSenderId: payload?.lastMessageSenderId ?? next[idx].lastMessageSenderId
        };
        return next.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
      });
    };

    const onNewMessage = (payload) => {
      const incoming = payload?.message;
      const convId = Number(payload?.conversationId);
      if (!incoming || !Number.isFinite(convId) || convId <= 0) return;
      if (convId === selectedConversationId) {
        setMessages((prev) => {
          if (prev.some((m) => Number(m.id) === Number(incoming.id))) return prev;
          return [...prev, {
            id: Number(incoming.id),
            conversationId: convId,
            senderUserId: Number(incoming.senderUserId),
            senderFullName: incoming.senderFullName || "User",
            senderAccountType: incoming.senderAccountType || "viewer",
            messageText: incoming.messageText,
            createdAt: incoming.createdAt
          }];
        });
      }
      if (isIncomingMessageToneEnabled()) playIncomingMessageTone();
      notify("New message in monitored conversations.", "info");
    };

    socket.on("admin:conversation-updated", onConversationUpdated);
    socket.on("admin:new-message", onNewMessage);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("admin:conversation-updated", onConversationUpdated);
      socket.off("admin:new-message", onNewMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversationId]);

  /* ── actions ── */
  const handleApplySearch = () => {
    const next = new URLSearchParams(searchParams);
    if (search.trim()) next.set("q", search.trim());
    else next.delete("q");
    setSearchParams(next, { replace: true });
    loadConversations();
  };

  const handleSelectConversation = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set("conversation", String(id));
    setSearchParams(next, { replace: false });
  };

  const handleToggleTone = () => {
    const next = !toneEnabled;
    setToneEnabled(next);
    setStoredPreferences({ ...getStoredPreferences(), incomingMessageTone: next });
    notify(next ? "Tone enabled." : "Tone muted.", "info");
  };

  return (
    <PortalLayout
      title="Conversation Oversight"
      subtitle="Admin read-only view of private conversations between listers and viewers."
    >
      <div className="kr-msg-shell">

        {/* ── sidebar ── */}
        <aside className="kr-msg-sidebar">
          <div className="kr-msg-sidebar-header">
            <div className="kr-msg-sidebar-title-row">
              <span className="kr-msg-sidebar-title">All Conversations</span>
              <div className="kr-msg-sidebar-actions">
                <button
                  type="button"
                  className={`kr-msg-icon-btn kr-msg-tone-toggle ${toneEnabled ? "active" : ""}`}
                  onClick={handleToggleTone}
                  title={toneEnabled ? "Mute tone" : "Enable tone"}
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
                  title="Refresh"
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
          </div>

          <div className="kr-msg-conv-list">
            {loadingConversations ? (
              <div className="kr-msg-list-loading">
                {[1, 2, 3].map((i) => <div key={i} className="kr-msg-list-skeleton" />)}
              </div>
            ) : conversations.length === 0 ? (
              <div className="kr-msg-zero">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <p>No results</p>
                <span>No conversations match your search.</span>
              </div>
            ) : (
              conversations.map((item) => {
                const active = Number(item.id) === selectedConversationId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`kr-msg-conv-item ${active ? "active" : ""}`}
                    onClick={() => handleSelectConversation(item.id)}
                  >
                    <div className="kr-msg-conv-avatars">
                      <Avatar name={item.viewer?.fullName} size={28} />
                      <Avatar name={item.lister?.fullName} size={28} />
                    </div>
                    <div className="kr-msg-conv-body">
                      <div className="kr-msg-conv-row">
                        <span className="kr-msg-conv-name">{item.viewer?.fullName} ↔ {item.lister?.fullName}</span>
                        <span className="kr-msg-conv-time">{formatTime(item.lastMessageAt)}</span>
                      </div>
                      <p className="kr-msg-conv-listing">{item.listing?.title || `Listing #${item.propertyId}`}</p>
                      <p className="kr-msg-conv-preview">{item.lastMessagePreview || "No messages yet."}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ── transcript ── */}
        <section className="kr-msg-chat">
          {!selectedConversation ? (
            <div className="kr-msg-pick-prompt">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <h3>Pick a conversation</h3>
              <p>Select one from the list to inspect the full message thread.</p>
            </div>
          ) : (
            <>
              {/* header */}
              <div className="kr-msg-chat-header">
                <div className="kr-msg-conv-avatars" style={{ flexShrink: 0 }}>
                  <Avatar name={selectedConversation.viewer?.fullName} size={38} />
                  <Avatar name={selectedConversation.lister?.fullName} size={38} />
                </div>
                <div className="kr-msg-chat-header-info">
                  <strong>{selectedConversation.listing?.title || `Listing #${selectedConversation.propertyId}`}</strong>
                  <span>
                    <span
                      className="kr-msg-role-chip"
                      style={{ background: "#d4e7ff", color: "#1e3a5f" }}
                    >viewer</span>
                    {selectedConversation.viewer?.fullName}
                    {" "}&nbsp;↔&nbsp;{" "}
                    <span
                      className="kr-msg-role-chip"
                      style={{ background: "#d1fae5", color: "#065f46" }}
                    >lister</span>
                    {selectedConversation.lister?.fullName}
                  </span>
                </div>
                <div className="kr-msg-chat-header-meta">
                  <span className="kr-msg-admin-badge">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    Read-only
                  </span>
                </div>
              </div>

              {/* transcript thread */}
              <div className="kr-msg-thread">
                {loadingMessages ? (
                  <div className="kr-msg-thread-loading">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className={`kr-msg-bubble-skeleton ${i % 2 === 0 ? "right" : "left"}`} />
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <div className="kr-msg-zero kr-msg-zero--thread">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <p>No messages yet</p>
                    <span>This conversation has not started yet.</span>
                  </div>
                ) : (
                  <>
                    {messages.map((msg, idx) => {
                      const isLister = msg.senderAccountType === "lister";
                      const roleColor = ROLE_COLORS[msg.senderAccountType] || "#1e3a5f";
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
                          <div className={`kr-msg-row kr-msg-row--admin ${isLister ? "own" : "other"}`}>
                            <Avatar name={msg.senderFullName} size={28} />
                            <div className="kr-msg-bubble">
                              <span className="kr-msg-sender-label" style={{ color: roleColor }}>
                                {msg.senderFullName}
                                <span className="kr-msg-role-chip" style={{ background: `${roleColor}15`, color: roleColor }}>
                                  {msg.senderAccountType}
                                </span>
                              </span>
                              <p>{msg.messageText}</p>
                              <time>{formatBubbleTime(msg.createdAt)}</time>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={threadEndRef} />
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </PortalLayout>
  );
}

export default AdminMessagesPage;
