"""Request-body size guard for the video upload route.

FastAPI parses a multipart body (spooling it to a temp file) before the endpoint's own size check can run, so a
client could stream gigabytes before receiving a 413. This pure-ASGI middleware rejects the request from the
Content-Length header when it is present, and otherwise counts the body as it arrives and aborts once the limit
is passed (covers chunked uploads). The limit follows PUSHKAR_VIDEO_MAX_MB at request time, plus a little slack
for the multipart envelope and form fields.
"""
from __future__ import annotations

import json

from fastapi import HTTPException

from .config import settings

SLACK = 1024 * 1024


class VideoUploadLimit:
    def __init__(self, app, path: str):
        self.app = app
        self.path = path

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") != "POST" or scope.get("path") != self.path:
            await self.app(scope, receive, send)
            return
        limit = settings.video_max_mb * 1024 * 1024 + SLACK
        detail = f"Video larger than {settings.video_max_mb} MB"
        for k, v in scope.get("headers", []):
            if k == b"content-length":
                try:
                    declared = int(v)
                except ValueError:
                    declared = 0
                if declared > limit:
                    body = json.dumps({"detail": detail}).encode()
                    await send({"type": "http.response.start", "status": 413,
                                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
                    await send({"type": "http.response.body", "body": body})
                    return
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise HTTPException(413, detail)
            return message

        await self.app(scope, limited_receive, send)
