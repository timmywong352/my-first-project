import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Manages agent's session list (active vs archived), search text, and mutation helpers.
 */
export function useAgentSessions() {
  const [activeTab, setActiveTab] = useState("active"); // active | archived
  const [sessions, setSessions] = useState([]);
  const [search, setSearch] = useState("");

  const loadSessions = useCallback(async (tab) => {
    const useTab = tab || activeTab;
    try {
      // "active" bucket includes both accepted (open) chats AND pending offers
      // so refreshing the browser mid-offer still shows them (backend excludes
      // "lily" sessions by default).
      const statusFilter = useTab === "archived" ? "closed" : "";
      const { data } = await api.get(`/chat/sessions${statusFilter ? `?status_filter=${statusFilter}` : ""}`);
      // Pending sessions are surfaced separately in AgentDashboard's Incoming
      // section (via WS `pending_offer` events) — keep them out of the main
      // active list to avoid double-rendering.
      const filtered = Array.isArray(data) ? data.filter((s) => s.status !== "pending") : data;
      setSessions(filtered);
      return filtered;
    } catch {
      return [];
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "archived") loadSessions("active");
  }, [activeTab, loadSessions]);

  // Update local list in response to real-time messages
  const applyMessage = useCallback((m) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === m.session_id);
      if (idx === -1) return prev;
      const copy = [...prev];
      copy[idx] = {
        ...copy[idx],
        last_message: {
          content: m.content,
          sender_type: m.sender_type,
          created_at: m.created_at,
          has_attachments: !!(m.attachments && m.attachments.length),
        },
        last_message_at: m.created_at,
      };
      const [item] = copy.splice(idx, 1);
      copy.unshift(item);
      return copy;
    });
  }, []);

  const prependSession = useCallback((session) => {
    setSessions((prev) => (prev.find((s) => s.id === session.id) ? prev : [session, ...prev]));
  }, []);

  const patchSession = useCallback((sessionId, patch) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)));
  }, []);

  // Remove a session from the local list (used when the agent manually
  // clears a closed chat from the Active view). Purely client-side — the
  // session record itself remains in the database and is still browsable
  // from the Archive tab.
  const removeSession = useCallback((sessionId) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  }, []);

  const filtered = sessions.filter((s) =>
    !search
      ? true
      : s.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
        s.customer_email?.toLowerCase().includes(search.toLowerCase()) ||
        s.subject?.toLowerCase().includes(search.toLowerCase())
  );

  return {
    activeTab, setActiveTab,
    sessions, setSessions,
    search, setSearch,
    filtered,
    loadSessions,
    applyMessage,
    prependSession,
    patchSession,
    removeSession,
  };
}
