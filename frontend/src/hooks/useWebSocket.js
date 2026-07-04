import { useEffect, useRef, useState, useCallback } from "react";
import { refreshToken } from "@/lib/api";

/**
 * Reusable WebSocket hook with:
 *  - auto-reconnect (2s backoff)
 *  - JWT-refresh on 1008 (invalid/expired token) — will refresh and retry once
 *
 * @param {string} url - full ws:// url including query params (may contain ?token=)
 * @param {(msg) => void} onMessage
 */
export function useWebSocket(url, onMessage) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!url) return;
    let retry = null;
    let closed = false;
    let refreshTried = false;

    function connect(currentUrl) {
      try {
        const ws = new WebSocket(currentUrl);
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          refreshTried = false;
        };
        ws.onclose = async (ev) => {
          setConnected(false);
          if (closed) return;
          // 1008 = policy violation — server rejected our token
          if (ev.code === 1008 && !refreshTried) {
            refreshTried = true;
            const newToken = await refreshToken();
            if (newToken) {
              const nextUrl = currentUrl.replace(/([?&]token=)[^&]*/, `$1${newToken}`);
              connect(nextUrl);
              return;
            }
          }
          retry = setTimeout(() => connect(currentUrl), 2000);
        };
        ws.onerror = () => { /* onclose handles reconnect */ };
        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (onMessageRef.current) onMessageRef.current(data);
          } catch { /* ignore */ }
        };
      } catch {
        retry = setTimeout(() => connect(currentUrl), 2000);
      }
    }
    connect(url);

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
      }
    };
  }, [url]);

  const send = useCallback((obj) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }, []);

  return { send, connected };
}
