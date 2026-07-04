import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;
export const WS_BASE = BACKEND_URL.replace(/^http/, "ws");

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshInflight = null;

/** Try to swap our token for a fresh one. Returns new token on success, null otherwise. */
export async function refreshToken() {
  if (refreshInflight) return refreshInflight;
  const doRefresh = async () => {
    const currentToken = localStorage.getItem("token");
    if (!currentToken) return null;
    try {
      const res = await axios.post(`${API}/auth/refresh`, {}, {
        withCredentials: true,
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      const newToken = res.data?.token;
      if (newToken) {
        localStorage.setItem("token", newToken);
        return newToken;
      }
    } catch { /* ignore */ }
    return null;
  };
  refreshInflight = doRefresh().finally(() => { refreshInflight = null; });
  return refreshInflight;
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original?._retry) {
      original._retry = true;
      const newToken = await refreshToken();
      if (newToken) {
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api.request(original);
      }
    }
    return Promise.reject(error);
  }
);

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}
