import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { api, API, WS_BASE } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAgentSessions } from "@/hooks/useAgentSessions";
import { useArchiveSearch } from "@/hooks/useArchiveSearch";
import { useAgentLoad, MAX_ACTIVE_CHATS } from "@/hooks/useAgentLoad";
import { useThrottledTyping } from "@/hooks/useThrottledTyping";
import { EMOTION_LABELS } from "@/components/LilyAvatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  MessageCircle, Send, Paperclip, MoreVertical, Edit2, Trash2, X,
  Search, User, Sparkles, LogOut, Circle, Loader2, FileText, Image as ImageIcon,
  Check, CheckCheck, Volume2, VolumeX, ShieldCheck, Sun, Moon, Archive,
  Inbox, Lock, AlertTriangle, Calendar as CalendarIcon,
} from "lucide-react";

const STATUS_STYLES = {
  online: { bg: "bg-emerald-500", label: "Online" },
  busy: { bg: "bg-amber-500", label: "Busy" },
  offline: { bg: "bg-slate-400", label: "Offline" },
};

function fileIcon(ct) {
  if (ct && ct.startsWith("image/")) return <ImageIcon className="w-3.5 h-3.5" />;
  return <FileText className="w-3.5 h-3.5" />;
}
const formatTime = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const formatDate = (iso) => { try { return new Date(iso).toLocaleDateString(); } catch { return ""; } };

function AgentAttachment({ att }) {
  const token = localStorage.getItem("token");
  const url = `${API}/files/${att.id}?auth=${token}`;
  const isImage = att.content_type && att.content_type.startsWith("image/");
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={att.filename} className="rounded-lg max-w-[240px] max-h-[240px] object-cover" />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-200">
      {fileIcon(att.content_type)}
      <span className="truncate max-w-[160px]">{att.filename}</span>
    </a>
  );
}

function CapacityBadge({ count }) {
  const percent = Math.min(100, (count / MAX_ACTIVE_CHATS) * 100);
  const color = count >= MAX_ACTIVE_CHATS ? "bg-red-500" : count >= 18 ? "bg-amber-500" : "bg-emerald-500";
  const text = count >= MAX_ACTIVE_CHATS ? "text-red-600 dark:text-red-400" : count >= 18 ? "text-amber-600 dark:text-amber-400" : "text-slate-600 dark:text-slate-300";
  return (
    <div className="mt-3" data-testid="active-chat-counter">
      <div className="flex items-center justify-between text-[11px] mb-1.5">
        <span className={`font-semibold ${text}`}>Active Chats: {count}/{MAX_ACTIVE_CHATS}</span>
        {count >= MAX_ACTIVE_CHATS && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 dark:text-red-400"><Lock className="w-3 h-3" />AT CAPACITY</span>
        )}
        {count >= 18 && count < MAX_ACTIVE_CHATS && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400"><AlertTriangle className="w-3 h-3" />NEAR CAP</span>
        )}
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function AgentDashboard() {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const [status, setStatus] = useState(user?.status || "online");
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [customerTyping, setCustomerTyping] = useState({});   // sessionId -> bool
  const [customerPreview, setCustomerPreview] = useState({}); // sessionId -> preview text
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [quickReplies, setQuickReplies] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [editingMsg, setEditingMsg] = useState(null);
  const [editText, setEditText] = useState("");
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCount, setHistoryCount] = useState(0); // Bug 4: how many past sessions for this customer
  // Bug 5: track un-read customer messages per session
  const [unread, setUnread] = useState({});   // { sessionId: number }
  const selectedIdRef = useRef(null);

  const sess = useAgentSessions();
  const arch = useArchiveSearch(sess.activeTab === "archived");
  const { count: activeCount, refresh: refreshLoad } = useAgentLoad();

  const messagesEndRef = useRef(null);
  const fileRef = useRef(null);
  const sendRef = useRef(null);

  const token = localStorage.getItem("token");
  const wsUrl = token ? `${WS_BASE}/api/ws/agent?token=${token}` : null;

  const isArchivedView = sess.activeTab === "archived";
  const listSource = isArchivedView ? arch.results : sess.filtered;
  const currentSession = (isArchivedView ? arch.results : sess.sessions).find((s) => s.id === selectedId);
  const isReadOnly = isArchivedView || (currentSession && currentSession.status === "closed");

  const { onChange: onTypingChange, flushStop: flushTyping } = useThrottledTyping({
    send: (payload) => sendRef.current && sendRef.current(payload),
    buildPayload: (val, isTyping) => ({
      type: "typing", session_id: selectedId, is_typing: isTyping, content: val,
    }),
    intervalMs: 500,
    stopMs: 2000,
    enabled: !!selectedId && !isReadOnly,
  });

  const loadMessages = useCallback(async (id) => {
    try {
      const { data } = await api.get(`/chat/sessions/${id}/messages`);
      setMessages(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    api.get("/quick-replies").then(({ data }) => setQuickReplies(data)).catch(() => {});
  }, []);

  useEffect(() => {
    setSelectedId(null);
    setMessages([]);
  }, [sess.activeTab]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (selectedId) {
      loadMessages(selectedId);
      setSuggestions([]);
      // Bug 5: clear unread badge for the session we're now viewing
      setUnread((prev) => {
        if (!prev[selectedId]) return prev;
        const { [selectedId]: _drop, ...rest } = prev;
        return rest;
      });
    } else {
      setMessages([]);
      setHistoryCount(0);
    }
  }, [selectedId, loadMessages]);

  // Bug 4: passive fetch of customer's prior sessions whenever selection changes
  useEffect(() => {
    if (!currentSession?.customer_email) {
      setHistoryCount(0);
      return;
    }
    let cancelled = false;
    api.get(`/chat/history/${encodeURIComponent(currentSession.customer_email)}`)
      .then(({ data }) => {
        if (cancelled) return;
        // Exclude the current session from the "previous" count
        const others = (data || []).filter((s) => s.id !== currentSession.id);
        setHistoryCount(others.length);
      })
      .catch(() => !cancelled && setHistoryCount(0));
    return () => { cancelled = true; };
  }, [currentSession?.customer_email, currentSession?.id]);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, customerTyping[selectedId], customerPreview[selectedId]]);

  const playPing = useCallback(() => {
    if (!soundOn) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 900; gain.gain.value = 0.05;
      osc.start(); osc.stop(ctx.currentTime + 0.12);
    } catch { /* ignore */ }
  }, [soundOn]);

  const handleWs = useCallback((data) => {
    if (data.type === "message") {
      const m = data.message;
      sess.applyMessage(m);
      if (m.session_id === selectedId) {
        setMessages((prev) => (prev.find((x) => x.id === m.id) ? prev : [...prev, m]));
      }
      if (m.sender_type === "customer") {
        playPing();
        setCustomerTyping((p) => ({ ...p, [m.session_id]: false }));
        setCustomerPreview((p) => ({ ...p, [m.session_id]: "" }));
        // Bug 5: bump unread badge for any session the agent isn't viewing
        if (m.session_id !== selectedIdRef.current) {
          setUnread((prev) => ({ ...prev, [m.session_id]: (prev[m.session_id] || 0) + 1 }));
        }
      }
    } else if (data.type === "message_edited") {
      if (data.message.session_id === selectedId) {
        setMessages((prev) => prev.map((x) => (x.id === data.message.id ? data.message : x)));
      }
    } else if (data.type === "message_deleted") {
      setMessages((prev) => prev.filter((x) => x.id !== data.message_id));
    } else if (data.type === "typing") {
      if (data.sender_type === "customer") {
        setCustomerTyping((prev) => ({ ...prev, [data.session_id]: data.is_typing }));
        if (typeof data.preview === "string") {
          setCustomerPreview((prev) => ({ ...prev, [data.session_id]: data.preview }));
        }
      }
    } else if (data.type === "new_session") {
      if (!isArchivedView) {
        sess.prependSession(data.session);
        playPing();
      }
    } else if (data.type === "read_receipt") {
      if (data.session_id === selectedId) {
        setMessages((prev) => prev.map((m) => (m.sender_type === "agent" ? { ...m, status: "read" } : m)));
      }
    } else if (data.type === "session_closed") {
      sess.loadSessions();
      refreshLoad();
      sess.patchSession(data.session_id, { status: "closed", summary: data.summary });
    } else if (data.type === "emotion_update") {
      sess.patchSession(data.session_id, { current_emotion: data.emotion });
    } else if (data.type === "agent_status" && data.agent_id === user?.id) {
      setStatus(data.status);
    }
  }, [selectedId, isArchivedView, playPing, refreshLoad, sess, user?.id]);

  const { send, connected } = useWebSocket(wsUrl, handleWs);

  const changeStatus = async (newStatus) => {
    setStatus(newStatus);
    try { await api.post("/agents/status", { status: newStatus }); } catch { /* ignore */ }
  };

  const sendMessage = () => {
    if (!selectedId || isReadOnly) return;
    if (!text.trim() && pendingAttachments.length === 0) return;
    send({ type: "message", session_id: selectedId, content: text.trim(), attachments: pendingAttachments });
    setText("");
    setPendingAttachments([]);
    setSuggestions([]);
    send({ type: "typing", session_id: selectedId, is_typing: false, content: "" });
    refreshLoad();
  };

  const handleTyping = (v) => {
    setText(v);
    if (!selectedId || isReadOnly) return;
    onTypingChange(v);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || isReadOnly) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API}/upload`, {
        method: "POST", body: fd,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("upload");
      const data = await res.json();
      setPendingAttachments((prev) => [...prev, data]);
    } catch { /* ignore */ } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const editMessage = async () => {
    if (!editingMsg) return;
    try {
      await api.patch(`/chat/messages/${editingMsg.id}`, { content: editText });
      setEditingMsg(null);
      setEditText("");
    } catch { /* ignore */ }
  };

  const deleteMessage = async (id) => {
    try { await api.delete(`/chat/messages/${id}`); } catch { /* ignore */ }
  };

  const resendMessage = (m) => {
    setText(m.content);
    setPendingAttachments(m.attachments || []);
  };

  const requestSuggestions = async () => {
    if (!selectedId) return;
    setLoadingSuggest(true);
    try {
      const { data } = await api.post(`/ai/suggest/${selectedId}`);
      setSuggestions(data.suggestions || []);
    } catch { /* ignore */ } finally { setLoadingSuggest(false); }
  };

  const closeSession = async () => {
    if (!selectedId) return;
    try {
      await api.post(`/chat/sessions/${selectedId}/close`);
      sess.loadSessions();
      refreshLoad();
    } catch { /* ignore */ }
  };

  const openHistory = async () => {
    if (!currentSession) return;
    try {
      const { data } = await api.get(`/chat/history/${encodeURIComponent(currentSession.customer_email)}`);
      setHistory(data);
      setHistoryOpen(true);
    } catch { /* ignore */ }
  };

  if (user === null) return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (user === false) return <Navigate to="/login" replace />;

  return (
    <div className="h-screen w-screen grid grid-cols-1 lg:grid-cols-[300px_1fr_320px] overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* LEFT SIDEBAR */}
      <div className="border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center"><MessageCircle className="w-4 h-4 text-white" strokeWidth={2.5} /></div>
              <span className="font-extrabold text-slate-900 dark:text-slate-100">Pulse</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={toggleTheme} data-testid="theme-toggle" className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" title="Toggle theme">
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button onClick={() => setSoundOn((s) => !s)} data-testid="sound-toggle" className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              {user.role === "admin" && (
                <Link to="/admin" data-testid="link-admin" className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><ShieldCheck className="w-4 h-4" /></Link>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button data-testid="agent-menu" className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><MoreVertical className="w-4 h-4" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} data-testid="logout-menu-item"><LogOut className="w-4 h-4 mr-2" />Logout</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button data-testid="status-toggle" className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <span className={`w-2 h-2 rounded-full ${STATUS_STYLES[status].bg}`} />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{STATUS_STYLES[status].label}</span>
                <span className="text-xs text-slate-400 ml-auto truncate">{user.name}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              {Object.entries(STATUS_STYLES).map(([key, val]) => (
                <DropdownMenuItem key={key} onClick={() => changeStatus(key)} data-testid={`status-${key}`}>
                  <span className={`w-2 h-2 rounded-full ${val.bg} mr-2`} />{val.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <CapacityBadge count={activeCount} />
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 border-b border-slate-100 dark:border-slate-800">
          <button onClick={() => sess.setActiveTab("active")} data-testid="tab-active"
            className={`py-2.5 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
              sess.activeTab === "active" ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}>
            <Inbox className="w-3.5 h-3.5" /> Active
          </button>
          <button onClick={() => sess.setActiveTab("archived")} data-testid="tab-archived"
            className={`py-2.5 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
              sess.activeTab === "archived" ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}>
            <Archive className="w-3.5 h-3.5" /> Archived
          </button>
        </div>

        {isArchivedView ? (
          <div className="p-3 space-y-2 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={arch.query} onChange={(e) => arch.setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && arch.run()}
                placeholder="Search name, email, or keywords…"
                className="pl-8 h-8 rounded-lg text-xs bg-white dark:bg-slate-800 dark:border-slate-700" data-testid="archive-search-input" />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Popover>
                <PopoverTrigger asChild>
                  <button data-testid="archive-from"
                    className="h-8 text-xs rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 text-left flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600">
                    <CalendarIcon className="w-3 h-3 text-slate-400" />
                    <span className="truncate">{arch.from ? formatDate(arch.from) : "From"}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={arch.from ? new Date(arch.from) : undefined}
                    onSelect={(d) => arch.setFrom(d ? d.toISOString().slice(0, 10) : "")} initialFocus />
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <button data-testid="archive-to"
                    className="h-8 text-xs rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 text-left flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600">
                    <CalendarIcon className="w-3 h-3 text-slate-400" />
                    <span className="truncate">{arch.to ? formatDate(arch.to) : "To"}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={arch.to ? new Date(arch.to) : undefined}
                    onSelect={(d) => arch.setTo(d ? d.toISOString().slice(0, 10) : "")} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <Button size="sm" onClick={arch.run} disabled={arch.loading}
              className="w-full h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white" data-testid="archive-search-btn">
              {arch.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Search archive"}
            </Button>
          </div>
        ) : (
          <div className="p-3 border-b border-slate-100 dark:border-slate-800">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={sess.search} onChange={(e) => sess.setSearch(e.target.value)}
                placeholder="Search chats…"
                className="pl-9 h-9 rounded-lg border-slate-200 dark:border-slate-700 dark:bg-slate-800 text-sm" data-testid="session-search" />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto" data-testid="sessions-list">
          {listSource.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-400">
              {isArchivedView ? <Archive className="w-10 h-10 mx-auto mb-3 text-slate-200 dark:text-slate-700" /> : <MessageCircle className="w-10 h-10 mx-auto mb-3 text-slate-200 dark:text-slate-700" />}
              {isArchivedView ? "No archived chats match." : "No chats yet."}
            </div>
          )}
          {listSource.map((s) => (
            <button key={s.id} onClick={() => setSelectedId(s.id)} data-testid={`session-item-${s.id}`}
              className={`w-full text-left p-3 border-b border-slate-50 dark:border-slate-800 transition-colors ${
                selectedId === s.id ? "bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-50 dark:hover:bg-blue-950/40" :
                `hover:bg-slate-50 dark:hover:bg-slate-800/50 ${isArchivedView ? "bg-slate-50/40 dark:bg-slate-900/40" : ""}`
              }`}>
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 relative ${isArchivedView ? "bg-slate-400 dark:bg-slate-600" : "bg-gradient-to-br from-blue-400 to-blue-600"}`}>
                  {isArchivedView ? <Archive className="w-4 h-4" /> : (s.customer_name?.[0]?.toUpperCase() || "?")}
                  {unread[s.id] > 0 && !isArchivedView && (
                    <span
                      data-testid={`unread-badge-${s.id}`}
                      className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 border-2 border-white dark:border-slate-900 text-[9px] text-white font-bold leading-none flex items-center justify-center shadow"
                    >
                      {unread[s.id] > 9 ? "9+" : unread[s.id]}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`font-semibold text-sm truncate ${unread[s.id] > 0 && !isArchivedView ? "text-slate-900 dark:text-white" : "text-slate-900 dark:text-slate-100"}`}>{s.customer_name}</span>
                    <span className="text-[10px] text-slate-400 shrink-0 ml-2">{isArchivedView ? formatDate(s.closed_at || s.created_at) : formatTime(s.last_message_at)}</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{s.subject}</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">
                    {s.last_message?.has_attachments && "📎 "}
                    {s.last_message?.content || (isArchivedView ? (s.summary || "Archived conversation") : "New conversation")}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {s.status === "open" && !isArchivedView && (
                      <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 hover:bg-emerald-100 border-0">Open</Badge>
                    )}
                    {(s.status === "closed" || isArchivedView) && (
                      <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-100 border-0">Closed</Badge>
                    )}
                    {s.current_emotion && EMOTION_LABELS[s.current_emotion] && (
                      <Badge variant="secondary" data-testid={`emotion-badge-${s.id}`}
                        className={`text-[10px] py-0 px-1.5 h-4 border-0 hover:opacity-90 ${EMOTION_LABELS[s.current_emotion].color}`}>
                        {EMOTION_LABELS[s.current_emotion].emoji} {EMOTION_LABELS[s.current_emotion].label}
                      </Badge>
                    )}
                    {customerTyping[s.id] && <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">typing…</span>}
                    {s.csat_rating && <span className="text-[10px] text-amber-500">{"★".repeat(s.csat_rating)}</span>}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="p-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 flex items-center gap-1.5">
          <Circle className={`w-2 h-2 ${connected ? "text-emerald-500 fill-emerald-500" : "text-slate-300 fill-slate-300"}`} />
          {connected ? "Real-time connected" : "Reconnecting…"}
        </div>
      </div>

      {/* MAIN */}
      <div className="bg-white dark:bg-slate-900 flex flex-col h-full overflow-hidden">
        {!currentSession ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center mb-4">
              {isArchivedView ? <Archive className="w-8 h-8 text-blue-600" /> : <MessageCircle className="w-8 h-8 text-blue-600" strokeWidth={2} />}
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight mb-2">
              {isArchivedView ? "Browse the archive" : "Select a conversation"}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
              {isArchivedView ? "Search past conversations by keyword, customer, or date range." : "Pick a chat from the list to start replying."}
            </p>
          </div>
        ) : (
          <>
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-slate-900 dark:text-slate-100">{currentSession.customer_name}</h2>
                  {currentSession.status === "closed" && (
                    <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" data-testid="chat-closed-badge">
                      <Lock className="w-2.5 h-2.5 mr-1" /> Closed
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span>{currentSession.subject}</span>
                  {!isReadOnly && customerTyping[selectedId] && <span className="text-blue-600 dark:text-blue-400 font-medium">• typing…</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={openHistory} data-testid="history-btn">History</Button>
                {currentSession.status === "open" && !isArchivedView && (
                  <Button variant="outline" size="sm" onClick={closeSession} data-testid="close-session-btn">Close Chat</Button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-slate-50/30 dark:bg-slate-950/50" data-testid="messages-container">
              {messages.map((m) => {
                const isAgent = m.sender_type === "agent";
                const isMine = isAgent && m.sender_id === user.id;
                return (
                  <div key={m.id} className={`flex ${isAgent ? "justify-end" : "justify-start"} group`}>
                    <div className={`max-w-[70%] space-y-1.5 ${isAgent ? "items-end" : "items-start"}`} data-testid={`agent-msg-${m.id}`}>
                      {!isAgent && <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 px-1 uppercase tracking-wider">{m.sender_name}</div>}
                      {(m.attachments || []).map((att, i) => (
                        <div key={i} className={isAgent ? "flex justify-end" : ""}><AgentAttachment att={att} /></div>
                      ))}
                      <div className="flex items-center gap-2">
                        {isMine && !isReadOnly && (
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                            <button onClick={() => { setEditingMsg(m); setEditText(m.content); }} data-testid={`edit-msg-${m.id}`} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><Edit2 className="w-3 h-3" /></button>
                            <button onClick={() => resendMessage(m)} data-testid={`resend-msg-${m.id}`} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-semibold">Resend</button>
                            <button onClick={() => deleteMessage(m.id)} data-testid={`delete-msg-${m.id}`} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
                          </div>
                        )}
                        {m.content && (
                          <div className={`px-4 py-2.5 text-sm rounded-2xl shadow-sm ${
                            isAgent ? "bg-blue-600 text-white rounded-tr-sm"
                                    : "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-sm border border-slate-100 dark:border-slate-700"
                          }`}>
                            {m.content}
                            {m.edited && <span className="text-[10px] opacity-70 ml-1.5 italic">(edited)</span>}
                          </div>
                        )}
                      </div>
                      <div className={`flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 ${isAgent ? "justify-end" : ""}`}>
                        <span>{formatTime(m.created_at)}</span>
                        {isAgent && (m.status === "read" ? <CheckCheck className="w-3 h-3 text-blue-500" /> : <Check className="w-3 h-3" />)}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!isReadOnly && customerTyping[selectedId] && (
                <div className="flex items-center gap-2 px-4 py-2">
                  <div className="flex space-x-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Customer is typing…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {!isReadOnly && customerPreview[selectedId] && (
              <div className="px-6 py-2 border-t border-blue-100 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/30" data-testid="typing-preview">
                <div className="flex items-start gap-2">
                  <Sparkles className="w-3 h-3 text-blue-500 mt-1 shrink-0" />
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-bold text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400 mr-1.5">Customer is typing:</span>
                    <span className="italic">{customerPreview[selectedId]}</span>
                  </div>
                </div>
              </div>
            )}

            {!isReadOnly && suggestions.length > 0 && (
              <div className="px-6 py-2 border-t border-slate-100 dark:border-slate-800 bg-gradient-to-r from-blue-50/50 to-purple-50/50 dark:from-blue-950/20 dark:to-purple-950/20">
                <div className="flex items-center gap-2 mb-1.5">
                  <Sparkles className="w-3 h-3 text-blue-600" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">AI Suggestions</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s, i) => (
                    <button key={i} onClick={() => { setText(s); setSuggestions([]); }} data-testid={`ai-suggestion-${i}`}
                      className="text-xs bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-800 text-slate-700 dark:text-slate-200 rounded-full px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors max-w-full text-left">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!isReadOnly && pendingAttachments.length > 0 && (
              <div className="px-6 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-2 overflow-x-auto">
                {pendingAttachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs">
                    {fileIcon(a.content_type)}
                    <span className="truncate max-w-[120px] dark:text-slate-200">{a.filename}</span>
                    <button onClick={() => setPendingAttachments((prev) => prev.filter((x) => x.id !== a.id))} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}

            {isReadOnly ? (
              <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-center" data-testid="readonly-banner">
                <div className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Lock className="w-4 h-4" />
                  {isArchivedView ? "Archived conversation — read only." : "This chat is closed."}
                </div>
              </div>
            ) : (
              <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                {quickReplies.length > 0 && (
                  <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1" data-testid="quick-replies">
                    {quickReplies.slice(0, 6).map((q) => (
                      <button key={q.id} onClick={() => setText(q.content)} data-testid={`quick-reply-${q.id}`}
                        className="text-[11px] font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-full px-2.5 py-1 whitespace-nowrap border border-blue-100 dark:border-blue-900 transition-colors">
                        {q.title}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="agent-attach-btn"
                    className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                  </button>
                  <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.zip" onChange={handleFile} className="hidden" />
                  <button onClick={requestSuggestions} disabled={loadingSuggest} data-testid="ai-suggest-btn" title="AI reply suggestions"
                    className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors">
                    {loadingSuggest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  </button>
                  <Textarea value={text} onChange={(e) => handleTyping(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Type your reply…" rows={1} data-testid="agent-input"
                    className="flex-1 resize-none min-h-[42px] max-h-32 rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 text-sm focus-visible:ring-blue-500" />
                  <Button onClick={sendMessage} data-testid="agent-send-btn"
                    className="rounded-xl h-10 w-10 p-0 bg-blue-600 hover:bg-blue-700 text-white shrink-0">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* RIGHT SIDEBAR */}
      <div className="hidden lg:block border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-col h-full overflow-y-auto">
        {currentSession ? (
          <div className="p-6 space-y-6">
            <div className="text-center">
              <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center text-white font-bold text-2xl mb-3 shadow-lg ${isArchivedView ? "bg-slate-400 dark:bg-slate-600 shadow-slate-500/20" : "bg-gradient-to-br from-blue-400 to-blue-600 shadow-blue-600/20"}`}>
                {currentSession.customer_name?.[0]?.toUpperCase()}
              </div>
              <div className="font-bold text-slate-900 dark:text-slate-100">{currentSession.customer_name}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{currentSession.customer_email}</div>
              {historyCount > 0 && (
                <button
                  onClick={openHistory}
                  data-testid="returning-customer-badge"
                  className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[11px] font-semibold border border-amber-200 dark:border-amber-900 hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  Returning customer · {historyCount} previous {historyCount === 1 ? "chat" : "chats"}
                </button>
              )}
            </div>
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Details</div>
              <div className="text-xs">
                <Row label="Subject" value={currentSession.subject} />
                <Row label="Location" value={currentSession.location || "—"} />
                <Row label="IP" value={currentSession.creator_ip || "—"} />
                <Row label="Started" value={formatTime(currentSession.created_at)} />
                {currentSession.closed_at && <Row label="Closed" value={formatDate(currentSession.closed_at)} />}
                {currentSession.duration_seconds != null && <Row label="Duration" value={`${Math.round(currentSession.duration_seconds / 60)} min`} />}
                {currentSession.agent_name && <Row label="Handled by" value={currentSession.agent_name} />}
                {currentSession.message_count != null && <Row label="Messages" value={String(currentSession.message_count)} />}
                <div className="py-1.5 border-b border-slate-50 dark:border-slate-800">
                  <div className="text-slate-500 dark:text-slate-400 mb-1">Page</div>
                  <div className="text-slate-900 dark:text-slate-100 font-medium text-[11px] break-all">{currentSession.page || "—"}</div>
                </div>
                {currentSession.csat_rating && (
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-500 dark:text-slate-400">Rating</span>
                    <span className="text-amber-500 font-bold">{"★".repeat(currentSession.csat_rating)}</span>
                  </div>
                )}
              </div>
            </div>
            {currentSession.summary && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3" /> AI Summary</div>
                <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-blue-50/50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 rounded-lg p-3">{currentSession.summary}</div>
              </div>
            )}

            <CustomerMemoryPanel email={currentSession.customer_email} />
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-slate-400">
            <User className="w-10 h-10 mx-auto mb-3 text-slate-200 dark:text-slate-700" />
            Customer details will appear here.
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingMsg} onOpenChange={(o) => !o && setEditingMsg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit message</DialogTitle></DialogHeader>
          <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} data-testid="edit-message-input" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingMsg(null)}>Cancel</Button>
            <Button onClick={editMessage} className="bg-blue-600 hover:bg-blue-700" data-testid="save-edit-btn">Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* History dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Past conversations{currentSession ? ` with ${currentSession.customer_name}` : ""}</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {history.length === 0 && <div className="text-sm text-slate-500 py-8 text-center">No past conversations.</div>}
            {history.map((h) => (
              <button key={h.id} onClick={() => { setSelectedId(h.id); setHistoryOpen(false); }}
                className="w-full text-left p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">{h.subject}</span>
                  <span className="text-xs text-slate-400">{formatDate(h.created_at)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">{h.status}</Badge>
                  {h.csat_rating && <span className="text-amber-500">{"★".repeat(h.csat_rating)}</span>}
                </div>
                {h.summary && <div className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 line-clamp-2">{h.summary}</div>}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-slate-50 dark:border-slate-800">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-slate-900 dark:text-slate-100 font-medium text-right max-w-[180px] truncate">{value}</span>
    </div>
  );
}

function CustomerMemoryPanel({ email }) {
  const [mem, setMem] = useState(null);
  useEffect(() => {
    if (!email) return;
    api.get(`/lily/memory?email=${encodeURIComponent(email)}`).then(({ data }) => setMem(data)).catch(() => setMem(null));
  }, [email]);
  if (!mem || !mem.email) return null;
  const emo = mem.emotion_history || [];
  const counts = emo.reduce((acc, e) => ((acc[e.emotion] = (acc[e.emotion] || 0) + 1), acc), {});
  return (
    <div data-testid="customer-memory-panel">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1">
        <span>🧠</span> Lily 记忆
      </div>
      <div className="text-xs space-y-2 bg-pink-50/40 dark:bg-pink-950/20 border border-pink-100 dark:border-pink-900/40 rounded-lg p-3">
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">来访次数</span>
          <span className="font-semibold">{mem.session_count || 1}</span>
        </div>
        {mem.past_issues?.length > 0 && (
          <div>
            <div className="text-slate-500 dark:text-slate-400 mb-1">最近问过</div>
            <ul className="space-y-0.5">
              {mem.past_issues.slice(-3).map((i, idx) => (
                <li key={idx} className="text-slate-700 dark:text-slate-300 truncate">• {i.text}</li>
              ))}
            </ul>
          </div>
        )}
        {mem.past_complaints?.length > 0 && (
          <div className="text-rose-600 dark:text-rose-400 font-semibold">⚠️ 历史投诉 {mem.past_complaints.length} 次</div>
        )}
        {Object.keys(counts).length > 0 && (
          <div>
            <div className="text-slate-500 dark:text-slate-400 mb-1">情绪分布</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(counts).map(([k, v]) => (
                EMOTION_LABELS[k] && (
                  <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded-full ${EMOTION_LABELS[k].color}`}>
                    {EMOTION_LABELS[k].emoji} {v}
                  </span>
                )
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
