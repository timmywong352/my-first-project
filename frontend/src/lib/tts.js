/**
 * Server-side Text-to-Speech using our FastAPI `/api/lily/tts` endpoint,
 * which is powered by OpenAI TTS (`tts-1`, voice `nova` by default).
 *
 * A single <audio> element is reused across calls, and we cache the most
 * recent utterance to avoid re-hitting the API when the same subtitle plays
 * twice (Lily may re-open the widget with an identical greeting).
 */
import { API } from "./api";

let audioEl = null;
let currentBlobUrl = null;
const cache = new Map(); // key -> blobUrl

function getAudioEl() {
  if (typeof window === "undefined") return null;
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
  }
  return audioEl;
}

export async function speak(text, { voice = "nova", speed = 1.0, onStart, onEnd } = {}) {
  const el = getAudioEl();
  if (!el || !text) return null;

  // Stop anything currently playing
  try {
    el.pause();
    el.currentTime = 0;
  } catch { /* ignore */ }

  const key = `${voice}:${speed}:${text}`;
  let blobUrl = cache.get(key);

  try {
    if (!blobUrl) {
      const resp = await fetch(`${API}/lily/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, speed }),
      });
      if (!resp.ok) throw new Error(`tts http ${resp.status}`);
      const blob = await resp.blob();
      blobUrl = URL.createObjectURL(blob);
      // Cache with an LRU-ish cap
      if (cache.size > 20) {
        const oldest = cache.keys().next().value;
        const oldUrl = cache.get(oldest);
        cache.delete(oldest);
        try { URL.revokeObjectURL(oldUrl); } catch { /* ignore */ }
      }
      cache.set(key, blobUrl);
    }

    // Track the currently playing URL for cleanup
    currentBlobUrl = blobUrl;

    el.onplay = () => onStart && onStart();
    el.onended = () => onEnd && onEnd();
    el.onerror = () => onEnd && onEnd();
    el.src = blobUrl;
    // Autoplay may be blocked without user gesture; that's fine — the user
    // clicked the launcher, so we already have a gesture in-context.
    await el.play().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("TTS play blocked:", e?.message || e);
      if (onEnd) onEnd();
    });
    return el;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("TTS failed:", e?.message || e);
    if (onEnd) onEnd();
    return null;
  }
}

export function cancelSpeak() {
  const el = audioEl;
  if (!el) return;
  try {
    el.pause();
    el.currentTime = 0;
  } catch { /* ignore */ }
}

export function isTTSAvailable() {
  return typeof window !== "undefined" && typeof Audio !== "undefined";
}

// Kept for compat with older imports; TTS is always "on" server-side.
export function primeTTS() {
  // Attempt a silent play() to unlock audio on iOS/Safari.
  const el = getAudioEl();
  if (!el) return;
  el.muted = true;
  el.play().catch(() => {}).finally(() => { el.muted = false; });
}
