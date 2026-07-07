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
        camera.fov = 20;
        // Frame the head prominently — look slightly UP at the eyes so we
        // catch the smiling mouth + eyes rather than the chin.
        camera.position.set(target.x, headHeight + 0.03, target.z + 0.85);
        camera.lookAt(target.x, headHeight + 0.03, target.z);
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
    let blinkNextIn = 3 + Math.random() * 2;
    let blinkTimer = 0;
    let blinkState = "idle"; // idle | closing | held | opening
    let mouthPhase = 0;

    const animate = () => {
      if (disposed) return;
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.getElapsedTime();

      if (vrm) {
        // ── Blink FSM ──────────────────────────────
        if (vrm.expressionManager) {
          const em = vrm.expressionManager;
          blinkTimer += dt;
          if (blinkState === "idle") {
            if (blinkTimer >= blinkNextIn) {
              blinkState = "closing";
              blinkTimer = 0;
            }
          } else if (blinkState === "closing") {
            const v = Math.min(1, blinkTimer / 0.08);
            em.setValue("blink", v);
            if (v >= 1) { blinkState = "held"; blinkTimer = 0; }
          } else if (blinkState === "held") {
            em.setValue("blink", 1);
            if (blinkTimer >= 0.06) { blinkState = "opening"; blinkTimer = 0; }
          } else if (blinkState === "opening") {
            const v = Math.max(0, 1 - blinkTimer / 0.09);
            em.setValue("blink", v);
            if (v <= 0) {
              blinkState = "idle";
              blinkTimer = 0;
              blinkNextIn = 3 + Math.random() * 2.5;
              // 15% chance of a follow-up double blink
              if (Math.random() < 0.15) blinkNextIn = 0.18;
            }
          }

          // ── Emotion blend shape ──────────────────
          const targetExpr = EMOTION_TO_EXPR[emotionRef.current];
          ALL_EMOTIONS.forEach((k) => {
            em.setValue(k, k === targetExpr ? 0.6 : 0);
          });

          // ── Mouth (lip-sync via time-driven pseudo-random cycle) ──
          if (speakingRef.current) {
            mouthPhase += dt * 9;
            const aa = 0.25 + Math.abs(Math.sin(mouthPhase))         * 0.5;
            const ih = 0.10 + Math.abs(Math.sin(mouthPhase * 1.35))  * 0.3;
            const ou = 0.05 + Math.abs(Math.sin(mouthPhase * 0.7))   * 0.2;
            em.setValue("aa", aa);
            em.setValue("ih", ih);
            em.setValue("ou", ou);
          } else {
            em.setValue("aa", 0);
            em.setValue("ih", 0);
            em.setValue("ou", 0);
          }
        }

        // ── Bone motion: head sway + spine breathe ─
        const head = vrm.humanoid?.getNormalizedBoneNode("head");
        if (head) {
          head.rotation.y = Math.sin(t * 0.45) * 0.10;
          head.rotation.z = Math.sin(t * 0.7)  * 0.05 + Math.sin(t * 1.7) * 0.015;
          head.rotation.x = Math.sin(t * 0.9)  * 0.03 - 0.05;
        }
        const chest = vrm.humanoid?.getNormalizedBoneNode("chest")
                   || vrm.humanoid?.getNormalizedBoneNode("upperChest")
                   || vrm.humanoid?.getNormalizedBoneNode("spine");
        if (chest) {
          const breath = Math.sin(t * 1.1) * 0.010;
          chest.rotation.x = -0.02 + breath;
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
        className={`relative rounded-full overflow-hidden ring-4 shadow-2xl transition-shadow duration-300 ${
          speaking ? "ring-pink-300/80 shadow-pink-300/50" : "ring-white/60"
        }`}
        style={{
          width: size,
          height: size,
          background: "radial-gradient(circle at 50% 30%, #ffe4f0 0%, #ffd6ec 40%, #e8b5ff 100%)",
        }}
        data-testid="lily-avatar"
        data-emotion={emotion}
        data-speaking={speaking ? "true" : "false"}
        data-mode="vrm"
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: "auto" }}
        />

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
            <div className="absolute -inset-1 rounded-full border-2 border-pink-400/50 lily-ping pointer-events-none" />
            <div
              className="absolute -inset-3 rounded-full border border-pink-300/40 lily-ping pointer-events-none"
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
        <div className="mt-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${speaking ? "bg-pink-500 animate-pulse" : "bg-emerald-500 animate-pulse"}`} />
          Lily · {loading ? "Loading…" : speaking ? "Speaking…" : "Online"}
        </div>
      )}
    </div>
  );
}
