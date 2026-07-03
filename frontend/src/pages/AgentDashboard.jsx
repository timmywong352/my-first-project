import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { api, API, WS_BASE } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  MessageCircle, Send, Paperclip, MoreVertical, Edit2, Trash2, X,
  Search, User, Sparkles, LogOut, Circle, Loader2, FileText, Image as ImageIcon,
  Check, CheckCheck, Volume2, VolumeX, ShieldCheck, Sun, Moon, Archive,
  Inbox, Lock, AlertTriangle, Calendar,
} from "lucide-react";

const STATUS_STYLES = {
  online: { bg: "bg-emerald-500", label: "Online" },
  busy: { bg: "bg-amber-500", label: "Busy" },
  offline: { bg: "bg-slate-400", label: "Offline" },
};
const MAX_ACTIVE = 20;

function fileIcon(ct) {
  if (ct && ct.startsWith("image/")) return <ImageIcon className="w-3.5 h-3.5" />;
  return <FileText className="w-3.5 h-3.5" />;
}

function formatTime(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

function formatDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(); } catch { return ""; }
}

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
      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-colors text-slate-700 dark:text-slate-200">
      {fileIcon(att.content_type)}
      <span className="truncate max-w-[160px]">{att.filename}</span>
    </a>
  );
}

export default function AgentDashboard() {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const [status, setStatus] = useState(user?.status || "online");
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("active"); // active | archived
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
  const [activeCount, setActiveCount] = useState(0);

  // Archive search state
  const [archiveResults, setArchiveResults] = useState([]);
  const [archiveQuery, setArchiveQuery] = useState("");
  const [archiveFrom, setArchiveFrom] = useState("");
  const [archiveTo, setArchiveTo] = useState("");
  const [archiveLoading, setArchiveLoading] = useState(false);

  const messagesEndRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const token = localStorage.getItem("token");
  const wsUrl = token ? `${WS_BASE}/api/ws/agent?token=${token}` : null;

  const currentSession = sessions.find((s) => s.id === selectedId);
  const isArchivedView = activeTab === "archived";
  const isReadOnly = isArchivedView || (currentSession && currentSession.status === "closed");

  // Load sessions & quick replies
  const loadSessions = useCallback(async (tab = activeTab) => {
    try {
      const statusFilter = tab === "archived" ? "closed" : "open";
      const { data } = await api.get(`/chat/sessions?status_filter=${statusFilter}`);
      setSessions(data);
    } catch { /* ignore */ }
  }, [activeTab]);

  const loadLoad = useCallback(async () => {
    try {
      const { data } = await api.get("/agents/me/load");
      setActiveCount(data.active_chat_count || 0);
    } catch { /* ignore */ }
  }, []);

  const loadMessages = useCallback(async (id) => {
    try {
      const { data } = await api.get(`/chat/sessions/${id}/messages`);
      setMessages(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadSessions(activeTab);
    setSelectedId(null);
    setMessages([]);
  }, [activeTab, loadSessions]);

  useEffect(() => {
    api.get("/quick-replies").then(({ data }) => setQuickReplies(data)).catch(() => {});
    loadLoad();
    const t = setInterval(loadLoad, 15000);
    return () => clearInterval(t);
  }, [loadLoad]);

  useEffect(() => {
    if (selectedId) {
      loadMessages(selectedId);
      setSuggestions([]);
    } else {
      setMessages([]);
    }
  }, [selectedId, loadMessages]);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, customerTyping[selectedId]]);

  const playPing = useCallback(() => {
    if (!soundOn) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 900;
      gain.gain.value = 0.05;
      osc.start(); osc.stop(ctx.currentTime + 0.12);
    } catch { /* ignore */ }
  }, [soundOn]);

  const handleWs = useCallback((data) => {
    if (data.type === "message") {
      const m = data.message;
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === m.session_id);
        if (idx === -1) {
          if (!isArchivedView) loadSessions("active");
          return prev;
        }
        const copy = [...prev];
        copy[idx] = {
          ...copy[idx],
          last_message: {
            content: m.content, sender_type: m.sender_type,
            created_at: m.created_at, has_attachments: !!(m.attachments && m.attachments.length),
          },
          last_message_at: m.created_at,
        };
        const [item] = copy.splice(idx, 1);
        copy.unshift(item);
        return copy;
      });
      if (m.session_id === selectedId) {
        setMessages((prev) => (prev.find((x) => x.id === m.id) ? prev : [...prev, m]));
      }
      if (m.sender_type === "customer") {
        playPing();
        // Clear typing preview when message actually arrives
        setCustomerTyping((p) => ({ ...p, [m.session_id]: false }));
        setCustomerPreview((p) => ({ ...p, [m.session_id]: "" }));
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
        // Preview text stays until they send or explicitly clear
        if (typeof data.preview === "string") {
          setCustomerPreview((prev) => ({ ...prev, [data.session_id]: data.preview }));
        }
      }
    } else if (data.type === "new_session") {
      if (!isArchivedView) {
        setSessions((prev) => (prev.find((s) => s.id === data.session.id) ? prev : [data.session, ...prev]));
        playPing();
      }
    } else if (data.type === "read_receipt") {
      if (data.session_id === selectedId) {
        setMessages((prev) => prev.map((m) => (m.sender_type === "agent" ? { ...m, status: "read" } : m)));
      }
    } else if (data.type === "session_closed") {
      loadSessions(activeTab);
      loadLoad();
      if (data.session_id === selectedId) {
        // Force reload current session data
        setSessions((prev) => prev.map((s) => (s.id === data.session_id ? { ...s, status: "closed", summary: data.summary } : s)));
      }
    } else if (data.type === "agent_status" && data.agent_id === user?.id) {
      // Server-driven status change (e.g., auto-busy at cap)
      setStatus(data.status);
    }
  }, [selectedId, loadSessions, playPing, isArchivedView, activeTab, loadLoad, user?.id]);

  const { send, connected } = useWebSocket(wsUrl, handleWs);

  const changeStatus = async (newStatus) => {
    setStatus(newStatus);
    try {
      await api.post("/agents/status", { status: newStatus });
    } catch { /* ignore */ }
  };

  const sendMessage = () => {
    if (!selectedId || isReadOnly) return;
    if (!text.trim() && pendingAttachments.length === 0) return;
    send({ type: "message", session_id: selectedId, content: text.trim(), attachments: pendingAttachments });
    setText("");
    setPendingAttachments([]);
    setSuggestions([]);
    send({ type: "typing", session_id: selectedId, is_typing: false });
    loadLoad();
  };

  const handleTyping = (v) => {
    setText(v);
    if (!selectedId || isReadOnly) return;
    send({ type: "typing", session_id: selectedId, is_typing: true });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      send({ type: "typing", session_id: selectedId, is_typing: false });
    }, 1200);
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
    } catch { /* ignore */ }
    finally {
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
    } catch { /* ignore */ }
    finally { setLoadingSuggest(false); }
  };

  const closeSession = async () => {
    if (!selectedId) return;
    try {
      await api.post(`/chat/sessions/${selectedId}/close`);
      loadSessions(activeTab);
      loadLoad();
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

  const runArchiveSearch = useCallback(async () => {
    setArchiveLoading(true);
    try {
      const params = new URLSearchParams();
      if (archiveQuery) params.append("q", archiveQuery);
      if (archiveFrom) params.append("date_from", new Date(archiveFrom).toISOString());
      if (archiveTo) params.append("date_to", new Date(archiveTo).toISOString());
      const { data } = await api.get(`/chat/archive/search?${params.toString()}`);
      setArchiveResults(data);
    } catch { /* ignore */ }
    finally { setArchiveLoading(false); }
  }, [archiveQuery, archiveFrom, archiveTo]);

  useEffect(() => {
    if (isArchivedView) {
      runArchiveSearch();
    }
  }, [isArchivedView, runArchiveSearch]);

  if (user === null) return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (user === false) return <Navigate to="/login" replace />;

  const listSource = isArchivedView ? archiveResults : sessions;
  const filteredSessions = listSource.filter((s) =>
    !search
      ? true
      : s.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
        s.customer_email?.toLowerCase().includes(search.toLowerCase()) ||
        s.subject?.toLowerCase().includes(search.toLowerCase())
  );

  const loadPercent = Math.min(100, (activeCount / MAX_ACTIVE) * 100);
  const loadColor = activeCount >= MAX_ACTIVE ? "bg-red-500" : activeCount >= 18 ? "bg-amber-500" : "bg-emerald-500";
  const loadText = activeCount >= MAX_ACTIVE ? "text-red-600 dark:text-red-400" : activeCount >= 18 ? "text-amber-600 dark:text-amber-400" : "text-slate-600 dark:text-slate-300";

  return (
    <div className="h-screen w-screen grid grid-cols-1 lg:grid-cols-[300px_1fr_320px] overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* LEFT SIDEBAR - Sessions */}
      <div className="border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <MessageCircle className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              <span className="font-extrabold text-slate-900 dark:text-slate-100">Pulse</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggleTheme}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                data-testid="theme-toggle"
                title="Toggle theme"
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setSoundOn((s) => !s)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                data-testid="sound-toggle"
                title="Sound notifications"
              >
                {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              {user.role === "admin" && (
                <Link to="/admin" className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" data-testid="link-admin">
                  <ShieldCheck className="w-4 h-4" />
                </Link>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" data-testid="agent-menu">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} data-testid="logout-menu-item">
                    <LogOut className="w-4 h-4 mr-2" /> Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Status + capacity */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button data-testid="status-toggle"
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                <span className={`w-2 h-2 rounded-full ${STATUS_STYLES[status].bg}`} />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{STATUS_STYLES[status].label}</span>
                <span className="text-xs text-slate-400 ml-auto truncate">{user.name}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              {Object.entries(STATUS_STYLES).map(([key, val]) => (
                <DropdownMenuItem key={key} onClick={() => changeStatus(key)} data-testid={`status-${key}`}>
                  <span className={`w-2 h-2 rounded-full ${val.bg} mr-2`} />
                  {val.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="mt-3" data-testid="active-chat-counter">
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className={`font-semibold ${loadText}`}>
                Active Chats: {activeCount}/{MAX_ACTIVE}
              </span>
              {activeCount >= MAX_ACTIVE && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 dark:text-red-400">
                  <Lock className="w-3 h-3" /> AT CAPACITY
                </span>
              )}
              {activeCount >= 18 && activeCount < MAX_ACTIVE && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3 h-3" /> NEAR CAP
                </span>
              )}
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div className={`h-full ${loadColor} transition-all duration-500`} style={{ width: `${loadPercent}%` }} />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 border-b border-slate-100 dark:border-slate-800">
          <button
            onClick={() => setActiveTab("active")}
            data-testid="tab-active"
            className={`py-2.5 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === "active"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <Inbox className="w-3.5 h-3.5" /> Active
          </button>
          <button
            onClick={() => setActiveTab("archived")}
            data-testid="tab-archived"
            className={`py-2.5 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === "archived"
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <Archive className="w-3.5 h-3.5" /> Archived
          </button>
        </div>

        {/* Archive filters */}
        {isArchivedView && (
          <div className="p-3 space-y-2 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={archiveQuery}
                onChange={(e) => setArchiveQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runArchiveSearch()}
                placeholder="Search name, email, or keywords…"
                className="pl-8 h-8 rounded-lg text-xs bg-white dark:bg-slate-800 dark:border-slate-700"
                data-testid="archive-search-input"
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Input type="date" value={archiveFrom} onChange={(e) => setArchiveFrom(e.target.value)}
                className="h-8 text-xs rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700" data-testid="archive-from" />
              <Input type="date" value={archiveTo} onChange={(e) => setArchiveTo(e.target.value)}
                className="h-8 text-xs rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700" data-testid="archive-to" />
            </div>
            <Button
              size="sm"
              onClick={runArchiveSearch}
              disabled={archiveLoading}
              className="w-full h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="archive-search-btn"
            >
              {archiveLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Search archive"}
            </Button>
          </div>
        )}

        {!isArchivedView && (
          <div className="p-3 border-b border-slate-100 dark:border-slate-800">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats…"
                className="pl-9 h-9 rounded-lg border-slate-200 dark:border-slate-700 dark:bg-slate-800 text-sm"
                data-testid="session-search"
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto" data-testid="sessions-list">
          {filteredSessions.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-400">
              {isArchivedView ? <Archive className="w-10 h-10 mx-auto mb-3 text-slate-200 dark:text-slate-700" /> : <MessageCircle className="w-10 h-10 mx-auto mb-3 text-slate-200 dark:text-slate-700" />}
              {isArchivedView ? "No archived chats match." : "No chats yet."}
            </div>
          )}
          {filteredSessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              data-testid={`session-item-${s.id}`}
              className={`w-full text-left p-3 border-b border-slate-50 dark:border-slate-800 transition-colors ${
                selectedId === s.id
                  ? "bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                  : `hover:bg-slate-50 dark:hover:bg-slate-800/50 ${isArchivedView ? "bg-slate-50/40 dark:bg-slate-900/40" : ""}`
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${
                  isArchivedView ? "bg-slate-400 dark:bg-slate-600" : "bg-gradient-to-br from-blue-400 to-blue-600"
                }`}>
                  {isArchivedView ? <Archive className="w-4 h-4" /> : (s.customer_name?.[0]?.toUpperCase() || "?")}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">{s.customer_name}</span>
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

      {/* MAIN CHAT AREA */}
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
                        <div key={i} className={isAgent ? "flex justify-end" : ""}>
                          <AgentAttachment att={att} />
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        {isMine && !isReadOnly && (
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                            <button onClick={() => { setEditingMsg(m); setEditText(m.content); }} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" data-testid={`edit-msg-${m.id}`}>
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button onClick={() => resendMessage(m)} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-semibold" data-testid={`resend-msg-${m.id}`}>
                              Resend
                            </button>
                            <button onClick={() => deleteMessage(m.id)} className="p-1 text-slate-400 hover:text-red-600" data-testid={`delete-msg-${m.id}`}>
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        {m.content && (
                          <div className={`px-4 py-2.5 text-sm rounded-2xl shadow-sm ${
                            isAgent
                              ? "bg-blue-600 text-white rounded-tr-sm"
                              : "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-sm border border-slate-100 dark:border-slate-700"
                          }`}>
                            {m.content}
                            {m.edited && <span className="text-[10px] opacity-70 ml-1.5 italic">(edited)</span>}
                          </div>
                        )}
                      </div>
                      <div className={`flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 ${isAgent ? "justify-end" : ""}`}>
                        <span>{formatTime(m.created_at)}</span>
                        {isAgent && (m.status === "read"
                          ? <CheckCheck className="w-3 h-3 text-blue-500" />
                          : <Check className="w-3 h-3" />)}
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

            {/* Typing live preview */}
            {!isReadOnly && customerPreview[selectedId] && (
              <div className="px-6 py-2 border-t border-blue-100 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/30" data-testid="typing-preview">
                <div className="flex items-start gap-2">
                  <Sparkles className="w-3 h-3 text-blue-500 mt-1 shrink-0" />
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-bold text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400 mr-1.5">Live preview</span>
                    <span className="italic">{customerPreview[selectedId]}</span>
                  </div>
                </div>
              </div>
            )}

            {/* AI Suggestions */}
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

            {/* Pending attachments */}
            {!isReadOnly && pendingAttachments.length > 0 && (
              <div className="px-6 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-2 overflow-x-auto">
                {pendingAttachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs">
                    {fileIcon(a.content_type)}
                    <span className="truncate max-w-[120px] dark:text-slate-200">{a.filename}</span>
                    <button onClick={() => setPendingAttachments((prev) => prev.filter((x) => x.id !== a.id))} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                      <X className="w-3 h-3" />
                    </button>
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
                      <button key={q.id} onClick={() => setText(q.content)}
                        className="text-[11px] font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-full px-2.5 py-1 whitespace-nowrap border border-blue-100 dark:border-blue-900 transition-colors"
                        data-testid={`quick-reply-${q.id}`}>
                        {q.title}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <button onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors" data-testid="agent-attach-btn">
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                  </button>
                  <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.zip" onChange={handleFile} className="hidden" />
                  <button onClick={requestSuggestions} disabled={loadingSuggest}
                    className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors" title="AI reply suggestions" data-testid="ai-suggest-btn">
                    {loadingSuggest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  </button>
                  <Textarea
                    value={text}
                    onChange={(e) => handleTyping(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Type your reply…"
                    rows={1}
                    className="flex-1 resize-none min-h-[42px] max-h-32 rounded-xl border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 text-sm focus-visible:ring-blue-500"
                    data-testid="agent-input"
                  />
                  <Button onClick={sendMessage} className="rounded-xl h-10 w-10 p-0 bg-blue-600 hover:bg-blue-700 text-white shrink-0" data-testid="agent-send-btn">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* RIGHT SIDEBAR - Customer Details */}
      <div className="hidden lg:block border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-col h-full overflow-y-auto">
        {currentSession ? (
          <div className="p-6 space-y-6">
            <div className="text-center">
              <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center text-white font-bold text-2xl mb-3 shadow-lg ${
                isArchivedView ? "bg-slate-400 dark:bg-slate-600 shadow-slate-500/20" : "bg-gradient-to-br from-blue-400 to-blue-600 shadow-blue-600/20"
              }`}>
                {currentSession.customer_name?.[0]?.toUpperCase()}
              </div>
              <div className="font-bold text-slate-900 dark:text-slate-100">{currentSession.customer_name}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{currentSession.customer_email}</div>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Details</div>
              <div className="text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-50 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Subject</span>
                  <span className="text-slate-900 dark:text-slate-100 font-medium text-right max-w-[180px] truncate">{currentSession.subject}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Location</span>
                  <span className="text-slate-900 dark:text-slate-100 font-medium">{currentSession.location || "—"}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">Started</span>
                  <span className="text-slate-900 dark:text-slate-100 font-medium">{formatTime(currentSession.created_at)}</span>
                </div>
                {currentSession.closed_at && (
                  <div className="flex justify-between py-1.5 border-b border-slate-50 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Closed</span>
                    <span className="text-slate-900 dark:text-slate-100 font-medium">{formatDate(currentSession.closed_at)}</span>
                  </div>
                )}
                {currentSession.duration_seconds != null && (
                  <div className="flex justify-between py-1.5 border-b border-slate-50 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Duration</span>
                    <span className="text-slate-900 dark:text-slate-100 font-medium">{Math.round(currentSession.duration_seconds / 60)} min</span>
                  </div>
                )}
                {currentSession.agent_name && (
                  <div className="flex justify-between py-1.5 border-b border-slate-50 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Handled by</span>
                    <span className="text-slate-900 dark:text-slate-100 font-medium">{currentSession.agent_name}</span>
                  </div>
                )}
                {currentSession.message_count != null && (
                  <div className="flex justify-between py-1.5 border-b border-slate-50 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Messages</span>
                    <span className="text-slate-900 dark:text-slate-100 font-medium">{currentSession.message_count}</span>
                  </div>
                )}
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
          <DialogHeader>
            <DialogTitle>Past conversations{currentSession ? ` with ${currentSession.customer_name}` : ""}</DialogTitle>
          </DialogHeader>
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
