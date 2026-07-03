import ChatWidget from "@/components/ChatWidget";
import { Link } from "react-router-dom";
import { MessageCircle, Zap, ShieldCheck, Sparkles } from "lucide-react";

export default function WidgetDemo() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50/30 to-white">
      <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2" data-testid="home-link">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20">
            <MessageCircle className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-lg font-extrabold text-slate-900">Pulse</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-semibold text-slate-600 hover:text-slate-900" data-testid="nav-login">Agent Login</Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-xs font-semibold text-blue-700 mb-6">
            <Sparkles className="w-3 h-3" /> Now with AI reply suggestions
          </div>
          <h1 className="text-5xl lg:text-6xl font-extrabold text-slate-900 tracking-tight leading-[1.02] mb-6">
            Meet your customers<br />where they already are.
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed max-w-2xl mb-8">
            A modern live chat platform for teams that care. Real-time WebSocket messaging,
            AI-suggested replies, file attachments up to 25MB, and a friendly widget your
            visitors will actually want to use. Click the smiley button in the corner
            to try it →
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/login" className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-lg shadow-blue-600/20 transition-colors" data-testid="cta-login">
              Open agent dashboard →
            </Link>
            <a href="#features" className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold hover:border-slate-300">
              See features
            </a>
          </div>
        </div>

        <div id="features" className="mt-24 grid md:grid-cols-3 gap-6">
          {[
            { icon: Zap, title: "Real-time by default", desc: "WebSockets keep customer and agent perfectly in sync. Zero refresh." },
            { icon: Sparkles, title: "AI-powered replies", desc: "Claude Sonnet suggests reply drafts based on the full conversation context." },
            { icon: ShieldCheck, title: "Secure storage", desc: "Files up to 25MB stored securely with authenticated access only." },
          ].map((f) => (
            <div key={f.title} className="p-6 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="font-bold text-slate-900 mb-1.5">{f.title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <ChatWidget />
    </div>
  );
}
