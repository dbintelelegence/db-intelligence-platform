"""
AI proxy endpoint.

Proxies LLM requests from the frontend to Anthropic, keeping the API key
server-side and avoiding CORS issues with direct browser-to-Anthropic calls.
"""

import logging
from typing import Any

import anthropic
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    system: str
    messages: list[Message]
    model: str = "claude-haiku-4-5-20251001"
    max_tokens: int = 1024
    temperature: float = 0.3


@router.post("/chat")
async def ai_chat(request: ChatRequest) -> dict[str, Any]:
    """
    Proxy a chat completion request to Anthropic Claude.
    Keeps the API key server-side.
    """
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=503, detail="Anthropic API key not configured")

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model=request.model,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            system=request.system,
            messages=[{"role": m.role, "content": m.content} for m in request.messages],
        )
        return {"content": response.content[0].text}
    except anthropic.APIError as e:
        logger.error(f"Anthropic API error: {e}")
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {e}")
