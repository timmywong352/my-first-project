import { useEffect, useRef, useState, useCallback } from "react";
import { API, WS_BASE, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useThrottledTyping } from "@/hooks/useThrottledTyping";
import LilyAvatar from "@/components/LilyAvatar";
import { speak, cancelSpeak, primeTTS } from "@/lib/tts";
import {
  MessageCircle, X, Send, Paperclip, Smile, Check, CheckCheck,
  Loader2, FileText, Image as ImageIcon, Star, Clock, UserCog, Volume2, VolumeX,
  Sparkles, Mail,
} from "lucide-react";

const ATTACH_ACCEPT = ".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.zip";
const CLIENT_ID_KEY = "pulse_client_id";
const CUST_EMAIL_KEY = "pulse_customer_email";
const CUST_NAME_KEY = "pulse_customer_name";
const SESSION_KEY = "customer_session";

// Default fallback labels used until /lily/status returns localised set.
const FALLBACK_OPTIONS = [
  { key: "query_recharge",   label: "Deposit status",    emoji: "💳" },
  { key: "query_withdrawal", label: "Withdrawal status", emoji: "💰" },
  { key: "view_promotions",  label: "Promotions",        emoji: "🎁" },
  { key: "query_ticket",     label: "Ticket status",     emoji: "📋" },
];

function ensureClientId() {
  let cid = localStorage.getItem(CLIENT_ID_KEY);
  if (!cid) {
    // Prefer crypto.randomUUID when available, fall back to Math.random.
    const uid =
      (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
        : Math.random().toString(36).slice(2, 14);
    cid = `anon_${uid}`;
    localStorage.setItem(CLIENT_ID_KEY, cid);
  }
  return cid;
}

function fileIcon(ct) {
  if (ct && ct.startsWith("image/")) return <ImageIcon className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}

function TypingDots({ label }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <div className="flex space-x-1">
        <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
        <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
        <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
      <span className="text-xs text-slate-500">{label} is typing…</span>
    </div>
  );
}

function AttachmentBubble({ att, sessionId, sessionToken, isCustomerSide }) {
  const url = `${API}/files/${att.id}?session_id=${sessionId}&session_token=${sessionToken}`;
  const isImage = att.content_type && att.content_type.startsWith("image/");
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt={att.filename} className="rounded-lg max-w-[220px] max-h-[220px] object-cover" />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs border ${
        isCustomerSide ? "bg-white/10 border-white/20 text-white" : "bg-white border-slate-200 text-slate-700"
      }`}
    >
      {fileIcon(att.content_type)}
      <span className="truncate max-w-[160px]">{att.filename}</span>
    </a>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  // phase: connecting | lily | queued | chat | closed
  const [phase, setPhase] = useState("connecting");
  const [session, setSession] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [agentTyping, setAgentTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [csatRating, setCsatRating] = useState(0);
  const [csatSubmitted, setCsatSubmitted] = useState(false);
  const [closedNotice, setClosedNotice] = useState("");
  const [agentPreview, setAgentPreview] = useState("");
  const [lilyEnabled, setLilyEnabled] = useState(true);
  const [lilySpeaking, setLilySpeaking] = useState(false);
  const [lilyLoading, setLilyLoading] = useState(false);
  const [ttsOn, setTtsOn] = useState(true);
  const [lilySubtitle, setLilySubtitle] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [options, setOptions] = useState(FALLBACK_OPTIONS);
  const [errorMsg, setErrorMsg] = useState("");

  // Email capture (inline prompt driven by Lily)
  const [emailPromptShown, setEmailPromptShown] = useState(false);
  const [emailValue, setEmailValue] = useState(localStorage.getItem(CUST_EMAIL_KEY) || "");
  const [nameValue, setNameValue] = useState(localStorage.getItem(CUST_NAME_KEY) || "");
  const [emailSaved, setEmailSaved] = useState(!!localStorage.getItem(CUST_EMAIL_KEY));
  const [emailSaving, setEmailSaving] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const bootedRef = useRef(false);
  const sendRef = useRef(null);

  const { onChange: onTypingChange, flushStop: flushTyping } = useThrottledTyping({
    send: (payload) => sendRef.current?.(payload),
    buildPayload: (val, isTyping) => ({ type: "typing", is_typing: isTyping, content: val }),
    intervalMs: 500,
    stopMs: 2000,
    enabled: phase === "chat",
  });

  // Localised options list from server
  useEffect(() => {
    api.get("/lily/status?lang=en")
      .then(({ data }) => {
        setLilyEnabled(!!data.enabled);
        if (data.options) {
          const arr = Object.entries(data.options).map(([key, v]) => ({ key, ...v }));
          setOptions(arr);
        }
      })
      .catch(() => { /* keep fallbacks */ });
  }, []);

  const speakLily = useCallback((textToSpeak) => {
    if (!textToSpeak) return;
    setLilySubtitle(textToSpeak);
    if (!ttsOn) return;
    setLilySpeaking(true);
    speak(textToSpeak, {
      voice: "nova",
      onEnd: () => setLilySpeaking(false),
    });
  }, [ttsOn]);

  // ---------- Bootstrap when widget opens ----------
  const bootstrap = useCallback(async () => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    setErrorMsg("");
    primeTTS();

    // 1) Resume an existing session if one is persisted and still valid.
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        const s = JSON.parse(raw);
        if (s && s.session_id && s.session_token) {
          const check = await fetch(
            `${API}/chat/public/${s.session_id}/messages?session_token=${s.session_token}`,
          );
          if (check.ok) {
            const msgs = await check.json();
            setSession(s);
            setMessages(msgs);
            // If a human agent has ever spoken, we're in human chat mode.
            const hasHuman = msgs.some((m) => m.sender_type === "agent");
            const stillLily = !hasHuman;
            setPhase(stillLily ? "lily" : "chat");
            if (stillLily) {
              const lastLily = [...msgs].reverse().find((m) => m.sender_type === "lily");
              if (lastLily) setLilySubtitle(lastLily.content);
            }
            return;
          }
          // Server rejected the session → drop it and start fresh.
          localStorage.removeItem(SESSION_KEY);
        }
      } catch { /* fall through */ }
    }

    // 2) Create a fresh anonymous session
    try {
      const clientId = ensureClientId();
      const { data } = await api.post("/chat/session/anonymous", {
        client_id: clientId,
        language: "en",
        page: window.location.href,
      });
      setSession(data);
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      setMessages([]);
      setQueuePosition(data.queue_position || null);
      setPhase("lily");

      // Open Lily immediately
      const resp = await fetch(
        `${API}/lily/open?session_id=${data.session_id}&session_token=${data.session_token}&lang=en`,
        { method: "POST" },
      );
      const r = await resp.json();
      if (r?.message) {
        setMessages((prev) => [...prev, r.message]);
        speakLily(r.message.content);
      }
      if (r?.options?.length) setOptions(r.options);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 429) {
        setErrorMsg(detail || "Too many chats started. Please wait a moment and try again.");
      } else {
        setErrorMsg("Sorry, we couldn't start the chat. Please try again in a moment.");
      }
      bootedRef.current = false; // allow retry
    }
  }, [speakLily]);

  useEffect(() => {
    if (open) bootstrap();
  }, [open, bootstrap]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, agentTyping]);

  // ---------- WebSocket ----------
  const wsUrl = session
    ? `${WS_BASE}/api/ws/customer?session_id=${session.session_id}&session_token=${session.session_token}`
    : null;

  const handleWsMessage = useCallback((data) => {
    if (data.type === "message") {
      setMessages((prev) => {
        if (prev.find((m) => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
      if (data.message.sender_type === "agent") {
        setAgentTyping(false);
        setAgentPreview("");
      }
    } else if (data.type === "message_edited") {
      setMessages((prev) => prev.map((m) => (m.id === data.message.id ? data.message : m)));
    } else if (data.type === "message_deleted") {
      setMessages((prev) => prev.filter((m) => m.id !== data.message_id));
    } else if (data.type === "typing") {
      if (data.sender_type === "agent") {
        setAgentTyping(data.is_typing);
        if (typeof data.preview === "string") setAgentPreview(data.preview);
      }
    } else if (data.type === "read_receipt") {
      setMessages((prev) => prev.map((m) => (m.sender_type === "customer" ? { ...m, status: "read" } : m)));
    } else if (data.type === "session_closed") {
      setPhase("closed");
      setClosedNotice(data.reason === "inactivity"
        ? "This chat was closed due to inactivity. Start a new chat to continue."
        : "This chat has ended. Thanks for chatting with us!");
    } else if (data.type === "queue_promoted") {
      setQueuePosition(null);
      setPhase("chat");
    } else if (data.type === "queue_update") {
      setQueuePosition(data.position);
    } else if (data.type === "error") {
      if (data.code === "session_closed") {
        setPhase("closed");
        setClosedNotice(data.message || "This chat has ended.");
      }
    }
  }, []);

  const { send, connected } = useWebSocket(wsUrl, handleWsMessage);
  sendRef.current = send;

  // ---------- Hand-off ----------
  const handoffToHuman = async (customerText) => {
    if (!session) return;
    try {
      const params = new URLSearchParams({
        session_id: session.session_id,
        session_token: session.session_token,
        lang: "en",
      });
      if (customerText) params.set("customer_text", customerText);
      const resp = await fetch(`${API}/lily/handoff?${params.toString()}`, { method: "POST" });
      const data = await resp.json();
      cancelSpeak();
      setLilySpeaking(false);
      if (data.status === "queued") {
        setQueuePosition(data.queue_position);
        setPhase("queued");
      } else {
        setPhase("chat");
      }
    } catch { /* ignore */ }
  };

  const chooseOption = async (opt) => {
    if (!session || lilyLoading || phase !== "lily") return;
    setLilyLoading(true);
    speakLily("Great — connecting you to a human agent now.");
    // Show email prompt inline so the customer can leave it while waiting.
    if (!emailSaved) setEmailPromptShown(true);
    try {
      await handoffToHuman(opt.label);
    } finally {
      setLilyLoading(false);
    }
  };

  // ---------- Send message ----------
  const sendMessage = async () => {
    if (!text.trim() && pendingAttachments.length === 0) return;

    if (phase === "lily") {
      // In Lily mode: any typed text immediately triggers hand-off.
      const userText = text.trim();
      setText("");
      setPendingAttachments([]);
      flushTyping("");
      setLilyLoading(true);
      speakLily("Great — connecting you to a human agent now.");
      if (!emailSaved) setEmailPromptShown(true);
      try {
        await handoffToHuman(userText);
      } finally {
        setLilyLoading(false);
      }
    } else if (phase === "chat" || phase === "queued") {
      // Human channel (works even while queued so customer can add context)
      send({ type: "message", content: text.trim(), attachments: pendingAttachments });
      setText("");
      setPendingAttachments([]);
      flushTyping("");
    }
  };

  const handleTyping = (val) => {
    if (phase !== "chat") { setText(val); return; }
    setText(val);
    onTypingChange(val);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !session) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("session_id", session.session_id);
      fd.append("session_token", session.session_token);
      const res = await fetch(`${API}/upload`, { method: "POST", body: fd });
      if (!res.ok) throw new Error("upload failed");
      const data = await res.json();
      setPendingAttachments((prev) => [...prev, data]);
    } catch { /* silent */ } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ---------- Contact capture ----------
  const saveContact = async () => {
    if (!session) return;
    const email = emailValue.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return;
    }
    setEmailSaving(true);
    try {
      await fetch(`${API}/chat/session/${session.session_id}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_token: session.session_token,
          email,
          name: nameValue.trim() || undefined,
        }),
      });
      localStorage.setItem(CUST_EMAIL_KEY, email);
      if (nameValue.trim()) localStorage.setItem(CUST_NAME_KEY, nameValue.trim());
      setEmailSaved(true);
      setEmailPromptShown(false);
    } catch { /* ignore */ } finally {
      setEmailSaving(false);
    }
  };

  const submitCsat = async (rating) => {
    if (!session) return;
    setCsatRating(rating);
    try {
      await fetch(`${API}/chat/public/${session.session_id}/csat?session_token=${session.session_token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      setCsatSubmitted(true);
    } catch { /* ignore */ }
  };

  const endChat = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setMessages([]);
    setPhase("connecting");
    setCsatRating(0);
    setCsatSubmitted(false);
    setLilySubtitle("");
    setEmailPromptShown(false);
    bootedRef.current = false;
    // Re-bootstrap: create a new anonymous session immediately.
    bootstrap();
  };

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          data-testid="chat-launcher"
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-6 z-50 w-16 h-16 rounded-full shadow-2xl flex items-center justify-center text-white hover:scale-110 transition-transform bg-gradient-to-br from-pink-500 via-fuchsia-500 to-amber-400"
          style={{ boxShadow: "0 12px 40px -8px rgba(219, 39, 119, 0.55)" }}
          aria-label="Chat with Lily"
        >
          <div className="relative">
            <Sparkles className="w-7 h-7" strokeWidth={2.2} />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 border-2 border-white rounded-full" />
          </div>
        </button>
      )}

      {/* Window */}
      {open && (
        <div
          data-testid="chat-widget"
          className="fixed bottom-24 right-6 z-50 w-[380px] h-[640px] max-h-[88vh] bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-pink-100"
          style={{ animation: "widget-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        >
          {/* Header — always Lily branded */}
          <div
            className="px-4 py-3 flex items-center justify-between text-white bg-gradient-to-r from-pink-500 via-fuchsia-500 to-amber-400"
            data-testid="widget-header"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/25 backdrop-blur flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-sm leading-tight">Lily · Support</div>
                <div className="text-[10px] opacity-90 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                  {phase === "closed"
                    ? "Chat ended"
                    : phase === "queued"
                      ? `In queue · #${queuePosition ?? "—"}`
                      : phase === "chat"
                        ? (connected ? "Live agent" : "Reconnecting…")
                        : phase === "lily"
                          ? "AI Assistant · Online"
                          : "Connecting…"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTtsOn((v) => { if (v) cancelSpeak(); return !v; })}
                className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                title={ttsOn ? "Mute voice" : "Enable voice"}
                data-testid="lily-tts-toggle"
              >
                {ttsOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                data-testid="chat-close-btn"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Connecting */}
          {phase === "connecting" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-pink-50 via-amber-50/60 to-white" data-testid="connecting-view">
              <Loader2 className="w-8 h-8 text-pink-500 animate-spin" />
              <div className="text-sm text-slate-600">Waking Lily up…</div>
              {errorMsg && (
                <div className="text-xs text-red-600 max-w-[280px] text-center px-4" data-testid="widget-error">{errorMsg}</div>
              )}
            </div>
          )}

          {/* Lily Stage */}
          {phase === "lily" && session && (
            <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-b from-pink-50 via-amber-50/60 to-white" data-testid="lily-stage">
              {/* Stage area */}
              <div className="flex-1 overflow-y-auto flex flex-col items-center px-4 py-5">
                <LilyAvatar
                  speaking={lilySpeaking}
                  emotion={lilyLoading ? "thinking" : "greeting"}
                  size={160}
                  showLabel
                />

                <div
                  data-testid="lily-subtitle"
                  className="mt-5 w-full max-w-[300px] bg-white/95 backdrop-blur border border-pink-100 rounded-2xl px-4 py-3 text-sm text-slate-800 shadow-md min-h-[80px] leading-relaxed"
                >
                  {lilyLoading ? (
                    <span className="text-slate-400 italic flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> Lily is thinking…
                    </span>
                  ) : lilySubtitle ? (
                    <span>{lilySubtitle}</span>
                  ) : (
                    <span className="text-slate-400 italic">Lily is getting ready …</span>
                  )}
                </div>

                <button
                  onClick={() => setShowHistory((v) => !v)}
                  className="mt-3 text-[10px] font-semibold text-slate-400 hover:text-slate-700 uppercase tracking-wider"
                  data-testid="lily-history-toggle"
                >
                  {showHistory ? "Hide transcript" : "View transcript"}
                </button>
                {showHistory && (
                  <div className="mt-2 w-full space-y-2 max-h-40 overflow-y-auto pr-1" data-testid="lily-history">
                    {messages.map((m) => (
                      <div key={m.id} className={`text-[11px] ${m.sender_type === "customer" ? "text-right" : "text-left"}`}>
                        <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">{m.sender_type === "customer" ? "You" : m.sender_name}</div>
                        <div className={`inline-block px-2.5 py-1.5 rounded-lg mt-0.5 ${
                          m.sender_type === "customer"
                            ? "bg-blue-100 text-slate-800"
                            : "bg-white text-slate-700 border border-slate-200"
                        }`}>{m.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 4 fixed option buttons */}
              <div className="px-3 py-2 grid grid-cols-2 gap-2 bg-white/60 backdrop-blur border-t border-pink-100" data-testid="lily-options">
                {options.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => chooseOption(o)}
                    disabled={lilyLoading}
                    className="text-[13px] font-semibold rounded-2xl px-3 py-2.5 bg-gradient-to-br from-pink-100 to-amber-100 border border-pink-200 hover:from-pink-200 hover:to-amber-200 text-slate-700 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                    data-testid={`lily-option-${o.key}`}
                  >
                    <span className="text-base">{o.emoji}</span>
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>

              {/* Input */}
              <div className="p-3 border-t border-pink-100 bg-white">
                <div className="flex items-end gap-2">
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="Or type your question here…"
                    rows={1}
                    data-testid="chat-input"
                    className="flex-1 resize-none min-h-[40px] max-h-24 rounded-xl border-slate-200 text-sm focus-visible:ring-pink-400"
                  />
                  <Button
                    onClick={sendMessage}
                    size="icon"
                    className="rounded-xl h-10 w-10 shrink-0 text-white bg-gradient-to-br from-pink-500 to-amber-500 hover:from-pink-600 hover:to-amber-600"
                    data-testid="chat-send-btn"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Queued view */}
          {phase === "queued" && session && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center bg-gradient-to-b from-pink-50 via-amber-50/60 to-white" data-testid="queue-view">
              <LilyAvatar speaking={false} emotion="friendly" size={90} />
              <div className="mt-4 text-4xl font-extrabold text-slate-900 tracking-tight" data-testid="queue-position">
                #{queuePosition ?? "—"}
              </div>
              <div className="text-sm font-semibold text-slate-700 mt-1">You&apos;re in the queue</div>
              <div className="text-xs text-slate-500 max-w-[280px] mt-2 mb-4">
                All our agents are helping other customers. We&apos;ll connect you as soon as one is free.
              </div>
              <Clock className="w-4 h-4 text-slate-400 mb-3" />

              {/* Optional email capture while waiting */}
              {!emailSaved && (
                <div className="w-full max-w-[300px] bg-white border border-pink-100 rounded-2xl p-3 space-y-2 mt-2" data-testid="email-capture">
                  <div className="text-[11px] font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1">
                    <Mail className="w-3 h-3" /> Save your history
                  </div>
                  <div className="text-[11px] text-slate-500 leading-snug">
                    Share your email so we can pick up where we left off next time.
                  </div>
                  <Input
                    placeholder="Your name (optional)"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    className="h-8 text-xs"
                    data-testid="email-capture-name"
                  />
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={emailValue}
                    onChange={(e) => setEmailValue(e.target.value)}
                    className="h-8 text-xs"
                    data-testid="email-capture-email"
                  />
                  <Button
                    onClick={saveContact}
                    disabled={emailSaving}
                    className="w-full h-8 text-xs bg-gradient-to-r from-pink-500 to-amber-500 text-white"
                    data-testid="email-capture-save"
                  >
                    {emailSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Human chat */}
          {phase === "chat" && session && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/40" data-testid="chat-messages">
                {messages.map((m) => {
                  const isCustomer = m.sender_type === "customer";
                  const isLily = m.sender_type === "lily";
                  return (
                    <div key={m.id} className={`flex ${isCustomer ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-[85%] space-y-1.5" data-testid={`msg-${m.id}`}>
                        {(m.attachments || []).map((att, i) => (
                          <div key={i} className={isCustomer ? "flex justify-end" : ""}>
                            <AttachmentBubble
                              att={att}
                              sessionId={session.session_id}
                              sessionToken={session.session_token}
                              isCustomerSide={isCustomer}
                            />
                          </div>
                        ))}
                        {m.content && (
                          <div
                            className={`px-4 py-2.5 text-sm rounded-2xl shadow-sm ${
                              isCustomer
                                ? "text-white rounded-tr-sm bg-gradient-to-br from-pink-500 to-fuchsia-500"
                                : isLily
                                  ? "bg-white text-slate-900 rounded-tl-sm border border-pink-100 italic"
                                  : "bg-white text-slate-900 rounded-tl-sm border border-slate-100"
                            }`}
                          >
                            {isLily && <span className="text-[10px] font-bold text-pink-500 uppercase tracking-wide mr-1.5">Lily</span>}
                            {m.content}
                            {m.edited && <span className="text-[10px] opacity-70 ml-1.5 italic">(edited)</span>}
                          </div>
                        )}
                        {isCustomer && (
                          <div className="flex justify-end items-center gap-1 text-[10px] text-slate-400 pr-1">
                            {m.status === "read"
                              ? <CheckCheck className="w-3 h-3 text-blue-500" />
                              : <Check className="w-3 h-3" />}
                            <span>{m.status === "read" ? "Read" : "Sent"}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {agentTyping && <TypingDots label="Agent" />}
                {agentPreview && (
                  <div className="flex justify-start" data-testid="agent-typing-preview">
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm bg-slate-100 text-slate-500 italic border border-dashed border-slate-300">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 not-italic mr-1.5">Agent is typing:</span>
                      {agentPreview}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Inline email prompt above input (Lily-driven post-handoff) */}
              {emailPromptShown && !emailSaved && (
                <div className="px-3 py-2 bg-pink-50/70 border-t border-pink-100 flex items-center gap-2" data-testid="email-inline-prompt">
                  <Mail className="w-3.5 h-3.5 text-pink-500 shrink-0" />
                  <Input
                    type="email"
                    placeholder="Share your email (optional)"
                    value={emailValue}
                    onChange={(e) => setEmailValue(e.target.value)}
                    className="h-7 text-xs flex-1"
                    data-testid="email-inline-input"
                  />
                  <Button
                    onClick={saveContact}
                    disabled={emailSaving}
                    size="sm"
                    className="h-7 text-[11px] bg-pink-500 hover:bg-pink-600 text-white"
                    data-testid="email-inline-save"
                  >
                    Save
                  </Button>
                  <button
                    onClick={() => setEmailPromptShown(false)}
                    className="text-slate-400 hover:text-slate-700"
                    aria-label="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {pendingAttachments.length > 0 && (
                <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 flex gap-2 overflow-x-auto">
                  {pendingAttachments.map((a) => (
                    <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs">
                      {fileIcon(a.content_type)}
                      <span className="truncate max-w-[100px]">{a.filename}</span>
                      <button
                        onClick={() => setPendingAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                        className="text-slate-400 hover:text-slate-700"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="p-3 border-t border-slate-100 bg-white">
                <div className="flex items-end gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                    data-testid="chat-attach-btn"
                    disabled={uploading}
                  >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ATTACH_ACCEPT}
                    onChange={handleFile}
                    className="hidden"
                    data-testid="chat-file-input"
                  />
                  <Textarea
                    value={text}
                    onChange={(e) => handleTyping(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="Type your message…"
                    rows={1}
                    data-testid="chat-input"
                    className="flex-1 resize-none min-h-[40px] max-h-32 rounded-xl border-slate-200 text-sm focus-visible:ring-pink-400"
                  />
                  <Button
                    onClick={sendMessage}
                    size="icon"
                    className="rounded-xl h-10 w-10 shrink-0 text-white bg-gradient-to-br from-pink-500 to-fuchsia-500"
                    data-testid="chat-send-btn"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {phase === "closed" && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center bg-gradient-to-b from-pink-50 via-amber-50/60 to-white" data-testid="chat-closed-view">
              <div className="w-full mb-4 px-4 py-3 rounded-xl bg-white text-slate-700 text-sm border border-pink-100 shadow-sm" data-testid="chat-closed-banner">
                {closedNotice || "This chat has ended. Thanks for chatting with us!"}
              </div>
              {!csatSubmitted ? (
                <>
                  <h3 className="text-xl font-extrabold text-slate-900 mb-2">Rate your experience</h3>
                  <p className="text-sm text-slate-500 mb-6">How was your chat with Lily and our team?</p>
                  <div className="flex gap-2 mb-8">
                    {[1, 2, 3, 4, 5].map((r) => (
                      <button
                        key={r}
                        onClick={() => submitCsat(r)}
                        className="p-2 transition-transform hover:scale-125"
                        data-testid={`csat-star-${r}`}
                      >
                        <Star className={`w-8 h-8 ${r <= csatRating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
                    <CheckCheck className="w-8 h-8 text-emerald-600" />
                  </div>
                  <h3 className="text-xl font-extrabold text-slate-900 mb-2">Thanks for your feedback!</h3>
                  <p className="text-sm text-slate-500 mb-6">See you next time.</p>
                </>
              )}
              <Button onClick={endChat} variant="outline" data-testid="start-new-chat-btn" className="border-pink-200 text-pink-600 hover:bg-pink-50">
                Start a new chat
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
