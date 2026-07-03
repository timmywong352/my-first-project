import { useState } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { MessageCircle, Loader2 } from "lucide-react";

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@livechat.com");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  if (user && user !== null && user !== false) {
    return <Navigate to={user.role === "admin" ? "/admin" : "/dashboard"} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const u = await login(email, password);
      navigate(u.role === "admin" ? "/admin" : "/dashboard");
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="grid lg:grid-cols-2 gap-12 max-w-5xl w-full items-center">
        <div className="hidden lg:block">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
              <MessageCircle className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-xl font-extrabold text-slate-900 tracking-tight">Pulse</span>
          </div>
          <h1 className="text-5xl font-extrabold text-slate-900 tracking-tight leading-[1.05] mb-6">
            Talk to your customers.<br />
            <span className="text-blue-600">Right when they need you.</span>
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed mb-8 max-w-md">
            A modern live chat platform for teams that care. Real-time messaging,
            AI-suggested replies, and a friendly widget your customers will love.
          </p>
          <div className="space-y-3">
            {[
              "Real-time WebSocket messaging",
              "AI reply suggestions & chat summaries",
              "File attachments up to 25MB",
              "Business hours & branded widget",
            ].map((t) => (
              <div key={t} className="flex items-center gap-3 text-slate-700">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                <span className="text-sm">{t}</span>
              </div>
            ))}
          </div>
        </div>

        <Card className="p-8 shadow-xl shadow-slate-200/60 border-slate-200 bg-white">
          <div className="lg:hidden flex items-center gap-2 mb-6">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-extrabold text-slate-900">Pulse</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-1">Welcome back</h2>
          <p className="text-sm text-slate-500 mb-6">Sign in to your agent dashboard.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-slate-600">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="login-email-input"
                className="h-11 rounded-lg border-slate-200 focus-visible:ring-blue-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-slate-600">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="login-password-input"
                className="h-11 rounded-lg border-slate-200 focus-visible:ring-blue-500"
              />
            </div>
            {err && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2" data-testid="login-error">
                {err}
              </div>
            )}
            <Button
              type="submit"
              disabled={loading}
              data-testid="login-submit-button"
              className="w-full h-11 rounded-lg bg-blue-600 hover:bg-blue-700 font-semibold shadow-md shadow-blue-600/20"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>
          <div className="mt-6 text-xs text-slate-500 bg-slate-50 rounded-lg p-3 border border-slate-100">
            <div className="font-semibold text-slate-700 mb-1">Demo accounts</div>
            <div>Admin: admin@livechat.com / admin123</div>
            <div>Agent: agent@livechat.com / agent123</div>
          </div>
          <div className="mt-4 text-center text-sm">
            <Link to="/widget-demo" className="text-blue-600 hover:underline font-medium" data-testid="link-widget-demo">
              → Try the customer widget
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
