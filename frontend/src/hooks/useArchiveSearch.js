import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Archive search: q + optional date_from / date_to.
 * Returns { results, query, setQuery, from, setFrom, to, setTo, loading, run }.
 */
export function useArchiveSearch(enabled) {
  const [results, setResults] = useState([]);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.append("q", query);
      if (from) params.append("date_from", new Date(from).toISOString());
      if (to) params.append("date_to", new Date(to).toISOString());
      const { data } = await api.get(`/chat/archive/search?${params.toString()}`);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, from, to]);

  useEffect(() => {
    if (enabled) run();
  }, [enabled, run]);

  return { results, query, setQuery, from, setFrom, to, setTo, loading, run };
}
