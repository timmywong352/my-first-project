import { useEffect, useRef, useState, useCallback } from "react";
import { API, WS_BASE, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useThrottledTyping } from "@/hooks/useThrottledTyping";
import LilyAvatar from "@/components/LilyAvatar";
import { speak, cancelSpeak } from "@/lib/tts";

// Fixed 4 option buttons — always visible during Lily stage
const LILY_ALL_OPTIONS = [
  { key: "query_recharge",   label: "查询充值状态", emoji: "💳" },
  { key: "query_withdrawal", label: "查询提现状态", emoji: "💰" },
  { key: "view_promotions",  label: "查看优惠活动", emoji: "🎁" },
  { key: "query_ticket",     label: "查询工单状态", emoji: "📋" },
];
import {
  MessageCircle, X, Send, Paperclip, Smile, Check, CheckCheck,
  Loader2, FileText, Image as ImageIcon, Star, Clock, UserCog, Volume2, VolumeX,
} from "lucide-react";

const ATTACH_ACCEPT = ".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.zip";

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
  const [phase, setPhase] = useState("prechat"); // prechat | chat | closed
  const [settings, setSettings] = useState({
    widget_color: "#0057FF",
    welcome_message: "Hi there! 👋 How can we help you today?",
  });
  const [form, setForm] = useState({ name: "", email: "", subject: "" });
  const [formErr, setFormErr] = useState("");
  const [starting, setStarting] = useState(false);

  const [session, setSession] = useState(null); // { session_id, session_token, ... }
  const [queuePosition, setQueuePosition] = useState(null); // number or null
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [agentTyping, setAgentTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [csatRating, setCsatRating] = useState(0);
  const [csatSubmitted, setCsatSubmitted] = useState(false);
  const [closedNotice, setClosedNotice] = useState("");
  const [agentPreview, setAgentPreview] = useState("");
  const [lilyEnabled, setLilyEnabled] = useState(false);
  const [lilyEmotion, setLilyEmotion] = useState("neutral");
  const [lilySpeaking, setLilySpeaking] = useState(false);
  const [lilyLoading, setLilyLoading] = useState(false);
  const [lilyOptions, setLilyOptions] = useState([]);
  const [ttsOn, setTtsOn] = useState(true);
  const [lilyMode, setLilyMode] = useState(false); // true when in Lily chat (not yet human)
  const [lilySubtitle, setLilySubtitle] = useState(""); // What Lily is currently saying
  const [showHistory, setShowHistory] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const { onChange: onTypingChange, flushStop: flushTyping } = useThrottledTyping({
    send: (payload) => sendRef.current?.(payload),
    buildPayload: (val, isTyping) => ({ type: "typing", is_typing: isTyping, content: val }),
    intervalMs: 500,
    stopMs: 2000,
    enabled: phase === "chat",
  });
  const sendRef = useRef(null);

  useEffect(() => {
    api.get("/public/settings").then(({ data }) => setSettings(data)).catch(() => {});
    api.get("/lily/status").then(({ data }) => setLilyEnabled(!!data.enabled)).catch(() => setLilyEnabled(false));
  }, []);

  // Speak Lily's messages via TTS and show subtitle simultaneously
  const speakLily = useCallback((text) => {
    if (!text) return;
    setLilySubtitle(text);
    if (!ttsOn) return;
    setLilySpeaking(true);
    speak(text, {
      onEnd: () => setLilySpeaking(false),
    });
  }, [ttsOn]);

  // Persist session
  useEffect(() => {
    const raw = localStorage.getItem("customer_session");
    if (raw) {
      try {
        const s = JSON.parse(raw);
        if (s && s.session_id) {
          setSession(s);
          setQueuePosition(s.queue_position || null);
          setPhase(s.status === "queued" ? "queued" : "chat");
          // Load history
          fetch(`${API}/chat/public/${s.session_id}/messages?session_token=${s.session_token}`)
            .then((r) => r.ok ? r.json() : [])
            .then((msgs) => setMessages(msgs))
            .catch(() => {});
        }
      } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, agentTyping]);

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
        // Optional: play a sound
        try {
          const audio = new Audio("data:audio/wav;base64,UklGRnQBAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YVABAAB6/3v/e/97/3v/e/97/3v/e/98/3z/fP98/3z/fP99/33/ff99/33/fv9+/37/fv9+/3//f/9//3//f/9//4D/gP+A/4D/gP+A/4H/gf+B/4H/gf+B/4L/gv+C/4L/gv+D/4P/g/+D/4P/g/+E/4T/hP+E/4T/hP+F/4X/hf+F/4X/hf+G/4b/hv+G/4b/hv+H/4f/h/+H/4f/h/+I/4j/iP+I/4j/if+J/4n/if+J/4n/if+K/4r/iv+K/4r/iv+L/4v/i/+L/4v/i/+M/4z/jP+M/4z/jf+N/43/jf+N/43/jf+O/47/jv+O/47/jv+P/4//j/+P/4//j/+Q/5D/kP+Q/5D/kf+R/5H/kf+R/5H/kf+S/5L/kv+S/5L/kv+T/5P/k/+T/5P/lP+U/5T/lP+U/5T/lf+V/5X/lf+V/5U=");
          audio.volume = 0.3;
          audio.play().catch(() => {});
        } catch { /* ignore */ }
      }
    } else if (data.type === "message_edited") {
      setMessages((prev) => prev.map((m) => (m.id === data.message.id ? data.message : m)));
    } else if (data.type === "message_deleted") {
      setMessages((prev) => prev.filter((m) => m.id !== data.message_id));
    } else if (data.type === "typing") {
      if (data.sender_type === "agent") {
        setAgentTyping(data.is_typing);
        if (typeof data.preview === "string") {
          setAgentPreview(data.preview);
        }
      }
    } else if (data.type === "read_receipt") {
      setMessages((prev) => prev.map((m) => (m.sender_type === "customer" ? { ...m, status: "read" } : m)));
    } else if (data.type === "session_closed") {
      setPhase("closed");
      setClosedNotice(data.reason === "inactivity"
        ? "This chat was closed due to inactivity. Start a new chat to continue."
        : "This chat has ended. Start a new chat to continue.");
    } else if (data.type === "queue_promoted") {
      setQueuePosition(null);
      setPhase("chat");
    } else if (data.type === "queue_update") {
      setQueuePosition(data.position);
    } else if (data.type === "error") {
      if (data.code === "session_closed") {
        setPhase("closed");
        setClosedNotice(data.message || "This chat has ended. Start a new chat to continue.");
      }
    }
  }, []);

  const { send, connected } = useWebSocket(wsUrl, handleWsMessage);
  sendRef.current = send;

  const startChat = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.subject) {
      setFormErr("Please fill in all fields.");
      return;
    }
    setFormErr("");
    setStarting(true);
    try {
      const { data } = await api.post("/chat/session", {
        ...form,
        page: window.location.href,
      });
      setSession(data);
      localStorage.setItem("customer_session", JSON.stringify(data));
      setMessages([]);
      setQueuePosition(data.queue_position || null);
      // Route into Lily if enabled AND session was assigned to an agent (not queued)
      // Lily engages first regardless of queue: if enabled, we always show Lily.
      if (lilyEnabled) {
        setPhase("chat");
        setLilyMode(true);
        // Open Lily
        try {
          const resp = await fetch(
            `${API}/lily/open?session_id=${data.session_id}&session_token=${data.session_token}`,
            { method: "POST" },
          );
          const r = await resp.json();
          if (r?.message) {
            setMessages((prev) => [...prev, r.message]);
            speakLily(r.message.content);
          }
        } catch { /* ignore */ }
      } else if (data.status === "queued") {
        setPhase("queued");
      } else {
        setPhase("chat");
      }
    } catch (err) {
      if (err.response?.status === 429) {
        setFormErr(err.response.data.detail || "Too many chats started. Try again later.");
      } else {
        setFormErr("Couldn't start chat. Please try again.");
      }
    } finally {
      setStarting(false);
    }
  };

  const sendMessage = async () => {
    if (phase !== "chat") return;
    if (!text.trim() && pendingAttachments.length === 0) return;

    if (lilyMode) {
      // Send through Lily
      const userText = text.trim();
      setText("");
      setPendingAttachments([]);
      flushTyping("");
      setLilyLoading(true);
      setLilyOptions([]);
      try {
        const url = `${API}/lily/reply?session_id=${session.session_id}&session_token=${session.session_token}&text=${encodeURIComponent(userText)}`;
        const resp = await fetch(url, { method: "POST" });
        const data = await resp.json();
        if (data?.message) {
          // Cust msg was already broadcast via WS; Lily reply will arrive via WS too.
          // But in case WS is slow, manually add:
          setMessages((prev) => (prev.find((x) => x.id === data.message.id) ? prev : [...prev, data.message]));
          setLilyEmotion(data.emotion || "neutral");
          setLilyOptions(data.options || []);
          speakLily(data.message.content);
        }
        if (data?.escalate) {
          // Auto-handoff to human queue
          await handoffToHuman();
        }
      } catch { /* ignore */ } finally {
        setLilyLoading(false);
      }
    } else {
      // Talking to a human agent via WebSocket
      send({ type: "message", content: text.trim(), attachments: pendingAttachments });
      setText("");
      setPendingAttachments([]);
      flushTyping("");
    }
  };

  const handoffToHuman = async () => {
    if (!session) return;
    try {
      const resp = await fetch(
        `${API}/lily/handoff?session_id=${session.session_id}&session_token=${session.session_token}`,
        { method: "POST" },
      );
      const data = await resp.json();
      setLilyMode(false);
      setLilyOptions([]);
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

  const chooseLilyOption = async (opt) => {
    // Send option label as a customer message via Lily flow
    const oldText = text;
    setText(opt.label);
    setTimeout(() => {
      setText(oldText);
      // Send directly
      const userText = opt.label;
      setLilyLoading(true);
      setLilyOptions([]);
      fetch(
        `${API}/lily/reply?session_id=${session.session_id}&session_token=${session.session_token}&text=${encodeURIComponent(userText)}`,
        { method: "POST" }
      ).then((r) => r.json()).then((data) => {
        if (data?.message) {
          setMessages((prev) => (prev.find((x) => x.id === data.message.id) ? prev : [...prev, data.message]));
          setLilyEmotion(data.emotion || "neutral");
          setLilyOptions(data.options || []);
          speakLily(data.message.content);
        }
        if (data?.escalate) handoffToHuman();
      }).finally(() => setLilyLoading(false));
    }, 0);
  };

  const handleTyping = (val) => {
    if (phase !== "chat") return;
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
    } catch {
      /* silent */
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
    localStorage.removeItem("customer_session");
    setSession(null);
    setMessages([]);
    setPhase("prechat");
    setForm({ name: "", email: "", subject: "" });
    setCsatRating(0);
    setCsatSubmitted(false);
  };

  const color = settings.widget_color || "#0057FF";

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          data-testid="chat-launcher"
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-6 z-50 w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white hover:scale-110 transition-transform"
          style={{ backgroundColor: color, boxShadow: `0 10px 30px -5px ${color}66` }}
          aria-label="Open chat"
        >
          <div className="relative">
            <MessageCircle className="w-6 h-6" strokeWidth={2.5} />
            <Smile className="w-3 h-3 absolute -top-1 -right-1 text-white" />
          </div>
        </button>
      )}

      {/* Window */}
      {open && (
        <div
          data-testid="chat-widget"
          className="fixed bottom-24 right-6 z-50 w-[360px] h-[600px] max-h-[85vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-slate-100"
          style={{ animation: "widget-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        >
          {/* Header */}
          <div
            className="p-4 flex items-center justify-between text-white"
            style={{ backgroundColor: color }}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                <Smile className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-sm">Chat Support</div>
                <div className="text-xs opacity-90 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {connected || phase === "prechat" ? "We’re online" : "Reconnecting…"}
                </div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors" data-testid="chat-close-btn">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          {phase === "prechat" && (
            <div className="flex-1 overflow-y-auto p-6 bg-gradient-to-b from-blue-50/50 to-white">
              <div className="mb-6">
                <div className="text-2xl font-extrabold text-slate-900 tracking-tight leading-snug">
                  {settings.welcome_message || "Hi there! 👋"}
                </div>
                <div className="text-sm text-slate-500 mt-2">Tell us about yourself and we&rsquo;ll get right back to you.</div>
              </div>
              <form onSubmit={startChat} className="space-y-3">
                <div>
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Jane Doe"
                    required
                    data-testid="prechat-name"
                    className="mt-1 h-11 rounded-xl border-slate-200"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="jane@company.com"
                    required
                    data-testid="prechat-email"
                    className="mt-1 h-11 rounded-xl border-slate-200"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Subject</Label>
                  <Input
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    placeholder="I need help with…"
                    required
                    data-testid="prechat-subject"
                    className="mt-1 h-11 rounded-xl border-slate-200"
                  />
                </div>
                {formErr && <div className="text-xs text-red-600">{formErr}</div>}
                <Button
                  type="submit"
                  data-testid="prechat-start-btn"
                  disabled={starting}
                  className="w-full h-11 rounded-xl font-semibold text-white"
                  style={{ backgroundColor: color }}
                >
                  {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Start Chatting →"}
                </Button>
              </form>
            </div>
          )}

          {phase === "queued" && session && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center bg-gradient-to-b from-blue-50/50 to-white" data-testid="queue-view">
              <div className="w-16 h-16 rounded-2xl bg-blue-100 flex items-center justify-center mb-4">
                <Clock className="w-8 h-8 text-blue-600" />
              </div>
              <div className="text-4xl font-extrabold text-slate-900 tracking-tight mb-2" data-testid="queue-position">
                #{queuePosition || "—"}
              </div>
              <div className="text-sm font-semibold text-slate-700 mb-1">You&rsquo;re in the queue</div>
              <div className="text-xs text-slate-500 max-w-[240px] mb-6">
                All our agents are busy right now. We&rsquo;ll connect you as soon as one is free — usually just a few minutes.
              </div>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest">Position updates in real time</div>
            </div>
          )}

          {/* LILY STAGE — video-call style (avatar + subtitle + fixed options + input) */}
          {phase === "chat" && session && lilyMode && (
            <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-b from-pink-50 via-amber-50/60 to-white" data-testid="lily-stage">
              {/* Top bar */}
              <div className="px-4 py-2 flex items-center justify-between border-b border-pink-100/70 bg-white/50 backdrop-blur">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Lily · AI 数字客服
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowHistory((v) => !v)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-white/70 text-[10px] font-semibold"
                    data-testid="lily-history-toggle"
                  >
                    {showHistory ? "隐藏记录" : "查看记录"}
                  </button>
                  <button
                    onClick={() => setTtsOn((v) => { if (v) cancelSpeak(); return !v; })}
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-white/70"
                    title="开/关语音"
                    data-testid="lily-tts-toggle"
                  >
                    {ttsOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={handoffToHuman}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 px-2 py-1 rounded-lg hover:bg-white/70"
                    data-testid="lily-handoff-btn"
                  >
                    <UserCog className="w-3 h-3 inline mr-1" /> 转人工
                  </button>
                </div>
              </div>

              {/* Stage area */}
              <div className="flex-1 overflow-y-auto flex flex-col items-center px-4 py-5">
                {/* Big avatar */}
                <LilyAvatar
                  emotion={lilyEmotion}
                  speaking={lilySpeaking}
                  size={140}
                  showLabel
                />

                {/* Subtitle bubble */}
                <div
                  data-testid="lily-subtitle"
                  className="mt-5 w-full max-w-[280px] bg-white/90 backdrop-blur border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-800 shadow-md min-h-[70px] leading-relaxed"
                >
                  {lilyLoading ? (
                    <span className="text-slate-400 italic flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> Lily 正在思考…
                    </span>
                  ) : lilySubtitle ? (
                    <span>{lilySubtitle}</span>
                  ) : (
                    <span className="text-slate-400 italic">Lily 准备就绪 …</span>
                  )}
                </div>

                {/* Collapsible chat history */}
                {showHistory && (
                  <div className="mt-4 w-full space-y-2 max-h-40 overflow-y-auto pr-1" data-testid="lily-history">
                    {messages.map((m) => (
                      <div key={m.id} className={`text-[11px] ${m.sender_type === "customer" ? "text-right" : "text-left"}`}>
                        <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">{m.sender_type === "customer" ? "您" : m.sender_name}</div>
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

              {/* Fixed 4 option buttons — always visible */}
              <div className="px-3 py-2 grid grid-cols-2 gap-2 bg-white/60 backdrop-blur border-t border-pink-100" data-testid="lily-options">
                {LILY_ALL_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => chooseLilyOption(o)}
                    disabled={lilyLoading}
                    className="text-[13px] font-semibold rounded-2xl px-3 py-2.5 bg-gradient-to-br from-pink-100 to-amber-100 border border-pink-200 hover:from-pink-200 hover:to-amber-200 text-slate-700 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                    data-testid={`lily-option-${o.key}`}
                  >
                    <span className="text-base">{o.emoji}</span>
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>

              {/* Text input */}
              <div className="p-3 border-t border-slate-100 bg-white">
                <div className="flex items-end gap-2">
                  <Textarea
                    value={text}
                    onChange={(e) => handleTyping(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="也可以直接打字告诉 Lily…"
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

          {/* HUMAN AGENT CHAT (Lily disabled or after handoff) */}
          {phase === "chat" && session && !lilyMode && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30" data-testid="chat-messages">
                {messages.map((m) => {
                  const isCustomer = m.sender_type === "customer";
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
                                ? "text-white rounded-tr-sm"
                                : "bg-white text-slate-900 rounded-tl-sm border border-slate-100"
                            }`}
                            style={isCustomer ? { backgroundColor: color } : {}}
                          >
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

              {/* Pending attachments preview */}
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

              {/* Lily option buttons */}
              {lilyMode && lilyOptions.length > 0 && (
                <div className="px-3 py-2 border-t border-slate-100 bg-white flex flex-wrap gap-1.5" data-testid="lily-options">
                  {lilyOptions.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => chooseLilyOption(o)}
                      className="text-xs font-semibold rounded-full px-3 py-1.5 border transition-colors bg-gradient-to-r from-pink-50 to-amber-50 border-pink-200 text-slate-700 hover:from-pink-100 hover:to-amber-100"
                      data-testid={`lily-option-${o.key}`}
                    >
                      <span className="mr-1">{o.emoji}</span>
                      {o.label}
                    </button>
                  ))}
                </div>
              )}

              {lilyMode && lilyLoading && (
                <div className="px-4 py-1 flex items-center gap-2 text-[11px] text-slate-400 border-t border-slate-100 bg-white">
                  <Loader2 className="w-3 h-3 animate-spin" /> Lily 正在思考…
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
                    className="flex-1 resize-none min-h-[40px] max-h-32 rounded-xl border-slate-200 text-sm focus-visible:ring-blue-500"
                  />
                  <Button
                    onClick={sendMessage}
                    size="icon"
                    className="rounded-xl h-10 w-10 shrink-0 text-white"
                    style={{ backgroundColor: color }}
                    data-testid="chat-send-btn"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}

          {phase === "closed" && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center" data-testid="chat-closed-view">
              <div className="w-full mb-4 px-4 py-3 rounded-xl bg-slate-100 text-slate-700 text-sm border border-slate-200" data-testid="chat-closed-banner">
                {closedNotice || "This chat has ended. Start a new chat to continue."}
              </div>
              {!csatSubmitted ? (
                <>
                  <h3 className="text-xl font-extrabold text-slate-900 mb-2">Rate your experience</h3>
                  <p className="text-sm text-slate-500 mb-6">How was your chat with us today?</p>
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
                  <p className="text-sm text-slate-500 mb-6">We appreciate you taking the time to rate us.</p>
                </>
              )}
              <Button onClick={endChat} variant="outline" data-testid="start-new-chat-btn">Start a new chat</Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
