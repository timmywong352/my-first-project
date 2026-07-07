/**
 * Lily — Pseudo-3D animated avatar.
 *
 * Layers a static portrait image (the user-uploaded Lily illustration) with
 * SVG overlays that animate blinks, mouth movement, gentle head tilt, and
 * breathing. This intentionally keeps Lily's visual identity 1:1 with the
 * source portrait while giving her lifelike micro-motion.
 *
 * Future upgrade: pass a `vrmUrl` prop to swap in a real 3D VRM avatar
 * (rendered via three.js + @pixiv/three-vrm). That code path is stubbed so
 * the parent widget doesn't need to change when a VRM file becomes
 * available; simply drop `<LilyLiveAvatar vrmUrl="/lily.vrm" />` in.
 */
import { useEffect, useMemo, useRef, useState } from "react";

// Original Lily illustration (720 × 960).
export const LILY_IMAGE_URL =
  "https://customer-assets.emergentagent.com/job_live-chat-hub-28/artifacts/g4bxi3t1_image.png";

// Facial landmark coordinates in the ORIGINAL 720×960 pixel space
// (derived from image analysis; SVG viewBox mirrors this exactly).
const LANDMARKS = {
  leftEye:  { cx: 259, cy: 354, rx: 30, ry: 30 },
  rightEye: { cx: 351, cy: 343, rx: 30, ry: 30 },
  mouth:    { cx: 315, cy: 520, rx: 32, ry: 10 },
  headPivotPct: { x: 43.4, y: 46.15 }, // used by CSS transform-origin
};

const SKIN = "#e8ba9a";
const LASH = "#3b2417";

// Emotion → animation config (breathing speed, tilt amplitude, mouth shape)
const EMOTION_CONFIG = {
  neutral:  { tiltDeg: 2.5, breathMs: 4200, blinkMinMs: 3500, blinkMaxMs: 5500, mouthCurve: 0 },
  happy:    { tiltDeg: 3.5, breathMs: 3200, blinkMinMs: 3000, blinkMaxMs: 4500, mouthCurve: 8 },
  friendly: { tiltDeg: 3.0, breathMs: 3600, blinkMinMs: 3200, blinkMaxMs: 5000, mouthCurve: 5 },
  thinking: { tiltDeg: 5.5, breathMs: 4800, blinkMinMs: 2500, blinkMaxMs: 4000, mouthCurve: -2 },
  greeting: { tiltDeg: 4.5, breathMs: 3200, blinkMinMs: 3500, blinkMaxMs: 5000, mouthCurve: 6 },
  concerned:{ tiltDeg: 2.0, breathMs: 4600, blinkMinMs: 3500, blinkMaxMs: 6000, mouthCurve: -3 },
};

function pickEmotion(e) {
  return EMOTION_CONFIG[e] || EMOTION_CONFIG.neutral;
}

/**
 * LilyLiveAvatar
 *
 * Props:
 *  - size (px)                Diameter of the round frame. Default 160.
 *  - emotion                  neutral | happy | friendly | thinking | greeting | concerned
 *  - speaking (bool)          Drives mouth open/close cadence + subtle head bob
 *  - showLabel (bool)         Show the "Lily · Online / Speaking…" caption
 *  - imageUrl (string)        Override the portrait
 *  - vrmUrl (string)          FUTURE: path to a .vrm — enables 3D renderer
 *  - onReady (fn)             Called once initial paint is done (analytics)
 */
export default function LilyLiveAvatar({
  size = 160,
  emotion = "friendly",
  speaking = false,
  showLabel = false,
  imageUrl = LILY_IMAGE_URL,
  vrmUrl = null,
  onReady,
  onAvatarClick,
  clickPulse = 0,
}) {
  const cfg = pickEmotion(emotion);
  const [blink, setBlink] = useState(false);
  const [mouthPulse, setMouthPulse] = useState(0);
  const [tilt, setTilt] = useState(0);
  const imgRef = useRef(null);

  // ── Blink loop ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let timeoutId = null;
    const schedule = () => {
      const delay = cfg.blinkMinMs + Math.random() * (cfg.blinkMaxMs - cfg.blinkMinMs);
      timeoutId = setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        setTimeout(() => setBlink(false), 130);
        // Occasional "double-blink" for extra life
        if (Math.random() < 0.15) {
          setTimeout(() => setBlink(true), 260);
          setTimeout(() => setBlink(false), 380);
        }
        schedule();
      }, delay);
    };
    schedule();
    return () => { cancelled = true; if (timeoutId) clearTimeout(timeoutId); };
  }, [cfg.blinkMinMs, cfg.blinkMaxMs]);

  // ── Mouth movement while speaking ──────────────────────
  useEffect(() => {
    if (!speaking) { setMouthPulse(0); return; }
    const t = setInterval(() => setMouthPulse((p) => (p + 1) % 5), 110);
    return () => clearInterval(t);
  }, [speaking]);

  // ── Idle head tilt (gentle sinusoidal oscillation) ─────
  useEffect(() => {
    let raf;
    let start = performance.now();
    const loop = (now) => {
      const t = (now - start) / 1000;
      // A slow figure-eight-ish sway: main sine + tiny secondary sway
      const base = Math.sin(t * 0.6) * cfg.tiltDeg;
      const jitter = Math.sin(t * 1.7) * (cfg.tiltDeg * 0.15);
      setTilt(base + jitter);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cfg.tiltDeg]);

  useEffect(() => { onReady && onReady(); }, [onReady]);

  // Mouth aperture in original image px (opens more while speaking)
  const mouthAperture = useMemo(() => {
    if (!speaking) return 0;
    const cycle = [4, 10, 14, 8, 3];
    return cycle[mouthPulse] || 4;
  }, [speaking, mouthPulse]);

  const eyeRy = blink ? 1.5 : 0; // 0 = eyelid invisible, ~30 = fully closed
  const openEyeRy = blink ? 30 : 0;

  // ── VRM stub (future-proof) ────────────────────────────
  if (vrmUrl) {
    // Real integration would mount <VrmCanvas url={vrmUrl} emotion=... speaking=... />
    // For now we just render the pseudo-3D layer so nothing breaks if a
    // caller passes vrmUrl before the loader lands.
    console.info("[LilyLiveAvatar] vrmUrl provided but 3D loader not wired yet.");
  }

  const speakingBob = speaking ? Math.sin(mouthPulse * 1.6) * 0.4 : 0;
  const wrapperTransform = `rotate(${tilt.toFixed(2)}deg) translateY(${speakingBob.toFixed(2)}px)`;

  return (
    <div className="inline-flex flex-col items-center select-none">
      <div
        role={onAvatarClick ? "button" : undefined}
        tabIndex={onAvatarClick ? 0 : undefined}
        onClick={onAvatarClick}
        onKeyDown={(e) => {
          if (onAvatarClick && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onAvatarClick();
          }
        }}
        className={`relative rounded-full overflow-hidden ring-4 shadow-2xl transition-all duration-300 ${
          onAvatarClick ? "cursor-pointer hover:ring-blue-300/90 hover:scale-[1.03] active:scale-[0.98]" : ""
        } ${speaking ? "ring-blue-300/80 shadow-blue-300/50" : "ring-white/60"}`}
        style={{ width: size, height: size, background: "radial-gradient(circle at 50% 30%, #dbeeff 0%, #a8ccff 45%, #7aa5e0 100%)" }}
        data-testid="lily-avatar"
        data-emotion={emotion}
        data-speaking={speaking ? "true" : "false"}
        data-mode="2d"
        aria-label={onAvatarClick ? "Tap Lily for another greeting" : undefined}
      >
        {/* Breathing wrapper — subtle scale pulse via CSS keyframes */}
        <div
          className="absolute inset-0 lily-breathe"
          style={{
            transform: wrapperTransform,
            transformOrigin: `${LANDMARKS.headPivotPct.x}% ${LANDMARKS.headPivotPct.y}%`,
            animationDuration: `${cfg.breathMs}ms`,
            willChange: "transform",
          }}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Lily"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />

          {/* SVG overlay — coordinate space matches the source image exactly */}
          <svg
            viewBox="0 0 720 960"
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            {/* Eyelids (skin colored, closed by scaling ry) */}
            <g style={{ transition: "opacity 60ms" }}>
              {/* Left eye lid */}
              <ellipse
                cx={LANDMARKS.leftEye.cx}
                cy={LANDMARKS.leftEye.cy}
                rx={LANDMARKS.leftEye.rx}
                ry={openEyeRy}
                fill={SKIN}
                style={{ transition: "ry 90ms cubic-bezier(.4,.9,.4,1)" }}
              />
              {/* Right eye lid */}
              <ellipse
                cx={LANDMARKS.rightEye.cx}
                cy={LANDMARKS.rightEye.cy}
                rx={LANDMARKS.rightEye.rx}
                ry={openEyeRy}
                fill={SKIN}
                style={{ transition: "ry 90ms cubic-bezier(.4,.9,.4,1)" }}
              />
              {/* Lash line — thin dark arc drawn just above/under the closed lid
                  so a blink reads as an anime "^ ^" curve rather than a blank patch */}
              {blink && (
                <>
                  <path
                    d={`M ${LANDMARKS.leftEye.cx - LANDMARKS.leftEye.rx + 3} ${LANDMARKS.leftEye.cy}
                        Q ${LANDMARKS.leftEye.cx} ${LANDMARKS.leftEye.cy + 8}
                          ${LANDMARKS.leftEye.cx + LANDMARKS.leftEye.rx - 3} ${LANDMARKS.leftEye.cy}`}
                    stroke={LASH}
                    strokeWidth="4"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path
                    d={`M ${LANDMARKS.rightEye.cx - LANDMARKS.rightEye.rx + 3} ${LANDMARKS.rightEye.cy}
                        Q ${LANDMARKS.rightEye.cx} ${LANDMARKS.rightEye.cy + 8}
                          ${LANDMARKS.rightEye.cx + LANDMARKS.rightEye.rx - 3} ${LANDMARKS.rightEye.cy}`}
                    stroke={LASH}
                    strokeWidth="4"
                    strokeLinecap="round"
                    fill="none"
                  />
                </>
              )}
            </g>

            {/* Mouth overlay — only used while speaking to add subtle "talking"
                motion on top of the printed mouth. We darken a small ellipse
                that grows/shrinks with the phoneme cycle. */}
            {speaking && (
              <ellipse
                cx={LANDMARKS.mouth.cx}
                cy={LANDMARKS.mouth.cy + 2}
                rx={LANDMARKS.mouth.rx * 0.55}
                ry={mouthAperture}
                fill="#5a1e26"
                opacity="0.85"
                style={{ transition: "ry 90ms ease-out, opacity 120ms ease-out" }}
              />
            )}

            {/* Emotion-driven smile accent (subtle curve above the printed mouth) */}
            {cfg.mouthCurve > 0 && !speaking && (
              <path
                d={`M ${LANDMARKS.mouth.cx - LANDMARKS.mouth.rx} ${LANDMARKS.mouth.cy - 2}
                    Q ${LANDMARKS.mouth.cx} ${LANDMARKS.mouth.cy + cfg.mouthCurve}
                      ${LANDMARKS.mouth.cx + LANDMARKS.mouth.rx} ${LANDMARKS.mouth.cy - 2}`}
                stroke="#a94a52"
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
                opacity="0.6"
              />
            )}
          </svg>
        </div>

        {/* Overlay effects that live OUTSIDE the tilting wrapper so they stay
            square with the ring frame. */}

        {/* Soft spotlight vignette for depth */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/15 pointer-events-none rounded-full" />

        {/* Speaking pulse rings */}
        {speaking && (
          <>
            <div className="absolute -inset-1 rounded-full border-2 border-blue-400/50 lily-ping pointer-events-none" />
            <div
              className="absolute -inset-3 rounded-full border border-blue-300/40 lily-ping pointer-events-none"
              style={{ animationDelay: "180ms" }}
            />
          </>
        )}

        {/* Click-feedback pulse */}
        {clickPulse > 0 && (
          <span
            key={clickPulse}
            className="absolute inset-0 rounded-full border-4 border-white pointer-events-none lily-click-pulse"
          />
        )}

        {/* Waveform bars — a "live mic" feel while speaking */}
        {speaking && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-end gap-0.5 h-3.5 pointer-events-none">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="w-0.5 bg-white/90 rounded-full shadow"
                style={{
                  height: `${25 + ((mouthPulse + i) % 5) * 18}%`,
                  transition: "height 100ms ease-out",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {showLabel && (
        <div className="mt-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${speaking ? "bg-pink-500 animate-pulse" : "bg-emerald-500 animate-pulse"}`} />
          Lily · {speaking ? "Speaking…" : "Online"}
        </div>
      )}
    </div>
  );
}

export const EMOTION_LABELS = {
  neutral:   { label: "Neutral",   emoji: "😐" },
  happy:     { label: "Happy",     emoji: "😄" },
  friendly:  { label: "Friendly",  emoji: "😊" },
  thinking:  { label: "Thinking",  emoji: "🤔" },
  greeting:  { label: "Greeting",  emoji: "👋" },
  concerned: { label: "Concerned", emoji: "😟" },
};
