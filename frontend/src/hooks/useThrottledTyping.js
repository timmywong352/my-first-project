import { useCallback, useEffect, useRef } from "react";

/**
 * Throttles WebSocket "typing" events so we send at most once every `intervalMs`,
 * always send the latest value, and fire a final "is_typing:false" after `stopMs`
 * of inactivity.
 *
 * Usage:
 *   const { onChange } = useThrottledTyping({
 *     send: (payload) => wsSend(payload),
 *     buildPayload: (val, isTyping) => ({ type: 'typing', is_typing: isTyping, content: val, session_id }),
 *     intervalMs: 500,
 *     stopMs: 2000,
 *   });
 *   <input onChange={e => { setText(e.target.value); onChange(e.target.value); }} />
 */
export function useThrottledTyping({ send, buildPayload, intervalMs = 500, stopMs = 2000, enabled = true }) {
  const stateRef = useRef({
    lastSent: 0,
    pendingInterval: null,
    stopTimer: null,
    lastValue: "",
  });

  const fire = useCallback((val, isTyping) => {
    stateRef.current.lastSent = Date.now();
    send(buildPayload(val, isTyping));
  }, [send, buildPayload]);

  const onChange = useCallback((val) => {
    if (!enabled) return;
    const state = stateRef.current;
    state.lastValue = val;
    const now = Date.now();
    const elapsed = now - state.lastSent;

    // Clear any previous "stop" timer — user is still typing
    if (state.stopTimer) {
      clearTimeout(state.stopTimer);
      state.stopTimer = null;
    }

    // Throttle: send now if enough time passed, else schedule
    if (elapsed >= intervalMs) {
      fire(val, true);
    } else if (!state.pendingInterval) {
      state.pendingInterval = setTimeout(() => {
        state.pendingInterval = null;
        fire(state.lastValue, true);
      }, intervalMs - elapsed);
    }

    // Schedule "stopped typing" event
    state.stopTimer = setTimeout(() => {
      state.stopTimer = null;
      if (state.pendingInterval) {
        clearTimeout(state.pendingInterval);
        state.pendingInterval = null;
      }
      fire(state.lastValue, false);
    }, stopMs);
  }, [enabled, intervalMs, stopMs, fire]);

  const flushStop = useCallback((val = "") => {
    const state = stateRef.current;
    if (state.pendingInterval) { clearTimeout(state.pendingInterval); state.pendingInterval = null; }
    if (state.stopTimer) { clearTimeout(state.stopTimer); state.stopTimer = null; }
    send(buildPayload(val, false));
    state.lastSent = Date.now();
  }, [send, buildPayload]);

  useEffect(() => () => {
    const state = stateRef.current;
    if (state.pendingInterval) clearTimeout(state.pendingInterval);
    if (state.stopTimer) clearTimeout(state.stopTimer);
  }, []);

  return { onChange, flushStop };
}
