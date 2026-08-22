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
  Sparkles, XCircle, Plus, Camera, Trash2, ChevronUp, Bell, BellOff, RotateCcw,
  ArrowLeft, Gift,
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
import { tFactory } from "@/lib/i18n";
import {
  PROMOTIONS,
  findPromotion,
  matchPromoKeyword,
  promoStrings,
  PROMOTIONS_PAGE_URL,
} from "@/lib/promotions";
import {
  matchKnowledgeHub, formatExclusionLine, getPromotionDisplayData, GENERAL_TERMS,
  answerCalculationForPromo, findPromoById, matchFAQ, matchBirthdayClaimIntent,
  BIRTHDAY_CLAIM_INSTRUCTIONS, BIRTHDAY_INELIGIBLE_BRONZE,
} from "@/lib/knowledgeHub";
import { checkMemberTier, isTierEligibleForBirthdayBonus } from "@/lib/memberTierCheck";

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

// WhatsApp-style animated 3-dot typing indicator. Kept unified — used both
// by the customer widget's post-handoff "Agent is typing…" preview and by
// the Lily-phase "Lily is thinking… / System is processing…" indicator.
// Pass a `label` to render "<label> is typing…" alongside the dots; omit
// it (used inside a pre-labelled bubble) to render just the dots.
function TypingDots({ label }) {
  return (
    <div className="flex items-center gap-2" data-testid="typing-dots">
      <div className="flex space-x-1">
        <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1s" }} />
        <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "200ms", animationDuration: "1s" }} />
        <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "400ms", animationDuration: "1s" }} />
      </div>
      {label && <span className="text-sm text-slate-500">{label} is typing…</span>}
    </div>
  );
}

function fileIcon(ct) {
  if (ct && ct.startsWith("image/")) return <ImageIcon className="w-4 h-4" />;
  return <FileText className="w-4 h-4" />;
}

// Render plain text with any http(s) URLs converted into clickable anchor
// tags. Used for Lily's subtitle so promo links (e.g. the ms-MY promotions
// page URL) are tappable instead of showing as plain text.
const URL_REGEX = /(https?:\/\/[^\s]+)/gi;
function renderWithLinks(text) {
  if (!text) return null;
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (part && /^https?:\/\//i.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noreferrer noopener"
          className="text-blue-400 hover:text-blue-300 underline underline-offset-2 break-all"
          data-testid="lily-subtitle-link"
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
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
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${
        isCustomerSide ? "bg-white/10 border-white/20 text-white" : "bg-white border-slate-200 text-slate-700"
      }`}
    >
      {fileIcon(att.content_type)}
      <span className="truncate max-w-[160px]">{att.filename}</span>
    </a>
  );
}

// ---------- Promotions flow sub-components (self-contained) ----------
function PromoChooseMethod({ t, onPick }) {
  return (
    <div
      className="px-3 py-3 bg-slate-900/70 backdrop-blur border-t border-slate-800 space-y-2"
      data-testid="promo-choose-method"
    >
      <div className="rounded-2xl bg-slate-800/60 border border-slate-700 px-3 py-2 text-sm text-slate-100 leading-snug">
        {t.stepChooseTitle}
      </div>
      <div className="grid grid-cols-1 gap-2 pt-1">
        <button
          onClick={() => onPick("pick")}
          className="text-sm font-semibold rounded-2xl px-3 py-3 bg-blue-500 hover:bg-blue-600 text-white transition-colors"
          data-testid="promo-pick-btn"
        >
          {t.pickPromoBtn}
        </button>
        <button
          onClick={() => onPick("page")}
          className="text-sm font-semibold rounded-2xl px-3 py-3 bg-slate-800/60 border border-slate-700 hover:bg-slate-800 hover:border-blue-500/40 text-slate-100 transition-colors"
          data-testid="promo-view-page-btn"
        >
          {t.viewPageBtn}
        </button>
      </div>
    </div>
  );
}

function PromoPickPromoPanel({ t, promotions, value, onChange, error, onSend, onCancel }) {
  return (
    <div
      className="px-3 py-3 bg-slate-900/70 backdrop-blur border-t border-slate-800 space-y-2"
      data-testid="promo-pick-panel"
    >
      <div className="rounded-2xl bg-slate-800/60 border border-slate-700 px-3 py-2 text-sm text-slate-100 leading-snug">
        {t.pickPromoIntro}
      </div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 pt-1">
        {t.dropdownLabel} <span className="text-red-400">*</span>
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-base px-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        data-testid="promo-dropdown"
      >
        <option value="" disabled>{t.dropdownPlaceholder}</option>
        {promotions.map((p) => (
          <option key={p.id} value={p.id}>{p.title}</option>
        ))}
      </select>
      {error && (
        <div className="text-xs text-red-400" data-testid="promo-dropdown-error">{error}</div>
      )}
      <button
        onClick={onSend}
        className="w-full text-sm font-semibold rounded-2xl px-3 py-3 bg-blue-500 hover:bg-blue-600 text-white transition-colors"
        data-testid="promo-send-btn"
      >
        {t.sendBtn}
      </button>
      <button
        onClick={onCancel}
        className="w-full text-sm font-semibold rounded-2xl px-3 py-2 bg-transparent border border-slate-700 hover:bg-slate-800 text-slate-300 transition-colors"
        data-testid="promo-nevermind-btn"
      >
        {t.neverMindBtn}
      </button>
    </div>
  );
}

function PromoDetailPanel({ t, promo, onClaim, onViewOthers }) {
  if (!promo) return null;
  // Detail steps + closing + related articles now render as a persistent
  // Lily chat bubble (pushed via sayLily on promoConfirmPick). This panel
  // just carries the two action chips.
  return (
    <div
      className="px-3 py-3 bg-slate-900/70 backdrop-blur border-t border-slate-800 space-y-2"
      data-testid={`promo-detail-${promo.id}`}
    >
      <button
        onClick={onClaim}
        className="w-full text-sm font-semibold rounded-2xl px-3 py-3 bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
        data-testid="promo-claim-now-btn"
      >
        {t.claimNowBtn}
      </button>
      <button
        onClick={onViewOthers}
        className="w-full text-sm font-semibold rounded-2xl px-3 py-2 bg-transparent border border-slate-700 hover:bg-slate-800 text-slate-300 transition-colors"
        data-testid="promo-view-others-btn"
      >
        {t.viewOthersBtn}
      </button>
    </div>
  );
}

// Rich visual modal for the promotion detail — replaces the old text-bubble
// Step 3. Fills the widget body while it's open. All copy is derived from
// PROMOTIONS_KB via getPromotionDisplayData so it stays in sync with the
// single-source-of-truth data module.
const PROMO_MODAL_THEME = {
  welcome_lucky_288: { gradient: "from-purple-600 via-fuchsia-500 to-pink-500", accent: "text-pink-300", icon: Gift },
  monthly_188_spins: { gradient: "from-amber-500 via-orange-500 to-red-500", accent: "text-amber-300", icon: Sparkles },
  welcome_100_100: { gradient: "from-emerald-500 via-teal-500 to-cyan-500", accent: "text-emerald-300", icon: Star },
};

function PromoRichModal({ displayData, generalTerms, onBack, onClaim }) {
  if (!displayData) return null;
  const theme = PROMO_MODAL_THEME[displayData.id] || {
    gradient: "from-blue-600 to-indigo-600", accent: "text-blue-300", icon: Gift,
  };
  const Icon = theme.icon;
  return (
    <div
      className="absolute inset-0 z-30 bg-slate-950 flex flex-col overflow-hidden"
      data-testid={`promo-rich-modal-${displayData.id}`}
    >
      {/* Banner header */}
      <div className={`relative bg-gradient-to-br ${theme.gradient} px-4 pt-3 pb-5 shrink-0`}>
        <button
          type="button"
          onClick={onBack}
          data-testid="promo-modal-back-btn"
          className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-black/25 hover:bg-black/40 text-white text-xs font-semibold transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <div className="pt-6 flex items-start gap-3">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
            <Icon className="w-6 h-6 text-white" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-extrabold text-base leading-tight" data-testid="promo-modal-title">
              {displayData.title}
            </h2>
            <p className="text-white/90 text-xs mt-1 leading-snug">{displayData.bonus_description}</p>
          </div>
        </div>
      </div>

      {/* Tags row */}
      <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-slate-800 shrink-0 bg-slate-900/60">
        <PromoTag label="Min deposit" value={displayData.min_deposit_display} />
        <PromoTag label="Turnover" value={displayData.turnover_description} />
        <PromoTag label="Validity" value={displayData.bonus_validity} />
        <PromoTag label="Claim" value={displayData.claim_limit_display} />
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <PromoModalSection title="HOW TO APPLY" testid="promo-modal-how-to-apply">
          <ol className="list-decimal list-inside text-sm text-slate-200 space-y-1.5 leading-snug">
            {displayData.how_to_apply.map((s, i) => (
              <li key={i}>{renderWithLinks(s)}</li>
            ))}
          </ol>
        </PromoModalSection>

        <PromoModalSection title="DETAILS" testid="promo-modal-details">
          <div className="rounded-lg border border-slate-800 divide-y divide-slate-800 text-sm">
            <ModalDataRow label="Applicable games" value={displayData.applicable_games.join(", ") || "—"} />
            <ModalDataRow label="Credit timing" value={displayData.credit_timing || "—"} />
            <ModalDataRow label="Bonus type" value={displayData.bonus_description} />
          </div>
        </PromoModalSection>

        <PromoModalSection title="TERMS & CONDITIONS" testid="promo-modal-terms">
          <ol className="list-decimal list-inside text-xs text-slate-400 space-y-1 leading-snug">
            {(generalTerms || []).map((t, i) => (<li key={i}>{t}</li>))}
          </ol>
          {displayData.exclusion_line && (
            <div
              className="mt-2 text-sm text-red-400 font-medium"
              data-testid="promo-modal-exclusion-line"
            >
              {displayData.exclusion_line}
            </div>
          )}
        </PromoModalSection>
      </div>

      {/* Footer buttons */}
      <div className="border-t border-slate-800 p-3 grid grid-cols-2 gap-2 shrink-0 bg-slate-900/60">
        <button
          type="button"
          onClick={onBack}
          data-testid="promo-modal-back-footer-btn"
          className="text-sm font-semibold rounded-2xl px-3 py-3 bg-transparent border border-slate-700 hover:bg-slate-800 text-slate-300 transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onClaim}
          data-testid="promo-modal-claim-now-btn"
          className="text-sm font-semibold rounded-2xl px-3 py-3 bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
        >
          Claim Now
        </button>
      </div>
    </div>
  );
}

function PromoTag({ label, value }) {
  return (
    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800/70 border border-slate-700 text-xs">
      <span className="text-slate-500 uppercase tracking-wider font-semibold">{label}</span>
      <span className="text-slate-100 font-semibold">{value}</span>
    </div>
  );
}

function PromoModalSection({ title, children, testid }) {
  return (
    <div data-testid={testid}>
      <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function ModalDataRow({ label, value }) {
  return (
    <div className="flex gap-3 px-3 py-2">
      <div className="w-1/3 text-slate-500 text-xs uppercase tracking-wider font-semibold">{label}</div>
      <div className="flex-1 text-slate-200 text-sm leading-snug break-words">{value}</div>
    </div>
  );
}

function PromoHandoffConfirm({ t, onYes, onNo, loading }) {
  return (
    <div
      className="px-3 py-3 bg-slate-900/70 backdrop-blur border-t border-slate-800 space-y-2"
      data-testid="promo-handoff-confirm"
    >
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onYes}
          disabled={loading}
          className="text-sm font-semibold rounded-2xl px-3 py-3 bg-emerald-500 hover:bg-emerald-600 text-white transition-colors disabled:opacity-50"
          data-testid="promo-handoff-yes"
        >
          {t.confirmHandoffYes}
        </button>
        <button
          onClick={onNo}
          disabled={loading}
          className="text-sm font-semibold rounded-2xl px-3 py-3 bg-slate-800/60 border border-slate-700 hover:bg-slate-800 text-slate-100 transition-colors disabled:opacity-50"
          data-testid="promo-handoff-no"
        >
          {t.confirmHandoffNo}
        </button>
      </div>
    </div>
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
  const [options, setOptions] = useState(FALLBACK_OPTIONS);
  // Deposit-status confirm gate — populated from /api/lily/status per language.
  const [depositConfirmCopy, setDepositConfirmCopy] = useState({
    line1: "Let me connect you with our live chat agents who can help check your deposit status.",
    line2: "You'll be now redirected to another window to chat with our Customer Support team.",
    yes: "Yes, proceed",
    no: "No, cancel",
  });
  // Which quick-option is currently awaiting Yes/No confirm ({} when idle).
  const [pendingConfirm, setPendingConfirm] = useState(null);
  // Birthday Bonus tier-check flow: when set, the customer's next
  // message is treated as their username for the mock tier lookup.
  const [awaitingBirthdayUsername, setAwaitingBirthdayUsername] = useState(false);

  // ---------- Promotions flow (self-contained, non-LLM) ----------
  // promoStep: null | "choose_method" | "pick_promo" | "detail" |
  //            "claim_instructions" | "confirm_handoff"
  const [promoStep, setPromoStep] = useState(null);
  const [selectedPromoId, setSelectedPromoId] = useState("");
  const [promoDropdownError, setPromoDropdownError] = useState("");
  // Once the customer engages with a specific promotion, we remember which
  // one so subsequent typed messages route through the keyword matcher and
  // hand-offs carry the context.
  const [activePromoId, setActivePromoId] = useState(null);
  // A one-off Yes/No prompt driven by keyword matches ("Would you like me
  // to connect you to an agent?" flows).
  const [promoHandoffPrompt, setPromoHandoffPrompt] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [avatarClickPulse, setAvatarClickPulse] = useState(0);
  const lastGreetingRef = useRef("");
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lang] = useState("en");
  const [soundOn, setSoundOn] = useState(() => {
    const v = localStorage.getItem(SOUND_KEY);
    return v === null ? true : v === "1";
  });
  const t = tFactory(lang);
  const promoT = promoStrings(lang);
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
        if (data.deposit_confirm) setDepositConfirmCopy(data.deposit_confirm);
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

  // Push a client-side SYSTEM utterance into the messages log. Rendered
  // with a distinct "System" style (see chat-log below) so the customer
  // clearly distinguishes automated bot copy from Lily's actual greeting.
  // Shows a brief typing-dots indicator (`isProcessing`) before the bubble
  // appears — mimics BK8 / WhatsApp response latency. NO TTS: Lily's avatar
  // stays idle for system messages; only her greetings speak.
  const saySystem = useCallback((text, delay = 500) => {
    if (!text) return;
    setIsProcessing(true);
    setTimeout(() => {
      const id = `local_sys_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setMessages((prev) => [
        ...prev,
        {
          id,
          sender_type: "system",
          sender_name: "System",
          content: text,
          attachments: [],
          created_at: new Date().toISOString(),
        },
      ]);
      setIsProcessing(false);
    }, delay);
  }, []);

  // Immediate visual echo of a customer utterance during the Lily phase so
  // the user gets feedback before Lily replies / handoff kicks in. Server
  // will persist the definitive copy on handoff (different id → no dupe).
  const pushLocalCustomer = useCallback((text) => {
    if (!text) return;
    const id = `local_cust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setMessages((prev) => [
      ...prev,
      {
        id,
        sender_type: "customer",
        sender_name: "You",
        content: text,
        attachments: [],
        created_at: new Date().toISOString(),
      },
    ]);
  }, []);

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

  // Auto-scroll on new messages & typing preview.
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, agentTyping]);

  // On phase transitions (Lily → queued → chat) snap to the bottom so the
  // customer immediately sees the latest state without having to scroll.
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "instant", block: "end" });
    }
  }, [phase]);

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
      // Agent auto-assigned — go straight to chat.
      setQueuePosition(null);
      setPhase("chat");
    } else if (data.type === "chat_accepted") {
      // Legacy path (kept for compatibility with older backend deploys).
      setPhase("chat");
    } else if (data.type === "reassigning") {
      setPhase(data.queued ? "queued" : "chat");
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
    if (opt.key === "query_recharge") {
      setPendingConfirm(opt);
      saySystem(depositConfirmCopy.line1);
      setTimeout(() => saySystem(depositConfirmCopy.line2), 700);
      return;
    }
    if (opt.key === "view_promotions") {
      // Enter the promotions state machine — no handoff yet.
      setPromoStep("choose_method");
      saySystem(promoT.stepChooseTitle);
      return;
    }
    setLilyLoading(true);
    saySystem("Great — connecting you to a human agent now.");
    try {
      await handoffToHuman(opt.label);
    } finally {
      setLilyLoading(false);
    }
  };

  // ---------- Promotions flow handlers ----------
  const promoPickMethod = (method) => {
    if (method === "pick") {
      setPromoStep("pick_promo");
      setPromoDropdownError("");
      saySystem(promoT.pickPromoIntro);
    } else {
      // "View Promotion Page" branch — two Lily bubbles, then the widget
      // stays in "view_page" (no button panel, just the input) so the user
      // can type freely. We deliberately DO NOT reset back to the promo
      // chooser or the 4-button frontdesk here.
      setPromoStep("view_page");
      saySystem(promoT.viewPageMsg);
      setTimeout(() => {
        // Cancel any TTS still playing so the two utterances don't clip
        // each other (avoids the "play() was interrupted" warning too).
        cancelSpeak();
        setLilySpeaking(false);
        saySystem(promoT.viewPageFollowup);
      }, 1000);
    }
  };

  const promoConfirmPick = () => {
    if (!selectedPromoId) {
      setPromoDropdownError(promoT.dropdownRequired);
      return;
    }
    const p = findPromotion(selectedPromoId);
    if (!p) return;
    setActivePromoId(p.id);
    // Skip the text-bubble Step 3 entirely — open the rich visual modal
    // directly as the primary experience. Data (title, min_deposit,
    // turnover, exclusion line, HOW TO APPLY steps) is derived at render
    // time from PROMOTIONS_KB via getPromotionDisplayData.
    setPromoStep("rich_modal");
    setPromoDropdownError("");
  };

  // Modal "Back" button — closes the modal and returns the customer to
  // Step 1.5 (choose_method) so they can pick a different promo or switch
  // to "View Promotion Page". No handoff, no chat clutter.
  const promoModalBack = () => {
    setActivePromoId(null);
    setSelectedPromoId("");
    setPromoDropdownError("");
    setPromoStep("choose_method");
  };

  // "Related Articles" list item is no longer a rendered UI element (the
  // detail bubble is a plain text log entry now, matching BK8's format).
  // Kept as a no-op stub in case future spec re-introduces it.

  const promoNeverMind = () => {
    setSelectedPromoId("");
    setPromoDropdownError("");
    setPromoStep("choose_method");
    saySystem(promoT.stepChooseTitle);
  };

  const promoClaim = () => {
    const p = findPromotion(activePromoId);
    if (!p) return;
    setPromoStep("claim_instructions");
    // Two-bubble sequence per spec: short opener, then the detailed steps.
    saySystem(promoT.claimIntro1);
    setTimeout(() => {
      cancelSpeak();
      setLilySpeaking(false);
      saySystem(promoT.claimIntro2(p));
    }, 1000);
  };

  const promoViewOthers = () => {
    setSelectedPromoId("");
    setActivePromoId(null);
    setPromoStep("choose_method");
    saySystem(promoT.stepChooseTitle);
  };

  const promoConfirmHandoffYes = async () => {
    const prompt = promoHandoffPrompt;
    setPromoHandoffPrompt(null);
    const p = findPromotion(activePromoId);
    // Preserve the customer's original question in the handoff payload so
    // the human agent sees exactly what triggered the handoff, not just
    // the promo title.
    const userText = prompt?.context;
    const base = p ? `Promotions: ${p.title}` : "Promotions inquiry";
    const ctx = userText ? `${base} — ${userText}` : base;
    setLilyLoading(true);
    saySystem("Great — connecting you to a human agent now.");
    try {
      await handoffToHuman(ctx);
    } finally {
      setLilyLoading(false);
    }
  };

  const promoConfirmHandoffNo = () => {
    setPromoHandoffPrompt(null);
    saySystem("No problem — is there anything else I can help you with today?");
  };

  const confirmDepositProceed = async () => {
    if (!pendingConfirm || lilyLoading) return;
    const opt = pendingConfirm;
    setPendingConfirm(null);
    setLilyLoading(true);
    saySystem("Great — connecting you to a human agent now.");
    try {
      await handoffToHuman(opt.label);
    } finally {
      setLilyLoading(false);
    }
  };

  const cancelDepositConfirm = () => {
    // Reset to the frontdesk (initial Lily greeting + 4 quick-option buttons).
    setPendingConfirm(null);
    setLilySubtitle("");
    cancelSpeak();
    setLilySpeaking(false);
  };

  // ---------- Send message ----------
  const sendMessage = async () => {
    if (!text.trim() && pendingAttachments.length === 0) return;

    if (phase === "lily") {
      const userText = text.trim();
      setText("");
      setPendingAttachments([]);
      flushTyping("");

      // Show the customer's own message immediately as a bubble in the log.
      if (userText) pushLocalCustomer(userText);

      // ── Birthday Bonus tier-check flow ────────────────────────────
      // If we asked for a username in the previous turn, this reply is
      // treated as the username. Runs BEFORE all other matchers.
      if (awaitingBirthdayUsername) {
        setAwaitingBirthdayUsername(false);
        const { tier } = checkMemberTier(userText);
        if (isTierEligibleForBirthdayBonus(tier)) {
          saySystem(BIRTHDAY_CLAIM_INSTRUCTIONS);
        } else {
          saySystem(BIRTHDAY_INELIGIBLE_BRONZE);
        }
        return;
      }

      // Birthday-claim intent triggers the username request. This must
      // be checked BEFORE the FAQ matcher so "claim my birthday bonus"
      // routes to the tier flow rather than the info FAQ.
      if (matchBirthdayClaimIntent(userText) === "claim") {
        setAwaitingBirthdayUsername(true);
        saySystem("Sure! Could you share your username so I can check your eligibility for the Birthday Bonus?");
        return;
      }

      // FAQ matcher — returns informational answers (no calc). Runs both
      // inside and outside active-promo flow so common questions (rebate,
      // password reset, registration, referral, VIP tier) always work.
      const faqHit = matchFAQ(userText);
      if (faqHit) {
        saySystem(faqHit.reply);
        return;
      }

      // Promotions flow: while the customer is inside an active promo
      // conversation, route their text through this three-priority ladder
      // so we NEVER trigger an instant/silent handoff — every handoff
      // requires an explicit Yes on a confirm prompt.
      //   (1) Calculation reply for the ACTIVE promo (amount + calc keyword)
      //   (2) Existing Step 6 keyword groups (acknowledge / confirm_handoff /
      //       [former] instant_handoff — now also a confirm_handoff)
      //   (3) No match → Yes/No confirm before handoff
      if (activePromoId) {
        // Look up the RAW PROMOTIONS_KB entry (not the derived display
        // shape from findPromotion) — the calculation engine needs
        // bonus_percent / max_bonus / turnover_multiplier / free_spin_tiers
        // which live on the KB entry, not on the UI display object.
        const activePromo = findPromoById(activePromoId);

        // (0) VAGUE-MENTION GUARD: If the text mentions any promo's
        // keyword AND lacks an EXPLICIT deposit context (currency prefix
        // like "RM 50" or a "deposit 50" phrase), route to Step 1.5. This
        // prevents "I want to know 188 free spins" from being mis-read as
        // "deposit 188 in the active 288% flow" (bare-number extraction).
        const kbMention = matchKnowledgeHub(userText);
        const hasCurrencyPrefix = /(?:rm|myr|\$)\s*\d/i.test(userText);
        const hasDepositContext = /(?:deposit|topup|top[-\s]?up|dep)\s+(?:of\s+|about\s+)?\d/i.test(userText);
        if (kbMention && kbMention.promo && !hasCurrencyPrefix && !hasDepositContext) {
          setActivePromoId(null);
          setSelectedPromoId("");
          setPromoDropdownError("");
          setPromoStep("choose_method");
          saySystem(promoT.stepChooseTitle);
          return;
        }

        // (1) Calc question against the active promo
        const calc = answerCalculationForPromo(activePromo, userText);
        if (calc) {
          saySystem(calc.reply);
          return;
        }

        // (2) Existing keyword groups
        const match = matchPromoKeyword(userText);
        if (match?.action === "acknowledge") {
          saySystem(match.reply);
          return;
        }
        if (match?.action === "confirm_handoff") {
          setPromoHandoffPrompt({ reply: match.reply, context: userText });
          saySystem(match.reply);
          return;
        }
        if (match?.action === "instant_handoff") {
          // Former instant-handoff triggers ("problem"/"issue"/"not working")
          // now require an explicit Yes/No confirmation too — friendlier
          // phrasing preserved.
          const friendlierReply =
            "I'm sorry to hear that. Would you like me to connect you to a live agent who can help?";
          setPromoHandoffPrompt({ reply: friendlierReply, context: userText });
          saySystem(friendlierReply);
          return;
        }

        // (3) Genuinely unmatched → Yes/No confirm before handoff.
        const fallbackReply =
          "I'm not sure how to answer that. Would you like me to connect you to a live agent who can help?";
        setPromoHandoffPrompt({ reply: fallbackReply, context: userText });
        saySystem(fallbackReply);
        return;
      } else {
        // Knowledge Hub: try to answer promo questions before falling
        // through to immediate handoff. Only runs when the customer is
        // NOT already inside the guided Promotions flow (activePromoId
        // gates that). Quick-option button flows (Deposit/Withdrawal/
        // Ticket) hit their own branches earlier so they're untouched.
        const kb = matchKnowledgeHub(userText);
        if (kb && kb.promo) {
          if (kb.outcome) {
            // Amount present → answer the calculation directly.
            saySystem(kb.reply);
          } else {
            // Vague promo mention (name only, no calc intent) — guide the
            // customer into the guided Promotions flow at Step 1.5 rather
            // than dumping a wall of T&C text or throwing them to an agent.
            setPromoStep("choose_method");
            saySystem(promoT.stepChooseTitle);
          }
          return;
        }
      }

      setLilyLoading(true);
      saySystem("Great — connecting you to a human agent now.");
      try {
        const p = activePromoId ? findPromotion(activePromoId) : null;
        const ctx = p ? `Promotions: ${p.title} — ${userText}` : userText;
        await handoffToHuman(ctx);
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

  // Customer-initiated close: instant UI flip, network call fires in background.
  const confirmClose = () => {
    if (!session || closing) return;
    // 1) Optimistic UI flip so the modal disappears and the "closed" screen
    //    shows within a single frame.
    setPhase("closed");
    setClosedNotice("This chat has been closed. Thank you for contacting us!");
    setCloseConfirmOpen(false);
    // 2) Fire the actual API call in the background — no await so we don't
    //    block the UI. If it fails, the server-side WS event will eventually
    //    reconcile us anyway.
    setClosing(true);
    fetch(
      `${API}/chat/public/${session.session_id}/close?session_token=${session.session_token}`,
      { method: "POST" },
    ).catch(() => { /* silent — UI already reflects closed state */ })
      .finally(() => setClosing(false));
  };

  const endChat = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setMessages([]);
    setPhase("connecting");
    setCsatRating(0);
    setCsatSubmitted(false);
    setLilySubtitle("");
    // Reset promotions flow state so a fresh session starts on the frontdesk.
    setPromoStep(null);
    setSelectedPromoId("");
    setPromoDropdownError("");
    setActivePromoId(null);
    setPromoHandoffPrompt(null);
    setPendingConfirm(null);
    bootedRef.current = false;
    // Re-bootstrap: create a new anonymous session immediately.
    bootstrap();
  };

  // Header "Start over" button: resets local UI state back to the Lily
  // frontdesk. In an active agent chat we prompt first — otherwise reset
  // immediately. Backend session/chat data is untouched.
  const restartToFrontdesk = () => {
    setRestartConfirmOpen(false);
    endChat();
  };

  const onRestartClick = () => {
    if (phase === "chat" || phase === "queued") {
      setRestartConfirmOpen(true);
    } else {
      restartToFrontdesk();
    }
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
          className="fixed bottom-24 right-6 z-50 w-[calc(100vw-32px)] sm:w-[420px] h-[700px] max-h-[90vh] bg-slate-900 rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-slate-800"
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
                <div className="font-bold text-base leading-tight">{t("header_title")}</div>
                <div className="text-xs opacity-90 flex items-center gap-1.5">
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
              {/* Language switcher removed — widget forced to English. Translation
                  strings remain in /lib/i18n.js and /lib/promotions.js. */}
              {/* Restart / Start-over — resets local UI to the Lily frontdesk */}
              <button
                onClick={onRestartClick}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title={t("restart")}
                aria-label={t("restart")}
                data-testid="refresh-restart-btn"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
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
                onClick={() => {
                  // Reset promo/deposit flow state so reopening lands on the
                  // 4-option frontdesk (Lily greeting) — spec requirement.
                  setPromoStep(null);
                  setSelectedPromoId("");
                  setPromoDropdownError("");
                  setActivePromoId(null);
                  setPromoHandoffPrompt(null);
                  setPendingConfirm(null);
                  setOpen(false);
                }}
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
              <div className="text-base text-slate-400">Waking Lily up…</div>
              {errorMsg && (
                <div className="text-sm text-red-400 max-w-[280px] text-center px-4" data-testid="widget-error">{errorMsg}</div>
              )}
            </div>
          )}

          {/* Lily Stage — BK8-style chat log: compact avatar + persistent
              scrollable message bubbles. Client-side utterances (promo copy,
              deposit gate, transitions) accumulate in `messages` via sayLily. */}
          {phase === "lily" && session && (
            <div className="relative flex-1 flex flex-col overflow-hidden bg-slate-900" data-testid="lily-stage">
              {/* Rich promo modal overlays the entire Lily stage when active */}
              {promoStep === "rich_modal" && activePromoId && (
                <PromoRichModal
                  displayData={getPromotionDisplayData(activePromoId)}
                  generalTerms={GENERAL_TERMS}
                  onBack={promoModalBack}
                  onClaim={promoClaim}
                />
              )}
              {/* Compact avatar + status strip */}
              <div className="px-4 pt-4 pb-2 flex items-center gap-3 border-b border-slate-800/60">
                <div className="shrink-0">
                  <LilyAvatar
                    mode="2d"
                    speaking={lilySpeaking}
                    emotion={lilyLoading ? "thinking" : "greeting"}
                    size={56}
                    onAvatarClick={handleAvatarClick}
                    clickPulse={avatarClickPulse}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-base font-bold text-slate-100 leading-tight">Lily</div>
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    {lilyLoading ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Thinking…</span>
                      </>
                    ) : lilySpeaking ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Speaking…</span>
                      </>
                    ) : (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span>AI Assistant · Online</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Scrollable chat log */}
              <div
                className="flex-1 overflow-y-auto p-4 space-y-3"
                data-testid="lily-chat-log"
              >
                {messages.map((m) => {
                  const isCustomer = m.sender_type === "customer";
                  const isSystem = m.sender_type === "system";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${isCustomer ? "justify-end" : "justify-start"}`}
                      data-testid={`lily-msg-${m.id}`}
                    >
                      <div className="max-w-[85%]">
                        {/* Sender tag above bubble (only for automated senders) */}
                        {!isCustomer && (
                          <div
                            className={`text-xs font-semibold uppercase tracking-wider mb-1 px-1 ${
                              isSystem ? "text-purple-400" : "text-emerald-400"
                            }`}
                            data-testid={`sender-tag-${isSystem ? "system" : "lily"}`}
                          >
                            {isSystem ? "System" : "Lily"}
                          </div>
                        )}
                        <div
                          className={`px-4 py-3 text-base rounded-2xl shadow-sm whitespace-pre-wrap break-words leading-relaxed ${
                            isCustomer
                              ? "text-white rounded-tr-sm bg-blue-500"
                              : isSystem
                                ? "bg-slate-900/70 text-slate-200 rounded-tl-sm border border-slate-700 border-l-2 border-l-purple-500"
                                : "bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700"
                          }`}
                        >
                          {isCustomer ? m.content : renderWithLinks(m.content)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(isProcessing || lilyLoading) && (
                  <div className="flex justify-start" data-testid="processing-indicator">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider mb-1 px-1 text-slate-500">
                        {lilyLoading ? "Lily" : "System"}
                      </div>
                      <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-slate-800/70 border border-slate-700 text-slate-400 text-sm italic flex items-center gap-2">
                        <TypingDots />
                        <span>{lilyLoading ? "Lily is thinking…" : "System is processing…"}</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Deposit-status confirm gate — shown INSTEAD of the 4 options.
                  The two grey text boxes are gone; the confirm copy now lives
                  in the chat log above (pushed by sayLily). Only Yes/No here. */}
              {pendingConfirm ? (
                <div
                  className="px-3 py-3 bg-slate-900/70 backdrop-blur border-t border-slate-800"
                  data-testid="deposit-confirm"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={confirmDepositProceed}
                      disabled={lilyLoading}
                      className="text-sm font-semibold rounded-2xl px-3 py-3 bg-emerald-500 hover:bg-emerald-600 text-white transition-colors disabled:opacity-50"
                      data-testid="deposit-confirm-yes"
                    >
                      {depositConfirmCopy.yes}
                    </button>
                    <button
                      onClick={cancelDepositConfirm}
                      disabled={lilyLoading}
                      className="text-sm font-semibold rounded-2xl px-3 py-3 bg-slate-800/60 border border-slate-700 hover:bg-slate-800 hover:border-red-500/40 text-slate-100 transition-colors disabled:opacity-50"
                      data-testid="deposit-confirm-no"
                    >
                      {depositConfirmCopy.no}
                    </button>
                  </div>
                </div>
              ) : promoStep === "choose_method" ? (
                <PromoChooseMethod t={promoT} onPick={promoPickMethod} />
              ) : promoStep === "pick_promo" ? (
                <PromoPickPromoPanel
                  t={promoT}
                  promotions={PROMOTIONS}
                  value={selectedPromoId}
                  onChange={(v) => { setSelectedPromoId(v); setPromoDropdownError(""); }}
                  error={promoDropdownError}
                  onSend={promoConfirmPick}
                  onCancel={promoNeverMind}
                />
              ) : promoStep === "detail" ? (
                <PromoDetailPanel
                  t={promoT}
                  promo={findPromotion(activePromoId)}
                  onClaim={promoClaim}
                  onViewOthers={promoViewOthers}
                />
              ) : promoHandoffPrompt ? (
                <PromoHandoffConfirm
                  t={promoT}
                  onYes={promoConfirmHandoffYes}
                  onNo={promoConfirmHandoffNo}
                  loading={lilyLoading}
                />
              ) : promoStep === "view_page" ? (
                // Step 2B ("View Promotion Page") passive state — the two
                // Lily bubbles are already shown in the subtitle. We render
                // no button panel here so the widget doesn't fall through to
                // the 4-option frontdesk. The input below stays available
                // for the customer to type freely.
                <div
                  className="px-3 py-2 bg-slate-900/70 backdrop-blur border-t border-slate-800"
                  data-testid="promo-view-page-passive"
                />
              ) : promoStep === "claim_instructions" ? (
                // Step 5 ("Claim now") passive state — the two-bubble claim
                // instructions live in the chat log above. No button panel
                // here so the widget doesn't fall through to the 4-option
                // frontdesk. Customer can type freely (→ handoff w/ context).
                <div
                  className="px-3 py-2 bg-slate-900/70 backdrop-blur border-t border-slate-800"
                  data-testid="promo-claim-passive"
                />
              ) : promoStep === "rich_modal" ? (
                // Rich modal is currently overlaying the entire Lily stage
                // — no bottom panel needed. Keep a small spacer so the
                // input still sits at the bottom of the widget.
                <div
                  className="px-3 py-2 bg-slate-900/70 backdrop-blur border-t border-slate-800"
                  data-testid="promo-rich-modal-passive"
                />
              ) : (
                /* 4 fixed option buttons */
                <div className="px-3 py-2 grid grid-cols-2 gap-2 bg-slate-900/70 backdrop-blur border-t border-slate-800" data-testid="lily-options">
                  {options.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => chooseOption(o)}
                      disabled={lilyLoading}
                      className="text-sm font-semibold rounded-2xl px-3 py-3 bg-slate-800/60 border border-slate-700 hover:bg-slate-800 hover:border-blue-500/40 text-slate-100 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                      data-testid={`lily-option-${o.key}`}
                    >
                      <span className="text-base">{o.emoji}</span>
                      <span>{o.label}</span>
                    </button>
                  ))}
                </div>
              )}

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
                    className="flex-1 resize-none min-h-[44px] max-h-24 rounded-xl bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500 text-base focus-visible:ring-blue-500"
                  />
                  <Button
                    onClick={sendMessage}
                    size="icon"
                    className="rounded-xl h-11 w-11 shrink-0 text-white bg-blue-500 hover:bg-blue-600"
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
              <div className="text-base font-semibold text-slate-300 mt-1">You&apos;re in the queue</div>
              <div className="text-sm text-slate-500 max-w-[280px] mt-2 mb-4">
                All our agents are helping other customers. We&apos;ll connect you as soon as one is free.
              </div>
              <Clock className="w-4 h-4 text-slate-600 mb-3" />
            </div>
          )}

          {/* Waiting for a specific agent to Accept (30s pending offer) */}
          {phase === "waiting_agent" && session && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center bg-slate-900" data-testid="waiting-agent-view">
              <LilyAvatar mode="2d" speaking={false} emotion="friendly" size={90} />
              <div className="mt-4 flex items-center gap-2 text-slate-100">
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                <span className="text-base font-semibold">Connecting you to the next available agent…</span>
              </div>
              <div className="text-sm text-slate-500 max-w-[280px] mt-3">
                Hang tight — one of our agents is picking up your chat right now.
              </div>
            </div>
          )}

          {/* Human chat */}
          {phase === "chat" && session && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-900" data-testid="chat-messages">
                {messages.map((m) => {
                  const isCustomer = m.sender_type === "customer";
                  const isLily = m.sender_type === "lily";
                  const isSystem = m.sender_type === "system";
                  return (
                    <div key={m.id} className={`flex ${isCustomer ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-[85%] space-y-1.5" data-testid={`msg-${m.id}`}>
                        {!isCustomer && (isLily || isSystem) && (
                          <div
                            className={`text-xs font-semibold uppercase tracking-wider px-1 ${
                              isSystem ? "text-purple-400" : "text-emerald-400"
                            }`}
                            data-testid={`sender-tag-${isSystem ? "system" : "lily"}`}
                          >
                            {isSystem ? "System" : "Lily"}
                          </div>
                        )}
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
                            className={`px-4 py-3 text-base rounded-2xl shadow-sm whitespace-pre-wrap break-words ${
                              isCustomer
                                ? "text-white rounded-tr-sm bg-blue-500"
                                : isSystem
                                  ? "bg-slate-900/70 text-slate-200 rounded-tl-sm border border-slate-700 border-l-2 border-l-purple-500"
                                  : isLily
                                    ? "bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700 italic"
                                    : "bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700"
                            }`}
                          >
                            {isCustomer ? m.content : renderWithLinks(m.content)}
                            {m.edited && <span className="text-xs opacity-70 ml-1.5 italic">(edited)</span>}
                          </div>
                        )}
                        {isCustomer && (
                          <div className="flex justify-end items-center gap-1 text-xs text-slate-500 pr-1">
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
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-3 text-base bg-slate-800/60 text-slate-400 italic border border-dashed border-slate-700">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 not-italic mr-1.5">Agent is typing:</span>
                      {agentPreview}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {pendingAttachments.length > 0 && (
                <div className="px-3 py-3 border-t border-slate-800 bg-slate-800/50 space-y-2" data-testid="attach-tray">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                      <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                        <Check className="w-2.5 h-2.5" />
                      </div>
                      {pendingAttachments.length} of {pendingAttachments.length} uploaded
                    </div>
                    <button
                      onClick={() => setPendingAttachments([])}
                      className="text-xs text-slate-500 hover:text-slate-300"
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
                              <span className="text-xs truncate max-w-full leading-tight">{a.filename}</span>
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
                    className="w-full h-10 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold text-base shadow-lg shadow-blue-500/20"
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
                        className="w-full flex items-center gap-2.5 px-3 py-3 rounded-lg hover:bg-slate-700/70 text-base text-slate-100 text-left"
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
                        className="w-full flex items-center gap-2.5 px-3 py-3 rounded-lg hover:bg-slate-700/70 text-base text-slate-100 text-left"
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
                    className="flex-1 resize-none min-h-[44px] rounded-xl bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500 text-base focus-visible:ring-blue-500 leading-relaxed"
                  />
                  <Button
                    onClick={sendMessage}
                    size="icon"
                    className="rounded-xl h-11 w-11 shrink-0 text-white bg-blue-500 hover:bg-blue-600"
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
              <div className="w-full mb-4 px-4 py-3 rounded-xl bg-slate-800 text-slate-200 text-base border border-slate-700 shadow-sm" data-testid="chat-closed-banner">
                {closedNotice || "This chat has ended. Thanks for chatting with us!"}
              </div>
              {!csatSubmitted ? (
                <>
                  <h3 className="text-xl font-extrabold text-slate-100 mb-2">Rate your experience</h3>
                  <p className="text-base text-slate-400 mb-6">How was your chat with Lily and our team?</p>
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
                  <p className="text-base text-slate-400 mb-6">See you next time.</p>
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

      {/* Restart / Start-over confirmation (only shown when in active chat) */}
      <AlertDialog open={restartConfirmOpen} onOpenChange={setRestartConfirmOpen}>
        <AlertDialogContent
          className="bg-slate-900 border-slate-700 text-slate-100 z-[60] rounded-2xl"
          data-testid="restart-confirm-dialog"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-100">
              {t("restart_confirm_title")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t("restart_confirm_body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700 hover:text-white"
              data-testid="restart-confirm-cancel"
            >
              {t("restart_confirm_no")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={restartToFrontdesk}
              className="bg-blue-500 text-white hover:bg-blue-600 focus-visible:ring-blue-500"
              data-testid="restart-confirm-confirm"
            >
              {t("restart_confirm_yes")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
