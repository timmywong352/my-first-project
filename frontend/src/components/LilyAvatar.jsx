import { useEffect, useState } from "react";

/**
 * Lily — customer-facing avatar.
 *
 * Two rendering modes:
 *  - image URL provided → shows the uploaded portrait inside a circular frame
 *    with animated glow/pulse effects when Lily is speaking.
 *  - no image → falls back to the animated SVG cartoon face driven by
 *    `emotion` so we never render a blank widget.
 */
const EMOTION_STYLES = {
  neutral:  { brow: 4,  mouth: "smile",  cheek: "peach", ring: "border-blue-200",    badge: "😊", label: "Friendly" },
  happy:    { brow: 6,  mouth: "wide",   cheek: "pink",  ring: "border-emerald-300", badge: "😄", label: "Cheerful" },
  anxious:  { brow: -2, mouth: "flat",   cheek: "peach", ring: "border-amber-300",   badge: "😟", label: "Concerned" },
  angry:    { brow: -6, mouth: "small",  cheek: "rose",  ring: "border-rose-300",    badge: "🙏", label: "Apologetic" },
  confused: { brow: 2,  mouth: "curve",  cheek: "peach", ring: "border-violet-300",  badge: "🤔", label: "Thinking" },
};

// Uploaded Lily portrait — anime-style character with blue dress + castle.
export const LILY_IMAGE_URL =
  "https://customer-assets.emergentagent.com/job_live-chat-hub-28/artifacts/g4bxi3t1_image.png";

export default function LilyAvatar({
  emotion = "neutral",
  speaking = false,
  size = 56,
  showLabel = false,
  imageUrl = LILY_IMAGE_URL,
}) {
  const style = EMOTION_STYLES[emotion] || EMOTION_STYLES.neutral;
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (!speaking) return;
    const t = setInterval(() => setPulse((p) => (p + 1) % 4), 140);
    return () => clearInterval(t);
  }, [speaking]);

  // ---------- Image mode ----------
  if (imageUrl) {
    return (
      <div className="inline-flex flex-col items-center">
        <div
          className={`relative rounded-full overflow-hidden shadow-2xl ring-4 transition-all duration-300 ${
            speaking ? "ring-pink-300/80" : "ring-white/60"
          }`}
          style={{ width: size, height: size }}
          data-testid="lily-avatar"
          data-emotion={emotion}
          data-speaking={speaking ? "true" : "false"}
        >
          <img
            src={imageUrl}
            alt="Lily"
            className={`w-full h-full object-cover transition-transform duration-300 ${
              speaking ? "scale-105" : "scale-100"
            }`}
            draggable={false}
          />
          {/* Soft gradient overlay for a "spotlight" video-call vibe */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/10 pointer-events-none" />
          {/* Speaking pulse rings */}
          {speaking && (
            <>
              <div className="absolute -inset-1 rounded-full border-2 border-pink-400/50 animate-ping" />
              <div
                className="absolute -inset-3 rounded-full border border-pink-300/40 animate-ping"
                style={{ animationDelay: "150ms" }}
              />
            </>
          )}
          {/* Bottom "waveform" bars while speaking */}
          {speaking && (
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex items-end gap-0.5 h-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="w-0.5 bg-white rounded-full shadow"
                  style={{
                    height: `${30 + ((pulse + i) % 4) * 20}%`,
                    transition: "height 140ms ease-out",
                  }}
                />
              ))}
            </div>
          )}
        </div>
        {showLabel && (
          <div className="mt-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Lily · {speaking ? "Speaking…" : "Online"}
          </div>
        )}
      </div>
    );
  }

  // ---------- SVG fallback ----------
  let mouthPath;
  if (speaking) {
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
          <ellipse cx="60" cy="66" rx="38" ry="42" fill="#FFE4C4" />
          <path d="M 22 50 Q 30 18 60 18 Q 90 18 98 50 Q 92 42 78 40 Q 70 30 60 30 Q 50 30 42 40 Q 28 42 22 50 Z" fill="#5B3A29" />
          <path d="M 22 50 Q 26 62 28 78 Q 24 60 22 50 Z" fill="#5B3A29" />
          <path d="M 98 50 Q 94 62 92 78 Q 96 60 98 50 Z" fill="#5B3A29" />
          <path d={`M 40 ${40 + browOffsetLeft} Q 46 ${37 + browOffsetLeft} 52 ${40 + browOffsetLeft}`} stroke="#3B2417" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d={`M 68 ${40 + browOffsetRight} Q 74 ${37 + browOffsetRight} 80 ${40 + browOffsetRight}`} stroke="#3B2417" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <ellipse cx="46" cy="52" rx="3.5" ry="4.5" fill="#3B2417" />
          <ellipse cx="74" cy="52" rx="3.5" ry="4.5" fill="#3B2417" />
          <circle cx="47" cy="50" r="1.2" fill="white" />
          <circle cx="75" cy="50" r="1.2" fill="white" />
          <ellipse cx="38" cy="62" rx="5" ry="3" fill={cheekFill} opacity="0.6" />
          <ellipse cx="82" cy="62" rx="5" ry="3" fill={cheekFill} opacity="0.6" />
          <path d={mouthPath} stroke="#B04A3D" strokeWidth="2" fill={style.mouth === "wide" || speaking ? "#7F2A2A" : "none"} strokeLinecap="round" />
        </svg>
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
  neutral:  { label: "Neutral",  color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", emoji: "😐" },
  happy:    { label: "Happy",    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", emoji: "😄" },
  anxious:  { label: "Anxious",  color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", emoji: "😟" },
  angry:    { label: "Angry",    color: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", emoji: "😠" },
  confused: { label: "Confused", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300", emoji: "🤔" },
};
