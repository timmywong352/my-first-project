import { useEffect, useState } from "react";

/**
 * Lily — animated SVG avatar whose expression tracks the current emotion.
 * Emotions: neutral | happy | anxious | angry | confused
 * When `speaking` is true the mouth pulses to fake lip-sync.
 */
const EMOTION_STYLES = {
  neutral:  { brow: 4,  mouth: "smile",  cheek: "peach", ring: "border-blue-200",   badge: "😊", label: "友好" },
  happy:    { brow: 6,  mouth: "wide",   cheek: "pink",  ring: "border-emerald-300", badge: "😄", label: "开心" },
  anxious:  { brow: -2, mouth: "flat",   cheek: "peach", ring: "border-amber-300",   badge: "😟", label: "关切" },
  angry:    { brow: -6, mouth: "small",  cheek: "rose",  ring: "border-rose-300",    badge: "🙏", label: "抱歉" },
  confused: { brow: 2,  mouth: "curve",  cheek: "peach", ring: "border-violet-300",  badge: "🤔", label: "在想" },
};

export default function LilyAvatar({ emotion = "neutral", speaking = false, size = 56, showLabel = false }) {
  const style = EMOTION_STYLES[emotion] || EMOTION_STYLES.neutral;
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (!speaking) return;
    const t = setInterval(() => setPulse((p) => (p + 1) % 4), 140);
    return () => clearInterval(t);
  }, [speaking]);

  // Mouth path variants
  let mouthPath;
  if (speaking) {
    // simple lip-sync: oval opening scales with pulse phase
    const openY = 12 + pulse * 3;
    mouthPath = `M 46 62 Q 60 ${72 + pulse * 2} 74 62 Q 60 ${openY + 62} 46 62 Z`;
  } else if (style.mouth === "smile") {
    mouthPath = "M 46 62 Q 60 74 74 62";
  } else if (style.mouth === "wide") {
    mouthPath = "M 44 62 Q 60 78 76 62 Q 60 68 44 62 Z";
  } else if (style.mouth === "flat") {
    mouthPath = "M 48 66 Q 60 66 72 66";
  } else if (style.mouth === "small") {
    mouthPath = "M 52 66 Q 60 62 68 66";
  } else if (style.mouth === "curve") {
    mouthPath = "M 46 66 Q 55 62 60 68 Q 65 62 74 66";
  } else {
    mouthPath = "M 46 62 Q 60 74 74 62";
  }

  const browOffsetLeft = -style.brow;
  const browOffsetRight = -style.brow;
  const cheekFill = style.cheek === "rose" ? "#FDA4AF" : style.cheek === "pink" ? "#FCA5A5" : "#FED7AA";

  return (
    <div className="inline-flex flex-col items-center">
      <div
        className={`relative rounded-full border-2 ${style.ring} bg-gradient-to-b from-amber-50 to-amber-100 shadow-lg transition-colors duration-500 ${speaking ? "animate-pulse" : ""}`}
        style={{ width: size, height: size }}
        data-testid="lily-avatar"
        data-emotion={emotion}
      >
        <svg viewBox="0 0 120 120" width={size} height={size} className="absolute inset-0">
          {/* Face */}
          <ellipse cx="60" cy="66" rx="38" ry="42" fill="#FFE4C4" />
          {/* Hair (bangs + sides) */}
          <path d="M 22 50 Q 30 18 60 18 Q 90 18 98 50 Q 92 42 78 40 Q 70 30 60 30 Q 50 30 42 40 Q 28 42 22 50 Z" fill="#5B3A29" />
          <path d="M 22 50 Q 26 62 28 78 Q 24 60 22 50 Z" fill="#5B3A29" />
          <path d="M 98 50 Q 94 62 92 78 Q 96 60 98 50 Z" fill="#5B3A29" />
          {/* Eyebrows */}
          <path d={`M 40 ${40 + browOffsetLeft} Q 46 ${37 + browOffsetLeft} 52 ${40 + browOffsetLeft}`} stroke="#3B2417" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d={`M 68 ${40 + browOffsetRight} Q 74 ${37 + browOffsetRight} 80 ${40 + browOffsetRight}`} stroke="#3B2417" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          {/* Eyes */}
          <ellipse cx="46" cy="52" rx="3.5" ry="4.5" fill="#3B2417" />
          <ellipse cx="74" cy="52" rx="3.5" ry="4.5" fill="#3B2417" />
          <circle cx="47" cy="50" r="1.2" fill="white" />
          <circle cx="75" cy="50" r="1.2" fill="white" />
          {/* Cheeks (blush) */}
          <ellipse cx="38" cy="62" rx="5" ry="3" fill={cheekFill} opacity="0.6" />
          <ellipse cx="82" cy="62" rx="5" ry="3" fill={cheekFill} opacity="0.6" />
          {/* Mouth */}
          <path d={mouthPath} stroke="#B04A3D" strokeWidth="2" fill={style.mouth === "wide" || speaking ? "#7F2A2A" : "none"} strokeLinecap="round" />
        </svg>
        {/* Speaking ring pulse */}
        {speaking && (
          <div className="absolute inset-0 rounded-full border-2 border-blue-400 animate-ping opacity-40" />
        )}
      </div>
      {showLabel && (
        <div className="mt-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
          <span>{style.badge}</span>
          <span>Lily · {style.label}</span>
        </div>
      )}
    </div>
  );
}

export const EMOTION_LABELS = {
  neutral:  { label: "中性", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", emoji: "😐" },
  happy:    { label: "开心", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", emoji: "😄" },
  anxious:  { label: "焦虑", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", emoji: "😟" },
  angry:    { label: "愤怒", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", emoji: "😠" },
  confused: { label: "困惑", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300", emoji: "🤔" },
};
