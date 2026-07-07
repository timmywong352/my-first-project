/**
 * Text-to-speech helper using the browser's built-in SpeechSynthesis API.
 * Prefers a Chinese female voice ("zh-CN"). Falls back to any zh voice, then default.
 */

let cachedVoice = null;
let voicesLoadedPromise = null;

function loadVoices() {
  if (voicesLoadedPromise) return voicesLoadedPromise;
  voicesLoadedPromise = new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve([]);
      return;
    }
    const existing = window.speechSynthesis.getVoices();
    if (existing && existing.length) {
      resolve(existing);
      return;
    }
    const handler = () => {
      resolve(window.speechSynthesis.getVoices() || []);
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
    };
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    // Fallback timeout
    setTimeout(() => resolve(window.speechSynthesis.getVoices() || []), 1500);
  });
  return voicesLoadedPromise;
}

async function pickVoice() {
  if (cachedVoice) return cachedVoice;
  const voices = await loadVoices();
  if (!voices.length) return null;
  // Prefer female zh-CN voices
  const female = voices.find(
    (v) => /zh[-_]CN/i.test(v.lang) && /female|xiaoxiao|Ting|zhi|Kangkang|Yaoyao|Yunyang/i.test(v.name || "")
  );
  const anyZh = voices.find((v) => /^zh/i.test(v.lang));
  cachedVoice = female || anyZh || voices[0];
  return cachedVoice;
}

export async function speak(text, { onStart, onEnd, onBoundary } = {}) {
  if (typeof window === "undefined" || !window.speechSynthesis || !text) return null;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  const voice = await pickVoice();
  const utter = new SpeechSynthesisUtterance(text);
  if (voice) utter.voice = voice;
  utter.lang = voice?.lang || "zh-CN";
  utter.rate = 1.0;
  utter.pitch = 1.15; // slightly higher pitch = warmer/friendlier
  utter.volume = 1.0;
  if (onStart) utter.onstart = onStart;
  if (onEnd) utter.onend = onEnd;
  if (onBoundary) utter.onboundary = onBoundary;
  window.speechSynthesis.speak(utter);
  return utter;
}

export function cancelSpeak() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }
}

export function isTTSAvailable() {
  return typeof window !== "undefined" && !!window.speechSynthesis;
}
