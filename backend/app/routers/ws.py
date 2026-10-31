from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..broadcaster import Client, broadcaster
from ..db import SessionLocal
from ..models import User
from ..security import decode_access_token

router = APIRouter()


@router.websocket("/ws/live")
async def live(ws: WebSocket, token: str | None = None, site_id: int | None = None):
    await ws.accept()
    client = Client(ws=ws, site_id=site_id)
    if token:
        payload = decode_access_token(token)
        if payload:
            from .families import user_family_ids

            db = SessionLocal()
            try:
                user = db.get(User, int(payload["sub"]))
                if user and user.is_active:
                    client.user_id = user.id
                    client.role = user.role
                    client.family_ids = user_family_ids(db, user.id)
            finally:
                db.close()
    broadcaster.add(client)
    await ws.send_text(json.dumps({"type": "hello", "data": {"authenticated": client.user_id is not None, "role": client.role}}))
    try:
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=25)
                if msg == "ping":
                    await ws.send_text(json.dumps({"type": "pong", "data": {}}))
            except asyncio.TimeoutError:
                await ws.send_text(json.dumps({"type": "ping", "data": {}}))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        broadcaster.remove(client)
