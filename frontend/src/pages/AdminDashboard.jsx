import { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  MessageCircle, Users, TrendingUp, Star, Palette, Clock,
  Plus, Trash2, LogOut, ArrowLeft, Loader2, Circle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from "recharts";

const STATUS_COLOR = {
  online: "bg-emerald-500",
  busy: "bg-amber-500",
  offline: "bg-slate-400",
};

function MetricCard({ label, value, hint, icon: Icon, accent = "blue" }) {
  const accents = {
    blue: "from-blue-500 to-blue-600 shadow-blue-500/20",
    emerald: "from-emerald-500 to-emerald-600 shadow-emerald-500/20",
    amber: "from-amber-500 to-amber-600 shadow-amber-500/20",
    purple: "from-purple-500 to-purple-600 shadow-purple-500/20",
  };
  return (
    <Card className="p-5 border-slate-200 bg-white">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${accents[accent]} flex items-center justify-center text-white shadow-lg`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="text-3xl font-extrabold text-slate-900 tracking-tight leading-none">{value}</div>
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mt-1.5">{label}</div>
      {hint && <div className="text-[11px] text-slate-400 mt-1">{hint}</div>}
    </Card>
  );
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [metrics, setMetrics] = useState(null);
  const [agents, setAgents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [newAgent, setNewAgent] = useState({ name: "", email: "", password: "", role: "agent" });
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [quickReplies, setQuickReplies] = useState([]);
  const [newReply, setNewReply] = useState({ title: "", content: "" });

  useEffect(() => {
    if (user && user.role === "admin") {
      loadAll();
    }
  }, [user]);

  const loadAll = async () => {
    try {
      const [m, a, s, q] = await Promise.all([
        api.get("/admin/metrics"),
        api.get("/agents"),
        api.get("/admin/settings"),
        api.get("/quick-replies"),
      ]);
      setMetrics(m.data);
      setAgents(a.data);
      setSettings(s.data);
      setQuickReplies(q.data);
    } catch { /* ignore */ }
  };

  const addAgent = async () => {
    setAddErr("");
    try {
      await api.post("/agents", newAgent);
      setNewAgent({ name: "", email: "", password: "", role: "agent" });
      setAddAgentOpen(false);
      loadAll();
    } catch (e) {
      setAddErr(formatApiError(e.response?.data?.detail) || e.message);
    }
  };

  const removeAgent = async (id) => {
    if (!window.confirm("Delete this agent?")) return;
    try {
      await api.delete(`/agents/${id}`);
      loadAll();
    } catch { /* ignore */ }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await api.patch("/admin/settings", settings);
      loadAll();
    } catch { /* ignore */ }
    finally { setSavingSettings(false); }
  };

  const addQuickReply = async () => {
    if (!newReply.title.trim() || !newReply.content.trim()) return;
    try {
      await api.post("/quick-replies", newReply);
      setNewReply({ title: "", content: "" });
      loadAll();
    } catch { /* ignore */ }
  };

  const deleteQuickReply = async (id) => {
    try {
      await api.delete(`/quick-replies/${id}`);
      loadAll();
    } catch { /* ignore */ }
  };

  if (user === null) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  if (user === false) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/dashboard" replace />;

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const toggleDay = (i) => {
    const days = settings.business_days || [];
    const set = new Set(days);
    if (set.has(i)) set.delete(i); else set.add(i);
    setSettings({ ...settings, business_days: Array.from(set).sort() });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top nav */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/dashboard" className="p-2 hover:bg-slate-100 rounded-lg" data-testid="back-to-dashboard">
              <ArrowLeft className="w-4 h-4 text-slate-600" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <MessageCircle className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              <div>
                <div className="font-extrabold text-slate-900">Pulse Admin</div>
                <div className="text-[10px] text-slate-400 uppercase tracking-widest">Control Center</div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">{user.email}</span>
            <Button variant="outline" size="sm" onClick={logout} data-testid="admin-logout"><LogOut className="w-3 h-3 mr-1.5" />Logout</Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 lg:p-8">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="bg-white border border-slate-200 p-1 rounded-xl">
            <TabsTrigger value="overview" data-testid="tab-overview" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white rounded-lg">Overview</TabsTrigger>
            <TabsTrigger value="agents" data-testid="tab-agents" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white rounded-lg">Agents</TabsTrigger>
            <TabsTrigger value="branding" data-testid="tab-branding" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white rounded-lg">Branding</TabsTrigger>
            <TabsTrigger value="hours" data-testid="tab-hours" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white rounded-lg">Business Hours</TabsTrigger>
            <TabsTrigger value="inactivity" data-testid="tab-inactivity" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white rounded-lg">Inactivity</TabsTrigger>
            <TabsTrigger value="replies" data-testid="tab-replies" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white rounded-lg">Quick Replies</TabsTrigger>
          </TabsList>

          {/* OVERVIEW */}
          <TabsContent value="overview" className="space-y-6">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">Overview</h1>
              <p className="text-sm text-slate-500">Everything happening in your support inbox today.</p>
            </div>

            {metrics && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <MetricCard label="Chats today" value={metrics.chats_today} icon={MessageCircle} accent="blue" />
                  <MetricCard label="Open chats" value={metrics.open_chats} icon={Users} accent="emerald" />
                  <MetricCard label="Avg response" value={`${Math.round(metrics.avg_response_seconds)}s`} icon={TrendingUp} accent="amber" hint="First reply time today" />
                  <MetricCard label="CSAT average" value={metrics.csat_count ? metrics.csat_average.toFixed(2) : "—"} icon={Star} accent="purple" hint={`${metrics.csat_count} rating${metrics.csat_count === 1 ? "" : "s"}`} />
                </div>

                <Card className="p-6 border-slate-200 bg-white">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Chats last 7 days</h3>
                      <p className="text-xs text-slate-500">Daily conversation volume</p>
                    </div>
                    <Badge variant="secondary" className="bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-50">Live</Badge>
                  </div>
                  <div className="h-64" data-testid="chats-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={metrics.daily_chats}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                        <XAxis dataKey="date" stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="count" fill="#0057FF" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </>
            )}
          </TabsContent>

          {/* AGENTS */}
          <TabsContent value="agents" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">Agents</h1>
                <p className="text-sm text-slate-500">Manage the humans behind your support.</p>
              </div>
              <Dialog open={addAgentOpen} onOpenChange={setAddAgentOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="add-agent-btn"><Plus className="w-4 h-4 mr-1.5" />Add agent</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add new agent</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>Name</Label>
                      <Input value={newAgent.name} onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} data-testid="new-agent-name" />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input type="email" value={newAgent.email} onChange={(e) => setNewAgent({ ...newAgent, email: e.target.value })} data-testid="new-agent-email" />
                    </div>
                    <div>
                      <Label>Password</Label>
                      <Input type="password" value={newAgent.password} onChange={(e) => setNewAgent({ ...newAgent, password: e.target.value })} data-testid="new-agent-password" />
                    </div>
                    <div>
                      <Label>Role</Label>
                      <select
                        value={newAgent.role}
                        onChange={(e) => setNewAgent({ ...newAgent, role: e.target.value })}
                        className="w-full h-10 px-3 rounded-md border border-slate-200 text-sm bg-white"
                        data-testid="new-agent-role"
                      >
                        <option value="agent">Agent</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    {addErr && <div className="text-xs text-red-600 bg-red-50 rounded p-2">{addErr}</div>}
                    <Button onClick={addAgent} className="w-full bg-blue-600 hover:bg-blue-700 text-white" data-testid="save-agent-btn">Create agent</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Card className="border-slate-200 bg-white overflow-hidden">
              <div className="divide-y divide-slate-100">
                {agents.map((a) => (
                  <div key={a.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors" data-testid={`agent-row-${a.id}`}>
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold">
                          {a.name?.[0]?.toUpperCase()}
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${STATUS_COLOR[a.status || "offline"]}`} />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 text-sm">{a.name}</div>
                        <div className="text-xs text-slate-500">{a.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className={a.role === "admin" ? "bg-purple-50 text-purple-700 border border-purple-100 hover:bg-purple-50" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}>
                        {a.role}
                      </Badge>
                      <Badge variant="secondary" className="bg-slate-50 border border-slate-100 text-slate-500 hover:bg-slate-50">
                        <Circle className={`w-2 h-2 mr-1.5 ${STATUS_COLOR[a.status || "offline"]} rounded-full`} />
                        {a.status || "offline"}
                      </Badge>
                      {a.id !== user.id && (
                        <button onClick={() => removeAgent(a.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg" data-testid={`delete-agent-${a.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* BRANDING */}
          <TabsContent value="branding" className="space-y-6">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">Widget Branding</h1>
              <p className="text-sm text-slate-500">Customize how the chat looks on your site.</p>
            </div>
            {settings && (
              <div className="grid lg:grid-cols-[1fr_400px] gap-6">
                <Card className="p-6 border-slate-200 bg-white space-y-4">
                  <div>
                    <Label>Primary color</Label>
                    <div className="flex items-center gap-2 mt-1.5">
                      <input
                        type="color"
                        value={settings.widget_color}
                        onChange={(e) => setSettings({ ...settings, widget_color: e.target.value })}
                        className="w-14 h-11 rounded-lg cursor-pointer border border-slate-200"
                        data-testid="widget-color-input"
                      />
                      <Input value={settings.widget_color} onChange={(e) => setSettings({ ...settings, widget_color: e.target.value })} className="flex-1" />
                    </div>
                  </div>
                  <div>
                    <Label>Welcome message</Label>
                    <Input
                      value={settings.welcome_message || ""}
                      onChange={(e) => setSettings({ ...settings, welcome_message: e.target.value })}
                      className="mt-1.5"
                      data-testid="welcome-message-input"
                    />
                  </div>
                  <Button onClick={saveSettings} disabled={savingSettings} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="save-branding-btn">
                    {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save changes"}
                  </Button>
                </Card>

                {/* Preview */}
                <Card className="p-6 border-slate-200 bg-slate-50">
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5"><Palette className="w-3 h-3" />Live preview</div>
                  <div className="w-full h-[420px] rounded-2xl overflow-hidden shadow-xl bg-white border border-slate-100 flex flex-col">
                    <div className="p-4 text-white flex items-center gap-2" style={{ backgroundColor: settings.widget_color }}>
                      <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-lg">☺</div>
                      <div>
                        <div className="font-bold text-sm">Chat Support</div>
                        <div className="text-xs opacity-90">We’re online</div>
                      </div>
                    </div>
                    <div className="flex-1 p-4 space-y-2 bg-slate-50/50">
                      <div className="bg-white text-slate-900 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm max-w-[85%] shadow-sm border border-slate-100">
                        {settings.welcome_message || "Hi there!"}
                      </div>
                      <div className="flex justify-end">
                        <div className="text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-[85%]" style={{ backgroundColor: settings.widget_color }}>
                          I have a question about my order
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* BUSINESS HOURS */}
          <TabsContent value="hours" className="space-y-6">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">Business Hours</h1>
              <p className="text-sm text-slate-500">When your team is available to chat.</p>
            </div>
            {settings && (
              <Card className="p-6 border-slate-200 bg-white space-y-5 max-w-2xl">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Start</Label>
                    <Input type="time" value={settings.business_hours_start || "09:00"} onChange={(e) => setSettings({ ...settings, business_hours_start: e.target.value })} className="mt-1.5" data-testid="hours-start" />
                  </div>
                  <div>
                    <Label>End</Label>
                    <Input type="time" value={settings.business_hours_end || "18:00"} onChange={(e) => setSettings({ ...settings, business_hours_end: e.target.value })} className="mt-1.5" data-testid="hours-end" />
                  </div>
                </div>
                <div>
                  <Label>Working days</Label>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {DAYS.map((d, i) => {
                      const active = (settings.business_days || []).includes(i);
                      return (
                        <button
                          key={i}
                          onClick={() => toggleDay(i)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                          data-testid={`day-${i}`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Button onClick={saveSettings} disabled={savingSettings} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="save-hours-btn">
                  {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save hours"}
                </Button>
              </Card>
            )}
          </TabsContent>

          {/* QUICK REPLIES */}
          <TabsContent value="inactivity" className="space-y-6">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">Lily & Inactivity Rules</h1>
              <p className="text-sm text-slate-500">Toggle the AI assistant Lily and configure inactivity behaviour.</p>
            </div>
            {settings && (
              <Card className="p-6 border-slate-200 bg-white space-y-5 max-w-2xl">
                <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-pink-50 via-amber-50 to-pink-50 border border-pink-100">
                  <div>
                    <div className="font-bold text-slate-900 flex items-center gap-1.5">🧠 Lily AI 数字客服</div>
                    <p className="text-xs text-slate-600 mt-1">开启后 Lily 会优先接待新客户，识别情绪并提供关怀。客户随时可点"转人工"进入排队。</p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.lily_enabled !== false}
                      onChange={(e) => setSettings({ ...settings, lily_enabled: e.target.checked })}
                      className="w-5 h-5 rounded accent-pink-500"
                      data-testid="lily-enabled-toggle"
                    />
                    <span className="text-sm font-semibold text-slate-700">{settings.lily_enabled !== false ? "已启用" : "已关闭"}</span>
                  </label>
                </div>

                <div>
                  <Label>First-response timeout (minutes)</Label>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {[1, 3, 5, 10].map((n) => {
                      const active = (settings.inactivity_first_response_minutes || 3) === n;
                      return (
                        <button
                          key={n}
                          onClick={() => setSettings({ ...settings, inactivity_first_response_minutes: n })}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                          data-testid={`inactivity-timeout-${n}`}
                        >
                          {n} min
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">If no agent has replied to a new chat within this window, we&rsquo;ll send the auto-message below.</p>
                </div>

                <div>
                  <Label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!settings.inactivity_auto_transfer}
                      onChange={(e) => setSettings({ ...settings, inactivity_auto_transfer: e.target.checked })}
                      className="w-4 h-4 rounded accent-blue-600"
                      data-testid="auto-transfer-toggle"
                    />
                    <span className="font-normal">Auto-transfer to another available agent</span>
                  </Label>
                </div>

                <div>
                  <Label>Auto-message shown to the customer</Label>
                  <Textarea
                    value={settings.inactivity_auto_message || ""}
                    onChange={(e) => setSettings({ ...settings, inactivity_auto_message: e.target.value })}
                    placeholder="Thanks for waiting — we&rsquo;re a bit busy right now…"
                    rows={3}
                    className="mt-1.5 rounded-lg"
                    data-testid="auto-message-input"
                  />
                </div>

                <div>
                  <Label>Auto-close chats after (minutes of silence)</Label>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {[5, 10, 15, 30].map((n) => {
                      const active = (settings.inactivity_close_minutes || 10) === n;
                      return (
                        <button
                          key={n}
                          onClick={() => setSettings({ ...settings, inactivity_close_minutes: n })}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                          data-testid={`inactivity-close-${n}`}
                        >
                          {n} min
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Button onClick={saveSettings} disabled={savingSettings} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="save-inactivity-btn">
                  {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save inactivity rules"}
                </Button>
              </Card>
            )}
          </TabsContent>

          {/* QUICK REPLIES */}
          <TabsContent value="replies" className="space-y-6">
            <div>
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-1">Canned Responses</h1>
              <p className="text-sm text-slate-500">Answers your agents can insert with one click.</p>
            </div>
            <Card className="p-4 border-slate-200 bg-white max-w-2xl">
              <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] gap-3">
                <Input placeholder="Title" value={newReply.title} onChange={(e) => setNewReply({ ...newReply, title: e.target.value })} data-testid="new-reply-title" />
                <Input placeholder="Message content" value={newReply.content} onChange={(e) => setNewReply({ ...newReply, content: e.target.value })} data-testid="new-reply-content" />
                <Button onClick={addQuickReply} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="add-reply-btn"><Plus className="w-4 h-4" /></Button>
              </div>
            </Card>
            <div className="space-y-2 max-w-3xl">
              {quickReplies.map((q) => (
                <Card key={q.id} className="p-4 border-slate-200 bg-white flex items-start justify-between" data-testid={`reply-row-${q.id}`}>
                  <div>
                    <div className="font-semibold text-sm text-slate-900">{q.title}</div>
                    <div className="text-xs text-slate-500 mt-1">{q.content}</div>
                  </div>
                  <button onClick={() => deleteQuickReply(q.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg" data-testid={`delete-reply-${q.id}`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
