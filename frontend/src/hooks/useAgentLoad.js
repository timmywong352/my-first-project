import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export const MAX_ACTIVE_CHATS = 20;

/**
 * Polls the current agent's active-chat load. Returns { count, refresh }.
 */
export function useAgentLoad(intervalMs = 15000) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/agents/me/load");
      setCount(data.active_chat_count || 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    if (!intervalMs) return;
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);

  return { count, refresh };
}
