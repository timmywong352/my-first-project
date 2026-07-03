import { useEffect, useState, useRef, useCallback } from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  MessageCircle, Send, Paperclip, MoreVertical, Edit2, Trash2, X,
  Search, User, Sparkles, LogOut, Circle, Loader2, FileText, Image as ImageIcon,
  Check, CheckCheck, Volume2, VolumeX, Settings, ShieldCheck,
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

function formatTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function AgentAttachment({ att, sessionId }) {
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
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs bg-white border border-slate-200 hover:border-slate-300 transition-colors text-slate-700"
    >
      {fileIcon(att.content_type)}
      <span className="truncate max-w-[160px]">{att.filename}</span>
    </a>
  );
}

export default function AgentDashboard() {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState(user?.status || "online");
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [customerTyping, setCustomerTyping] = useState({});  // sessionId -> bool
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

  const messagesEndRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const token = localStorage.getItem("token");
  const wsUrl = token ? `${WS_BASE}/api/ws/agent?token=${token}` : null;

  const currentSession = sessions.find((s) => s.id === selectedId);

  // Load sessions & quick replies
  const loadSessions = useCallback(async () => {
    try {
      const { data } = await api.get("/chat/sessions");
      setSessions(data);
    } catch { /* ignore */ }
  }, []);

  const loadMessages = useCallback(async (id) => {
    try {
      const { data } = await api.get(`/chat/sessions/${id}/messages`);
      setMessages(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadSessions();
    api.get("/quick-replies").then(({ data }) => setQuickReplies(data)).catch(() => {});
  }, [loadSessions]);

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
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 900;
      gain.gain.value = 0.05;
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch { /* ignore */ }
  }, [soundOn]);

  const handleWs = useCallback((data) => {
    if (data.type === "message") {
      const m = data.message;
      // Update sessions list preview
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === m.session_id);
        if (idx === -1) {
          loadSessions();
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
        // Move to top
        const [item] = copy.splice(idx, 1);
        copy.unshift(item);
        return copy;
      });
      if (m.session_id === selectedId) {
        setMessages((prev) => (prev.find((x) => x.id === m.id) ? prev : [...prev, m]));
      }
      if (m.sender_type === "customer") playPing();
    } else if (data.type === "message_edited") {
      if (data.message.session_id === selectedId) {
        setMessages((prev) => prev.map((x) => (x.id === data.message.id ? data.message : x)));
      }
    } else if (data.type === "message_deleted") {
      setMessages((prev) => prev.filter((x) => x.id !== data.message_id));
    } else if (data.type === "typing") {
      if (data.sender_type === "customer") {
        setCustomerTyping((prev) => ({ ...prev, [data.session_id]: data.is_typing }));
      }
    } else if (data.type === "new_session") {
      setSessions((prev) => {
        if (prev.find((s) => s.id === data.session.id)) return prev;
        return [data.session, ...prev];
      });
      playPing();
    } else if (data.type === "read_receipt") {
      if (data.session_id === selectedId) {
        setMessages((prev) => prev.map((m) => (m.sender_type === "agent" ? { ...m, status: "read" } : m)));
      }
    } else if (data.type === "session_closed") {
      loadSessions();
    }
  }, [selectedId, loadSessions, playPing]);

  const { send, connected } = useWebSocket(wsUrl, handleWs);

  const changeStatus = async (newStatus) => {
    setStatus(newStatus);
    try {
      await api.post("/agents/status", { status: newStatus });
    } catch { /* ignore */ }
  };

  const sendMessage = () => {
    if (!selectedId) return;
    if (!text.trim() && pendingAttachments.length === 0) return;
    send({ type: "message", session_id: selectedId, content: text.trim(), attachments: pendingAttachments });
    setText("");
    setPendingAttachments([]);
    setSuggestions([]);
    send({ type: "typing", session_id: selectedId, is_typing: false });
  };

  const handleTyping = (v) => {
    setText(v);
    if (!selectedId) return;
    send({ type: "typing", session_id: selectedId, is_typing: true });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      send({ type: "typing", session_id: selectedId, is_typing: false });
    }, 1200);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
    try {
      await api.delete(`/chat/messages/${id}`);
    } catch { /* ignore */ }
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
      loadSessions();
      setSelectedId(null);
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

  if (user === null) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (user === false) return <Navigate to="/login" replace />;

  const filteredSessions = sessions.filter((s) =>
    !search
      ? true
      : s.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
        s.customer_email?.toLowerCase().includes(search.toLowerCase()) ||
        s.subject?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-screen w-screen grid grid-cols-1 lg:grid-cols-[300px_1fr_320px] overflow-hidden bg-slate-50">
      {/* LEFT SIDEBAR - Sessions */}
      <div className="border-r border-slate-200 bg-white flex flex-col h-full overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <MessageCircle className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              <span className="font-extrabold text-slate-900">Pulse</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSoundOn((s) => !s)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                data-testid="sound-toggle"
                title="Sound notifications"
              >
                {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              {user.role === "admin" && (
                <Link to="/admin" className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100" data-testid="link-admin">
                  <ShieldCheck className="w-4 h-4" />
                </Link>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100" data-testid="agent-menu">
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-testid="status-toggle"
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors"
              >
                <span className={`w-2 h-2 rounded-full ${STATUS_STYLES[status].bg}`} />
                <span className="text-sm font-semibold text-slate-700">{STATUS_STYLES[status].label}</span>
                <span className="text-xs text-slate-400 ml-auto">{user.name}</span>
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
        </div>

        <div className="p-3 border-b border-slate-100">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              className="pl-9 h-9 rounded-lg border-slate-200 text-sm"
              data-testid="session-search"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto" data-testid="sessions-list">
          {filteredSessions.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-400">
              <MessageCircle className="w-10 h-10 mx-auto mb-3 text-slate-200" />
              No chats yet.
            </div>
          )}
          {filteredSessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              data-testid={`session-item-${s.id}`}
              className={`w-full text-left p-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                selectedId === s.id ? "bg-blue-50 hover:bg-blue-50" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                  {s.customer_name?.[0]?.toUpperCase() || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-slate-900 truncate">{s.customer_name}</span>
                    <span className="text-[10px] text-slate-400 shrink-0 ml-2">{formatTime(s.last_message_at)}</span>
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">{s.subject}</div>
                  <div className="text-xs text-slate-400 truncate mt-0.5">
                    {s.last_message?.has_attachments && "📎 "}
                    {s.last_message?.content || "New conversation"}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {s.status === "open" ? (
                      <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0">Open</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 bg-slate-100 text-slate-500 hover:bg-slate-100 border-0">Closed</Badge>
                    )}
                    {customerTyping[s.id] && <span className="text-[10px] text-blue-600 font-medium">typing…</span>}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="p-2 border-t border-slate-100 text-[10px] text-slate-400 flex items-center gap-1.5">
          <Circle className={`w-2 h-2 ${connected ? "text-emerald-500 fill-emerald-500" : "text-slate-300 fill-slate-300"}`} />
          {connected ? "Real-time connected" : "Reconnecting…"}
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div className="bg-white flex flex-col h-full overflow-hidden">
        {!currentSession ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
              <MessageCircle className="w-8 h-8 text-blue-600" strokeWidth={2} />
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight mb-2">Select a conversation</h2>
            <p className="text-sm text-slate-500 max-w-sm">Pick a chat from the list to start replying to your customer.</p>
          </div>
        ) : (
          <>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-900">{currentSession.customer_name}</h2>
                <div className="text-xs text-slate-500 flex items-center gap-2">
                  <span>{currentSession.subject}</span>
                  {customerTyping[selectedId] && <span className="text-blue-600 font-medium">• typing…</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={openHistory} data-testid="history-btn">History</Button>
                {currentSession.status === "open" && (
                  <Button variant="outline" size="sm" onClick={closeSession} data-testid="close-session-btn">Close Chat</Button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-slate-50/30" data-testid="messages-container">
              {messages.map((m) => {
                const isAgent = m.sender_type === "agent";
                const isMine = isAgent && m.sender_id === user.id;
                return (
                  <div key={m.id} className={`flex ${isAgent ? "justify-end" : "justify-start"} group`}>
                    <div className={`max-w-[70%] space-y-1.5 ${isAgent ? "items-end" : "items-start"}`} data-testid={`agent-msg-${m.id}`}>
                      {!isAgent && <div className="text-[10px] font-semibold text-slate-400 px-1 uppercase tracking-wider">{m.sender_name}</div>}
                      {(m.attachments || []).map((att, i) => (
                        <div key={i} className={isAgent ? "flex justify-end" : ""}>
                          <AgentAttachment att={att} sessionId={m.session_id} />
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        {isMine && (
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                            <button onClick={() => { setEditingMsg(m); setEditText(m.content); }} className="p-1 text-slate-400 hover:text-slate-700" data-testid={`edit-msg-${m.id}`}>
                              <Edit2 className="w-3 h-3" />
                            </button>
                            <button onClick={() => resendMessage(m)} className="p-1 text-slate-400 hover:text-slate-700 text-xs font-semibold" data-testid={`resend-msg-${m.id}`}>
                              Resend
                            </button>
                            <button onClick={() => deleteMessage(m.id)} className="p-1 text-slate-400 hover:text-red-600" data-testid={`delete-msg-${m.id}`}>
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        {m.content && (
                          <div className={`px-4 py-2.5 text-sm rounded-2xl shadow-sm ${
                            isAgent ? "bg-blue-600 text-white rounded-tr-sm" : "bg-white text-slate-900 rounded-tl-sm border border-slate-100"
                          }`}>
                            {m.content}
                            {m.edited && <span className="text-[10px] opacity-70 ml-1.5 italic">(edited)</span>}
                          </div>
                        )}
                      </div>
                      <div className={`flex items-center gap-1 text-[10px] text-slate-400 ${isAgent ? "justify-end" : ""}`}>
                        <span>{formatTime(m.created_at)}</span>
                        {isAgent && (m.status === "read"
                          ? <CheckCheck className="w-3 h-3 text-blue-500" />
                          : <Check className="w-3 h-3" />)}
                      </div>
                    </div>
                  </div>
                );
              })}
              {customerTyping[selectedId] && (
                <div className="flex items-center gap-2 px-4 py-2">
                  <div className="flex space-x-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-xs text-slate-500">Customer is typing…</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* AI Suggestions */}
            {suggestions.length > 0 && (
              <div className="px-6 py-2 border-t border-slate-100 bg-gradient-to-r from-blue-50/50 to-purple-50/50">
                <div className="flex items-center gap-2 mb-1.5">
                  <Sparkles className="w-3 h-3 text-blue-600" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">AI Suggestions</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => { setText(s); setSuggestions([]); }}
                      data-testid={`ai-suggestion-${i}`}
                      className="text-xs bg-white border border-blue-200 text-slate-700 rounded-full px-3 py-1.5 hover:bg-blue-50 transition-colors max-w-full text-left"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Pending attachments */}
            {pendingAttachments.length > 0 && (
              <div className="px-6 py-2 border-t border-slate-100 bg-slate-50 flex gap-2 overflow-x-auto">
                {pendingAttachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs">
                    {fileIcon(a.content_type)}
                    <span className="truncate max-w-[120px]">{a.filename}</span>
                    <button onClick={() => setPendingAttachments((prev) => prev.filter((x) => x.id !== a.id))} className="text-slate-400 hover:text-slate-700">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="px-6 py-3 border-t border-slate-100 bg-white">
              {/* Quick replies */}
              {quickReplies.length > 0 && (
                <div className="flex gap-1.5 mb-2 overflow-x-auto pb-1" data-testid="quick-replies">
                  {quickReplies.slice(0, 6).map((q) => (
                    <button
                      key={q.id}
                      onClick={() => setText(q.content)}
                      className="text-[11px] font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-full px-2.5 py-1 whitespace-nowrap border border-blue-100 transition-colors"
                      data-testid={`quick-reply-${q.id}`}
                    >
                      {q.title}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                  disabled={uploading}
                  data-testid="agent-attach-btn"
                >
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                </button>
                <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.mp4,.zip" onChange={handleFile} className="hidden" />
                <button
                  onClick={requestSuggestions}
                  disabled={loadingSuggest}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="AI reply suggestions"
                  data-testid="ai-suggest-btn"
                >
                  {loadingSuggest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                </button>
                <Textarea
                  value={text}
                  onChange={(e) => handleTyping(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Type your reply…"
                  rows={1}
                  className="flex-1 resize-none min-h-[42px] max-h-32 rounded-xl border-slate-200 text-sm focus-visible:ring-blue-500"
                  data-testid="agent-input"
                />
                <Button
                  onClick={sendMessage}
                  className="rounded-xl h-10 w-10 p-0 bg-blue-600 hover:bg-blue-700 text-white shrink-0"
                  data-testid="agent-send-btn"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* RIGHT SIDEBAR - Customer Details */}
      <div className="hidden lg:block border-l border-slate-200 bg-white flex-col h-full overflow-y-auto">
        {currentSession ? (
          <div className="p-6 space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold text-2xl mb-3 shadow-lg shadow-blue-600/20">
                {currentSession.customer_name?.[0]?.toUpperCase()}
              </div>
              <div className="font-bold text-slate-900">{currentSession.customer_name}</div>
              <div className="text-xs text-slate-500">{currentSession.customer_email}</div>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Details</div>
              <div className="text-xs">
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Subject</span>
                  <span className="text-slate-900 font-medium text-right max-w-[180px] truncate">{currentSession.subject}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Location</span>
                  <span className="text-slate-900 font-medium">{currentSession.location || "—"}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-50">
                  <span className="text-slate-500">Started</span>
                  <span className="text-slate-900 font-medium">{formatTime(currentSession.created_at)}</span>
                </div>
                <div className="py-1.5 border-b border-slate-50">
                  <div className="text-slate-500 mb-1">Page</div>
                  <div className="text-slate-900 font-medium text-[11px] break-all">{currentSession.page || "—"}</div>
                </div>
                {currentSession.csat_rating && (
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-500">Rating</span>
                    <span className="text-amber-500 font-bold">{"★".repeat(currentSession.csat_rating)}</span>
                  </div>
                )}
              </div>
            </div>

            {currentSession.summary && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3" /> AI Summary</div>
                <div className="text-xs text-slate-700 leading-relaxed bg-blue-50/50 border border-blue-100 rounded-lg p-3">{currentSession.summary}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-6 text-center text-sm text-slate-400">
            <User className="w-10 h-10 mx-auto mb-3 text-slate-200" />
            Customer details will appear here.
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingMsg} onOpenChange={(o) => !o && setEditingMsg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit message</DialogTitle>
          </DialogHeader>
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
              <button
                key={h.id}
                onClick={() => { setSelectedId(h.id); setHistoryOpen(false); }}
                className="w-full text-left p-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-slate-900">{h.subject}</span>
                  <span className="text-xs text-slate-400">{new Date(h.created_at).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">{h.status}</Badge>
                  {h.csat_rating && <span className="text-amber-500">{"★".repeat(h.csat_rating)}</span>}
                </div>
                {h.summary && <div className="text-xs text-slate-600 mt-1.5 line-clamp-2">{h.summary}</div>}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
