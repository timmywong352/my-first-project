import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Reusable WebSocket hook.
 * @param {string} url - full ws:// url including query params
 * @param {(msg) => void} onMessage
 * @returns {{ send: (obj) => void, connected: boolean }}
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

    function connect() {
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;
        ws.onopen = () => setConnected(true);
        ws.onclose = () => {
          setConnected(false);
          if (!closed) {
            retry = setTimeout(connect, 2000);
          }
        };
        ws.onerror = () => { /* ignore, close handler retries */ };
        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (onMessageRef.current) onMessageRef.current(data);
          } catch (e) {
            // ignore
          }
        };
      } catch (e) {
        retry = setTimeout(connect, 2000);
      }
    }
    connect();

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
