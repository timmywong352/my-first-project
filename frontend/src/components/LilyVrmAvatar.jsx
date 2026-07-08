/**
 * Lily — Real 3D avatar rendered from a VRM (VRoid) model.
 *
 * Uses three.js + @pixiv/three-vrm. Features:
 *   • Idle: subtle head sway (bone rotation) + breathing (spine)
 *   • Random blinks every 3–5 s with proper close/hold/open cadence
 *   • Speaking: mouth blend shapes (aa / ih) modulate while `speaking=true`
 *   • Emotion → happy / sad / relaxed / surprised blend shape at 60%
 *   • Spring-bone physics on hair & clothing (built into @pixiv/three-vrm)
 *   • Transparent background so widget gradient shows through
 *
 * VRM asset is served from `/models/lily.vrm` inside the frontend `public/`
 * folder — you can swap it any time by replacing that file.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

const EMOTION_TO_EXPR = {
  neutral:   null,
  friendly:  "happy",
  happy:     "happy",
  greeting:  "happy",
  thinking:  "relaxed",
  concerned: "sad",
};
const ALL_EMOTIONS = ["happy", "sad", "angry", "relaxed", "surprised"];

export default function LilyVrmAvatar({
  vrmUrl = "/models/lily.vrm",
  size = 200,
  speaking = false,
  emotion = "friendly",
  showLabel = false,
  onReady,
  onError,
  onAvatarClick,
  clickPulse = 0,
}) {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Refs so the render-loop always sees the current props without re-running the setup effect
  const emotionRef = useRef(emotion);
  const speakingRef = useRef(speaking);
  useEffect(() => { emotionRef.current = emotion; }, [emotion]);
  useEffect(() => { speakingRef.current = speaking; }, [speaking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let rafId = null;
    let vrm = null;

    // ── Scene ────────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
    // Position camera as a head-and-shoulders portrait
    camera.position.set(0, 1.35, 1.15);
    camera.lookAt(0, 1.35, 0);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(size, size, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    // ── Lights (anime toon-style: soft key + warm rim) ─
    const hemi = new THREE.HemisphereLight(0xffffff, 0xf9deff, 1.15);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(1.2, 2, 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff9ac2, 0.6);
    rim.position.set(-1.5, 1.5, -1);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xfff2c6, 0.35);
    fill.position.set(-1, 0.5, 1);
    scene.add(fill);

    // ── Loader ──────────────────────────────────────────
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      vrmUrl,
      (gltf) => {
        if (disposed) return;
        vrm = gltf.userData.vrm;
        if (!vrm) {
          setError("Model is not a valid VRM");
          setLoading(false);
          return;
        }

        // Optimise runtime cost
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);

        // If this is a VRM 0.x model it faces −Z; rotate so it faces the camera
        if (vrm.meta && vrm.meta.metaVersion === "0") {
          VRMUtils.rotateVRM0(vrm);
        }

        scene.add(vrm.scene);

        // Auto-frame: compute head-and-shoulders framing from the actual
        // model bounds. Uses the head bone as focal point if available,
        // otherwise falls back to the scene bounding box.
        const head = vrm.humanoid?.getNormalizedBoneNode("head");
        const target = new THREE.Vector3(0, 1.4, 0);
        let headHeight = 1.4;
        if (head) {
          head.updateMatrixWorld(true);
          head.getWorldPosition(target);
          headHeight = target.y;
        } else {
          const bbox = new THREE.Box3().setFromObject(vrm.scene);
          headHeight = bbox.max.y - (bbox.max.y - bbox.min.y) * 0.12;
          target.set((bbox.min.x + bbox.max.x) / 2, headHeight, 0);
        }
        camera.fov = 28;
        // Frame head-and-shoulders: pull camera further back and aim slightly
        // BELOW the head so the neck, shoulders and top of the chest are all
        // visible inside the circular frame (less "big-face-close-up" feel).
        camera.position.set(target.x, headHeight - 0.05, target.z + 1.35);
        camera.lookAt(target.x, headHeight - 0.18, target.z);
        camera.updateProjectionMatrix();

        setLoading(false);
        onReady && onReady(vrm);
      },
      undefined,
      (err) => {
        console.error("VRM load failed:", err);
        setError(err?.message || "Failed to load 3D avatar");
        setLoading(false);
        onError && onError(err);
      },
    );

    // ── Animation loop ──────────────────────────────────
    const clock = new THREE.Clock();

    // Blink state
    let blinkNextIn = 2.5 + Math.random() * 2;
    let blinkTimer = 0;
    let blinkState = "idle"; // idle | closing | held | opening
    let blinkCluster = 0;    // extra blinks queued after the current one

    // Eye look-around (small saccades)
    let lookYaw = 0, lookPitch = 0;
    let lookYawTgt = 0, lookPitchTgt = 0;
    let lookNextIn = 1.5 + Math.random() * 2;
    let lookTimer = 0;

    // Occasional idle "life gesture" — small extra head nod / tilt.
    let idleGestureNextIn = 6 + Math.random() * 6;
    let idleGestureTimer = 0;
    let idleGestureAmp = { y: 0, x: 0, z: 0 };

    // Speaking gestures
    let mouthPhase = 0;
    let speakStartT = -100;    // triggers a brief nod when speech begins
    let wasSpeaking = false;

    // Persistent per-emotion pulse (smile "breathing")
    const emotionSmoothing = { happy: 0, sad: 0, angry: 0, relaxed: 0, surprised: 0 };

    const animate = () => {
      if (disposed) return;
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.getElapsedTime();

      if (vrm) {
        // ─── Blink FSM (with occasional double/triple clusters) ───
        if (vrm.expressionManager) {
          const em = vrm.expressionManager;
          blinkTimer += dt;
          if (blinkState === "idle") {
            if (blinkTimer >= blinkNextIn) {
              blinkState = "closing";
              blinkTimer = 0;
            }
          } else if (blinkState === "closing") {
            const v = Math.min(1, blinkTimer / 0.07);
            em.setValue("blink", v);
            if (v >= 1) { blinkState = "held"; blinkTimer = 0; }
          } else if (blinkState === "held") {
            em.setValue("blink", 1);
            if (blinkTimer >= 0.05) { blinkState = "opening"; blinkTimer = 0; }
          } else if (blinkState === "opening") {
            const v = Math.max(0, 1 - blinkTimer / 0.08);
            em.setValue("blink", v);
            if (v <= 0) {
              blinkState = "idle";
              blinkTimer = 0;
              if (blinkCluster > 0) {
                blinkCluster -= 1;
                blinkNextIn = 0.14 + Math.random() * 0.06;
              } else {
                blinkNextIn = 2.5 + Math.random() * 2.5;
                const r = Math.random();
                if (r < 0.05)      blinkCluster = 2; // rare triple
                else if (r < 0.25) blinkCluster = 1; // ~20 % double
              }
            }
          }

          // ─── Emotion blend shape (very subtle when idle, so her
          //      base mesh doesn't stay "wide-smile teeth-out") ───
          const targetExpr = EMOTION_TO_EXPR[emotionRef.current];
          const speaking = speakingRef.current;
          const pulse = 0.08 * Math.sin(t * 0.9);
          ALL_EMOTIONS.forEach((k) => {
            let goal = 0;
            if (k === targetExpr) {
              // Idle keeps just a gentle "at-rest" smile so the mouth can
              // relax. Only during speech do we brighten the emotion.
              goal = speaking ? 0.35 + pulse : 0.12 + pulse * 0.5;
            }
            emotionSmoothing[k] += (goal - emotionSmoothing[k]) * Math.min(1, dt * 3.5);
            em.setValue(k, Math.max(0, Math.min(1, emotionSmoothing[k])));
          });

          // ─── Mouth lip-sync — hard-close between phonemes ───
          if (speaking) {
            mouthPhase += dt * 10;
            const rhythm = 0.5 + 0.5 * Math.sin(t * 1.8);
            const aa = (0.15 + Math.abs(Math.sin(mouthPhase))         * 0.55) * rhythm;
            const ih = (0.05 + Math.abs(Math.sin(mouthPhase * 1.35))  * 0.30) * rhythm;
            const ou = (0.05 + Math.abs(Math.sin(mouthPhase * 0.7))   * 0.20) * rhythm;
            em.setValue("aa", aa);
            em.setValue("ih", ih);
            em.setValue("ou", ou);
          } else {
            // Zero all mouth phonemes when idle so nothing leaks the mouth open
            em.setValue("aa", 0);
            em.setValue("ih", 0);
            em.setValue("ou", 0);
            em.setValue("ee", 0);
            em.setValue("oh", 0);
            // Try a "neutral" reset if the VRM defines one
            try { em.setValue("neutral", 1); } catch { /* no-op if missing */ }
          }

          // ─── Eye look-around (small saccades) ───
          lookTimer += dt;
          if (lookTimer >= lookNextIn) {
            lookTimer = 0;
            lookNextIn = 1.4 + Math.random() * 2.5;
            // Small comfortable range: ±0.55 yaw, ±0.35 pitch
            lookYawTgt   = (Math.random() * 2 - 1) * 0.55;
            lookPitchTgt = (Math.random() * 2 - 1) * 0.35;
            // 25 % of the time, look "back to centre" for eye contact
            if (Math.random() < 0.25) { lookYawTgt = 0; lookPitchTgt = 0; }
          }
          // Ease toward target
          lookYaw   += (lookYawTgt   - lookYaw)   * Math.min(1, dt * 5.5);
          lookPitch += (lookPitchTgt - lookPitch) * Math.min(1, dt * 5.5);
          em.setValue("lookLeft",  Math.max(0, -lookYaw));
          em.setValue("lookRight", Math.max(0,  lookYaw));
          em.setValue("lookUp",    Math.max(0,  lookPitch));
          em.setValue("lookDown",  Math.max(0, -lookPitch));
        }

        // ─── Idle "life gesture" — occasional extra head motion ───
        idleGestureTimer += dt;
        if (idleGestureTimer >= idleGestureNextIn) {
          idleGestureTimer = 0;
          idleGestureNextIn = 6 + Math.random() * 8;
          // Small extra nod / tilt combo
          idleGestureAmp = {
            y: (Math.random() * 2 - 1) * 0.06,
            x: (Math.random() * 0.5 + 0.2) * 0.05,
            z: (Math.random() * 2 - 1) * 0.04,
          };
        }
        // Fade the gesture out over ~1.2 s so it feels natural
        const gestureDecay = Math.max(0, 1 - idleGestureTimer / 1.2);
        const gy = idleGestureAmp.y * gestureDecay;
        const gx = idleGestureAmp.x * gestureDecay;
        const gz = idleGestureAmp.z * gestureDecay;

        // ─── Speak-start nod: a small down-then-up on speech begin ───
        if (speakingRef.current && !wasSpeaking) {
          speakStartT = t;
        }
        wasSpeaking = speakingRef.current;
        const sinceSpeak = t - speakStartT;
        const nodEnvelope = sinceSpeak < 0.6
          ? Math.sin((sinceSpeak / 0.6) * Math.PI) * 0.12
          : 0;
        // Continuous "sentence bob" while speaking
        const talkBob = speakingRef.current ? Math.sin(t * 3.4) * 0.025 : 0;

        // ─── Head / neck / chest motion ───
        // Head: multi-frequency sway + look yaw/pitch + gestures + speech bob
        const head = vrm.humanoid?.getNormalizedBoneNode("head");
        if (head) {
          const baseY = Math.sin(t * 0.55) * 0.08 + Math.sin(t * 1.9) * 0.02;
          const baseZ = Math.sin(t * 0.8)  * 0.045 + Math.sin(t * 2.3) * 0.012;
          const baseX = Math.sin(t * 0.7)  * 0.025 - 0.04;
          head.rotation.y = baseY + lookYaw * 0.20 + gy;
          head.rotation.z = baseZ + gz;
          head.rotation.x = baseX + nodEnvelope + talkBob + gx - lookPitch * 0.15;
        }
        // Neck: slight counter-rotation for realism (real necks do this)
        const neck = vrm.humanoid?.getNormalizedBoneNode("neck");
        if (neck) {
          neck.rotation.y = Math.sin(t * 0.55) * 0.03 + lookYaw * 0.10;
          neck.rotation.z = Math.sin(t * 0.8)  * 0.02;
          neck.rotation.x = -0.02 + talkBob * 0.4;
        }
        // Chest / spine: breathe + gentle side-sway
        const chest = vrm.humanoid?.getNormalizedBoneNode("chest")
                   || vrm.humanoid?.getNormalizedBoneNode("upperChest")
                   || vrm.humanoid?.getNormalizedBoneNode("spine");
        if (chest) {
          const breath = Math.sin(t * 1.1) * 0.012;
          const sway   = Math.sin(t * 0.35) * 0.015;
          chest.rotation.x = -0.02 + breath;
          chest.rotation.z = sway;
          chest.rotation.y = Math.sin(t * 0.6) * 0.02;
        }
        // Shoulders — tiny shrug on speaking start makes her feel present
        const shoulderL = vrm.humanoid?.getNormalizedBoneNode("leftShoulder");
        const shoulderR = vrm.humanoid?.getNormalizedBoneNode("rightShoulder");
        if (shoulderL && shoulderR) {
          const shrug = nodEnvelope * 0.15;
          shoulderL.rotation.z =  0.02 + shrug;
          shoulderR.rotation.z = -0.02 - shrug;
        }

        vrm.update(dt);
      }

      renderer.render(scene, camera);
    };
    animate();

    // ── Cleanup ─────────────────────────────────────────
    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
      renderer.dispose();
    };
  }, [vrmUrl, size, onReady, onError]);

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
        style={{
          width: size,
          height: size,
          background: "radial-gradient(circle at 50% 30%, #dbeeff 0%, #a8ccff 45%, #7aa5e0 100%)",
        }}
        data-testid="lily-avatar"
        data-emotion={emotion}
        data-speaking={speaking ? "true" : "false"}
        data-mode="vrm"
        aria-label={onAvatarClick ? "Tap Lily for another greeting" : undefined}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ imageRendering: "auto" }}
        />

        {/* Click-feedback pulse — remounts each time `clickPulse` changes */}
        {clickPulse > 0 && (
          <span
            key={clickPulse}
            className="absolute inset-0 rounded-full border-4 border-white pointer-events-none lily-click-pulse"
          />
        )}

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/40 backdrop-blur-sm">
            <div className="w-10 h-10 border-4 border-pink-400 border-t-transparent rounded-full animate-spin" />
            <div className="text-[10px] font-semibold text-pink-700 uppercase tracking-widest">Loading Lily…</div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-red-600 text-center px-4">
            {error}
          </div>
        )}

        {/* Overlay effects consistent with the 2.5D variant */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/10 pointer-events-none rounded-full" />
        {speaking && !loading && (
          <>
            <div className="absolute -inset-1 rounded-full border-2 border-blue-400/50 lily-ping pointer-events-none" />
            <div
              className="absolute -inset-3 rounded-full border border-blue-300/40 lily-ping pointer-events-none"
              style={{ animationDelay: "180ms" }}
            />
          </>
        )}
        {speaking && !loading && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-end gap-0.5 h-3.5 pointer-events-none">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="w-0.5 bg-white/90 rounded-full shadow"
                style={{
                  height: `${25 + ((Math.floor(Date.now() / 110) + i) % 5) * 18}%`,
                  transition: "height 90ms ease-out",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {showLabel && (
        <div className="mt-2 text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${speaking ? "bg-blue-400 animate-pulse" : "bg-emerald-400 animate-pulse"}`} />
          Lily · {loading ? "Loading…" : speaking ? "Speaking…" : "Tap for greeting"}
        </div>
      )}
    </div>
  );
}
