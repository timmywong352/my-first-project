import logging
from typing import Dict, List, Optional
from fastapi import WebSocket

logger = logging.getLogger("livechat.ws")


class ConnectionManager:
    def __init__(self):
        self.agent_conns: Dict[str, List[WebSocket]] = {}
        self.customer_conns: Dict[str, List[WebSocket]] = {}

    async def connect_agent(self, agent_id: str, ws: WebSocket):
        await ws.accept()
        self.agent_conns.setdefault(agent_id, []).append(ws)

    async def connect_customer(self, session_id: str, ws: WebSocket):
        await ws.accept()
        self.customer_conns.setdefault(session_id, []).append(ws)

    def disconnect_agent(self, agent_id: str, ws: WebSocket):
        if agent_id in self.agent_conns:
            self.agent_conns[agent_id] = [w for w in self.agent_conns[agent_id] if w is not ws]
            if not self.agent_conns[agent_id]:
                self.agent_conns.pop(agent_id, None)

    def disconnect_customer(self, session_id: str, ws: WebSocket):
        if session_id in self.customer_conns:
            self.customer_conns[session_id] = [w for w in self.customer_conns[session_id] if w is not ws]
            if not self.customer_conns[session_id]:
                self.customer_conns.pop(session_id, None)

    async def _safe_send(self, ws: WebSocket, message: dict):
        try:
            await ws.send_json(message)
        except Exception as e:
            logger.warning(f"WS send failed: {e}")

    async def broadcast_to_session(self, session_id: str, message: dict, assigned_agent_id: Optional[str] = None):
        for ws in list(self.customer_conns.get(session_id, [])):
            await self._safe_send(ws, message)
        for agent_id, conns in list(self.agent_conns.items()):
            for ws in list(conns):
                await self._safe_send(ws, message)

    async def send_to_customer(self, session_id: str, message: dict):
        for ws in list(self.customer_conns.get(session_id, [])):
            await self._safe_send(ws, message)

    async def send_to_agents(self, message: dict):
        for agent_id, conns in list(self.agent_conns.items()):
            for ws in list(conns):
                await self._safe_send(ws, message)


manager = ConnectionManager()
