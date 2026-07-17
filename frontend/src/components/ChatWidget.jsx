import { useEffect, useRef, useState, useCallback } from "react";
import { API, WS_BASE, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useThrottledTyping } from "@/hooks/useThrottledTyping";
import { useAutoResizeTextarea } from "@/hooks/useAutoResizeTextarea";
import LilyAvatar from "@/components/LilyAvatar";
import { speak, cancelSpeak, primeTTS } from "@/lib/tts";
import {
  MessageCircle, X, Send, Paperclip, Smile, Check, CheckCheck,
  Loader2, FileText, Image as ImageIcon, Star, Clock, UserCog, Volume2, VolumeX,
  Sparkles, XCircle, Plus, Camera, Trash2, ChevronUp, Bell, BellOff, Globe,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SUPPORTED_LANGS, getInitialLang, saveLang, tFactory } from "@/lib/i18n";

const SOUND_KEY = "pulse_sound_on";

const ATTACH_ACCEPT = ".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.zip";
const CLIENT_ID_KEY = "pulse_client_id";
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
  const [avatarClickPulse, setAvatarClickPulse] = useState(0);
  const lastGreetingRef = useRef("");
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [lang, setLang] = useState(getInitialLang);
  const [soundOn, setSoundOn] = useState(() => {
    const v = localStorage.getItem(SOUND_KEY);
    return v === null ? true : v === "1";
  });
  const t = tFactory(lang);
  const lastMsgIdRef = useRef(null);

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

  // Composer auto-resize + rich-paste preservation.
  const { ref: composerRef, onPaste: composerPaste } = useAutoResizeTextarea(text, {
    minHeight: 40, maxHeight: 180, onChange: (v) => handleTyping(v),
  });

  // Localised options list from server — re-fetch when language changes.
  useEffect(() => {
    api.get(`/lily/status?lang=${lang}`)
      .then(({ data }) => {
        setLilyEnabled(!!data.enabled);
        if (data.options) {
          const arr = Object.entries(data.options).map(([key, v]) => ({ key, ...v }));
          setOptions(arr);
        }
      })
      .catch(() => { /* keep fallbacks */ });
  }, [lang]);

  const speakLily = useCallback((textToSpeak) => {
    if (!textToSpeak) return;
    setLilySubtitle(textToSpeak);
    lastGreetingRef.current = textToSpeak;
    if (!ttsOn) return;
    setLilySpeaking(true);
    speak(textToSpeak, {
      voice: "nova",
      onEnd: () => setLilySpeaking(false),
    });
  }, [ttsOn]);

  // Click Lily's avatar → play a *different* random greeting.
  // Ignored while she's already speaking so audio never overlaps.
  const handleAvatarClick = useCallback(async () => {
    if (!session || phase !== "lily") return;
    if (lilySpeaking || lilyLoading) return; // wait until she finishes
    setAvatarClickPulse((n) => n + 1);
    try {
      const params = new URLSearchParams({
        session_id: session.session_id,
        session_token: session.session_token,
        lang,
      });
      if (lastGreetingRef.current) params.set("exclude", lastGreetingRef.current);
      const resp = await fetch(`${API}/lily/regreet?${params.toString()}`, {
        method: "POST",
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data?.message) {
        // Server broadcasts via WS; add here in case WS is momentarily slow.
        setMessages((prev) =>
          prev.find((x) => x.id === data.message.id) ? prev : [...prev, data.message],
        );
        speakLily(data.message.content);
      }
    } catch { /* silent */ }
  }, [session, phase, lilySpeaking, lilyLoading, speakLily]);

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
            if (msgs.length) lastMsgIdRef.current = msgs[msgs.length - 1].id;
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
        language: lang,
        page: window.location.href,
      });
      setSession(data);
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      setMessages([]);
      setQueuePosition(data.queue_position || null);
      setPhase("lily");

      // Open Lily immediately
      const resp = await fetch(
        `${API}/lily/open?session_id=${data.session_id}&session_token=${data.session_token}&lang=${lang}`,
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

  const playPing = useCallback(() => {
    if (!soundOn) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 780;
      gain.gain.value = 0.06;
      osc.start();
      osc.stop(ctx.currentTime + 0.14);
    } catch { /* ignore */ }
  }, [soundOn]);

  const handleWsMessage = useCallback((data) => {
    if (data.type === "message") {
      setMessages((prev) => {
        if (prev.find((m) => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
      lastMsgIdRef.current = data.message.id;
      if (data.message.sender_type === "agent") {
        setAgentTyping(false);
        setAgentPreview("");
        playPing();
      } else if (data.message.sender_type === "lily") {
        playPing();
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
      const r = data.reason;
      setClosedNotice(
        r === "inactivity"
          ? "This chat was closed due to inactivity. Start a new chat to continue."
          : r === "customer_closed"
            ? "This chat has been closed. Thank you for contacting us!"
            : "This chat has ended. Thanks for chatting with us!",
      );
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
  }, [playPing]);

  const { send, connected } = useWebSocket(wsUrl, handleWsMessage);
  sendRef.current = send;

  // Heal-on-reconnect via since_id sync: whenever the WS transitions to open,
  // ask the server to replay any messages after the last id we've seen. If we
  // have no lastMsgId yet (fresh open), we fall back to a REST fetch so we
  // start with the persisted history.
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    if (connected && !wasConnectedRef.current && session) {
      if (lastMsgIdRef.current) {
        // WS-level replay — no extra REST round-trip.
        send({ type: "sync", since_id: lastMsgIdRef.current });
      } else {
        fetch(`${API}/chat/public/${session.session_id}/messages?session_token=${session.session_token}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((msgs) => {
            if (Array.isArray(msgs)) {
              setMessages(msgs);
              if (msgs.length) lastMsgIdRef.current = msgs[msgs.length - 1].id;
            }
          })
          .catch(() => { /* ignore */ });
      }
    }
    wasConnectedRef.current = connected;
  }, [connected, session, send]);

  // ---------- Hand-off ----------
  const handoffToHuman = async (customerText) => {
    if (!session) return;
    try {
      const params = new URLSearchParams({
        session_id: session.session_id,
        session_token: session.session_token,
        lang,
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
  // (Removed) Email/name capture is intentionally disabled — anonymous client
  // identity (localStorage `pulse_client_id`) is enough for threading.

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

  // Customer-initiated close: hits our new public endpoint. The session_closed
  // WS broadcast will move us to the "closed" phase and show CSAT.
  const confirmClose = async () => {
    if (!session || closing) return;
    setClosing(true);
    try {
      await fetch(
        `${API}/chat/public/${session.session_id}/close?session_token=${session.session_token}`,
        { method: "POST" },
      );
      // Optimistic: broadcast might arrive after we already flip the phase
      setPhase("closed");
      setClosedNotice("This chat has been closed. Thank you for contacting us!");
    } catch { /* silent */ } finally {
      setClosing(false);
      setCloseConfirmOpen(false);
    }
  };

  const endChat = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setMessages([]);
    setPhase("connecting");
    setCsatRating(0);
    setCsatSubmitted(false);
    setLilySubtitle("");
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
          className="fixed bottom-24 right-6 z-50 w-16 h-16 rounded-full shadow-2xl flex items-center justify-center text-white hover:scale-110 transition-transform bg-gradient-to-br from-blue-500 to-blue-700"
          style={{ boxShadow: "0 12px 40px -8px rgba(37, 99, 235, 0.55)" }}
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
          className="fixed bottom-24 right-6 z-50 w-[380px] h-[640px] max-h-[88vh] bg-slate-900 rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-slate-800"
          style={{ animation: "widget-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        >
          {/* Header — always Lily branded */}
          <div
            className="px-4 py-3 flex items-center justify-between text-white bg-slate-950 border-b border-slate-800"
            data-testid="widget-header"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-blue-500/25 backdrop-blur flex items-center justify-center ring-1 ring-blue-400/40">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-sm leading-tight">{t("header_title")}</div>
                <div className="text-[10px] opacity-90 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                  {phase === "closed"
                    ? "Chat ended"
                    : phase === "queued"
                      ? `${t("queued_title")} · #${queuePosition ?? "—"}`
                      : phase === "chat"
                        ? (connected ? t("header_status") : t("reconnecting"))
                        : phase === "lily"
                          ? "AI Assistant · Online"
                          : "Connecting…"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {phase === "chat" && (
                <button
                  onClick={() => setCloseConfirmOpen(true)}
                  className="p-1.5 rounded-lg hover:bg-red-500/20 hover:text-red-300 transition-colors"
                  title={t("close_chat")}
                  aria-label={t("close_chat")}
                  data-testid="close-chat-btn"
                >
                  <XCircle className="w-4 h-4" />
                </button>
              )}
              {/* Language switcher */}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                    title={t("language")}
                    data-testid="lang-toggle"
                  >
                    <Globe className="w-4 h-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-40 p-1 bg-slate-900 border-slate-700 text-slate-100">
                  {SUPPORTED_LANGS.map((L) => (
                    <button
                      key={L.code}
                      onClick={() => { setLang(L.code); saveLang(L.code); }}
                      className={`w-full text-left px-2.5 py-2 rounded-md text-xs flex items-center gap-2 hover:bg-slate-800 ${lang === L.code ? "bg-slate-800" : ""}`}
                      data-testid={`lang-option-${L.code}`}
                    >
                      <span>{L.flag}</span>
                      <span className="flex-1">{L.label}</span>
                      {lang === L.code && <Check className="w-3 h-3" />}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
              {/* Sound (message ping) toggle */}
              <button
                onClick={() => setSoundOn((v) => {
                  const next = !v;
                  try { localStorage.setItem(SOUND_KEY, next ? "1" : "0"); } catch { /* ignore */ }
                  return next;
                })}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title={soundOn ? t("sound_on") : t("sound_off")}
                data-testid="sound-toggle"
              >
                {soundOn ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setTtsOn((v) => {
                  if (v) { cancelSpeak(); setLilySpeaking(false); }
                  return !v;
                })}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title={ttsOn ? t("voice_on") : t("voice_off")}
                data-testid="lily-tts-toggle"
              >
                {ttsOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                data-testid="chat-close-btn"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Connecting */}
          {phase === "connecting" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-slate-900" data-testid="connecting-view">
              <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
              <div className="text-sm text-slate-400">Waking Lily up…</div>
              {errorMsg && (
                <div className="text-xs text-red-400 max-w-[280px] text-center px-4" data-testid="widget-error">{errorMsg}</div>
              )}
            </div>
          )}

          {/* Lily Stage */}
          {phase === "lily" && session && (
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-900" data-testid="lily-stage">
              {/* Stage area */}
              <div className="flex-1 overflow-y-auto flex flex-col items-center px-4 py-5">
                <LilyAvatar
                  mode="2d"
                  speaking={lilySpeaking}
                  emotion={lilyLoading ? "thinking" : "greeting"}
                  size={160}
                  showLabel
                  onAvatarClick={handleAvatarClick}
                  clickPulse={avatarClickPulse}
                />

                <div
                  data-testid="lily-subtitle"
                  className="mt-5 w-full max-w-[300px] bg-slate-800/80 backdrop-blur border border-slate-700 rounded-2xl px-4 py-3 text-sm text-slate-100 shadow-md min-h-[80px] leading-relaxed"
                >
                  {lilyLoading ? (
                    <span className="text-slate-500 italic flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> Lily is thinking…
                    </span>
                  ) : lilySubtitle ? (
                    <span>{lilySubtitle}</span>
                  ) : (
                    <span className="text-slate-500 italic">Lily is getting ready …</span>
                  )}
                </div>

                <button
                  onClick={() => setShowHistory((v) => !v)}
                  className="mt-3 text-[10px] font-semibold text-slate-500 hover:text-slate-200 uppercase tracking-wider"
                  data-testid="lily-history-toggle"
                >
                  {showHistory ? "Hide transcript" : "View transcript"}
                </button>
                {showHistory && (
                  <div className="mt-2 w-full space-y-2 max-h-40 overflow-y-auto pr-1" data-testid="lily-history">
                    {messages.map((m) => (
                      <div key={m.id} className={`text-[11px] ${m.sender_type === "customer" ? "text-right" : "text-left"}`}>
                        <div className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">{m.sender_type === "customer" ? "You" : m.sender_name}</div>
                        <div className={`inline-block px-2.5 py-1.5 rounded-lg mt-0.5 ${
                          m.sender_type === "customer"
                            ? "bg-blue-500 text-white"
                            : "bg-slate-800 text-slate-100 border border-slate-700"
                        }`}>{m.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 4 fixed option buttons */}
              <div className="px-3 py-2 grid grid-cols-2 gap-2 bg-slate-900/70 backdrop-blur border-t border-slate-800" data-testid="lily-options">
                {options.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => chooseOption(o)}
                    disabled={lilyLoading}
                    className="text-[13px] font-semibold rounded-2xl px-3 py-2.5 bg-slate-800/60 border border-slate-700 hover:bg-slate-800 hover:border-blue-500/40 text-slate-100 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                    data-testid={`lily-option-${o.key}`}
                  >
                    <span className="text-base">{o.emoji}</span>
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>

              {/* Input */}
              <div className="p-3 border-t border-slate-800 bg-slate-900">
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
                    className="flex-1 resize-none min-h-[40px] max-h-24 rounded-xl bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500 text-sm focus-visible:ring-blue-500"
                  />
                  <Button
                    onClick={sendMessage}
                    size="icon"
                    className="rounded-xl h-10 w-10 shrink-0 text-white bg-blue-500 hover:bg-blue-600"
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
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center bg-slate-900" data-testid="queue-view">
              <LilyAvatar mode="2d" speaking={false} emotion="friendly" size={90} />
              <div className="mt-4 text-4xl font-extrabold text-slate-100 tracking-tight" data-testid="queue-position">
                #{queuePosition ?? "—"}
              </div>
              <div className="text-sm font-semibold text-slate-300 mt-1">You&apos;re in the queue</div>
              <div className="text-xs text-slate-500 max-w-[280px] mt-2 mb-4">
                All our agents are helping other customers. We&apos;ll connect you as soon as one is free.
              </div>
              <Clock className="w-4 h-4 text-slate-600 mb-3" />
            </div>
          )}

          {/* Human chat */}
          {phase === "chat" && session && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-900" data-testid="chat-messages">
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
                            className={`px-4 py-2.5 text-sm rounded-2xl shadow-sm whitespace-pre-wrap break-words ${
                              isCustomer
                                ? "text-white rounded-tr-sm bg-blue-500"
                                : isLily
                                  ? "bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700 italic"
                                  : "bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700"
                            }`}
                          >
                            {isLily && <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wide mr-1.5">Lily</span>}
                            {m.content}
                            {m.edited && <span className="text-[10px] opacity-70 ml-1.5 italic">(edited)</span>}
                          </div>
                        )}
                        {isCustomer && (
                          <div className="flex justify-end items-center gap-1 text-[10px] text-slate-500 pr-1">
                            {m.status === "read"
                              ? <CheckCheck className="w-3 h-3 text-blue-400" />
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
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm bg-slate-800/60 text-slate-400 italic border border-dashed border-slate-700">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 not-italic mr-1.5">Agent is typing:</span>
                      {agentPreview}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {pendingAttachments.length > 0 && (
                <div className="px-3 py-3 border-t border-slate-800 bg-slate-800/50 space-y-2" data-testid="attach-tray">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                      <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <Check className="w-2.5 h-2.5" />
                      </div>
                      {pendingAttachments.length} of {pendingAttachments.length} uploaded
                    </div>
                    <button
                      onClick={() => setPendingAttachments([])}
                      className="text-[11px] text-slate-500 hover:text-slate-300"
                      data-testid="attach-clear-all"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {pendingAttachments.map((a) => {
                      const isImage = a.content_type && a.content_type.startsWith("image/");
                      const url = `${API}/files/${a.id}?session_id=${session.session_id}&session_token=${session.session_token}`;
                      return (
                        <div
                          key={a.id}
                          className="relative aspect-square rounded-lg overflow-hidden border border-slate-700 bg-slate-900 group"
                          data-testid={`attach-thumb-${a.id}`}
                          title={a.filename}
                        >
                          {isImage ? (
                            <img src={url} alt={a.filename} className="w-full h-full object-cover" />
                          ) : (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-1 px-2 text-center">
                              <FileText className="w-6 h-6" />
                              <span className="text-[9px] truncate max-w-full leading-tight">{a.filename}</span>
                            </div>
                          )}
                          <button
                            onClick={() => setPendingAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/80 backdrop-blur text-red-300 hover:bg-red-500 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label={`Remove ${a.filename}`}
                            data-testid={`attach-remove-${a.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                    {/* "Add more" tile */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="aspect-square rounded-lg border-2 border-dashed border-slate-700 hover:border-blue-500/60 bg-slate-900/40 hover:bg-slate-800/60 flex items-center justify-center text-slate-500 hover:text-blue-400 transition-colors"
                      disabled={uploading}
                      data-testid="attach-add-more"
                      aria-label="Add another file"
                    >
                      {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                    </button>
                  </div>
                  <Button
                    onClick={sendMessage}
                    className="w-full h-10 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm shadow-lg shadow-blue-500/20"
                    data-testid="attach-send-btn"
                  >
                    Send {pendingAttachments.length > 1 ? "files" : "file"}
                  </Button>
                </div>
              )}

              <div className="p-3 border-t border-slate-800 bg-slate-900">
                <div className="flex items-end gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
                        data-testid="chat-attach-btn"
                        disabled={uploading}
                        aria-label="Attach"
                      >
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      align="start"
                      className="w-56 p-1.5 bg-slate-800 border-slate-700 text-slate-100 rounded-xl shadow-2xl"
                      data-testid="attach-menu"
                    >
                      <button
                        onClick={() => {
                          if (fileInputRef.current) {
                            fileInputRef.current.accept = ATTACH_ACCEPT;
                            fileInputRef.current.click();
                          }
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-slate-700/70 text-sm text-slate-100 text-left"
                        data-testid="attach-send-file"
                      >
                        <FileText className="w-4 h-4 text-blue-400" />
                        Send a file
                      </button>
                      <button
                        onClick={() => {
                          if (fileInputRef.current) {
                            fileInputRef.current.accept = "image/*";
                            fileInputRef.current.click();
                          }
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-slate-700/70 text-sm text-slate-100 text-left"
                        data-testid="attach-add-screenshot"
                      >
                        <Camera className="w-4 h-4 text-blue-400" />
                        Add screenshot
                      </button>
                    </PopoverContent>
                  </Popover>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ATTACH_ACCEPT}
                    onChange={handleFile}
                    className="hidden"
                    data-testid="chat-file-input"
                  />
                  <Textarea
                    ref={composerRef}
                    value={text}
                    onChange={(e) => handleTyping(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    onPaste={composerPaste}
                    placeholder={t("input_placeholder")}
                    rows={1}
                    data-testid="chat-input"
                    className="flex-1 resize-none min-h-[40px] rounded-xl bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500 text-sm focus-visible:ring-blue-500 leading-relaxed"
                  />
                  <Button
                    onClick={sendMessage}
                    size="icon"
                    className="rounded-xl h-10 w-10 shrink-0 text-white bg-blue-500 hover:bg-blue-600"
                    data-testid="chat-send-btn"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {phase === "closed" && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center bg-slate-900" data-testid="chat-closed-view">
              <div className="w-full mb-4 px-4 py-3 rounded-xl bg-slate-800 text-slate-200 text-sm border border-slate-700 shadow-sm" data-testid="chat-closed-banner">
                {closedNotice || "This chat has ended. Thanks for chatting with us!"}
              </div>
              {!csatSubmitted ? (
                <>
                  <h3 className="text-xl font-extrabold text-slate-100 mb-2">Rate your experience</h3>
                  <p className="text-sm text-slate-400 mb-6">How was your chat with Lily and our team?</p>
                  <div className="flex gap-2 mb-8">
                    {[1, 2, 3, 4, 5].map((r) => (
                      <button
                        key={r}
                        onClick={() => submitCsat(r)}
                        className="p-2 transition-transform hover:scale-125"
                        data-testid={`csat-star-${r}`}
                      >
                        <Star className={`w-8 h-8 ${r <= csatRating ? "fill-amber-400 text-amber-400" : "text-slate-600"}`} />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
                    <CheckCheck className="w-8 h-8 text-emerald-400" />
                  </div>
                  <h3 className="text-xl font-extrabold text-slate-100 mb-2">Thanks for your feedback!</h3>
                  <p className="text-sm text-slate-400 mb-6">See you next time.</p>
                </>
              )}
              <Button onClick={endChat} variant="outline" data-testid="start-new-chat-btn" className="border-blue-500/60 text-blue-300 hover:bg-blue-500/10 hover:text-blue-200 bg-transparent">
                Start a new chat
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Close-chat confirmation modal */}
      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent
          className="bg-slate-900 border-slate-700 text-slate-100 z-[60] rounded-2xl"
          data-testid="close-confirm-dialog"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-100">
              {t("close_confirm_title")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t("close_confirm_body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700 hover:text-white"
              data-testid="close-confirm-cancel"
            >
              {t("close_confirm_no")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmClose}
              disabled={closing}
              className="bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-500"
              data-testid="close-confirm-confirm"
            >
              {closing ? <Loader2 className="w-4 h-4 animate-spin" /> : t("close_confirm_yes")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
