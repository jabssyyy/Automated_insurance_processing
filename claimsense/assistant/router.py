"""
ClaimSense.ai — Conversational Assistant API Router.

Endpoint
--------
* ``POST /chat`` — Chat about a specific claim (grounded in Claim JSON data)
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from auth.rbac import require_role
from shared.audit import log_action
from shared.database import get_db

from assistant.chat import chat

logger = logging.getLogger("claimsense.assistant")

router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════
# Request / Response schemas
# ═══════════════════════════════════════════════════════════════════════

class ChatMessage(BaseModel):
    """A single message in the conversation history."""
    role: str = Field(..., description="'user' or 'assistant'")
    content: str = Field(..., description="Message text")


class ChatRequest(BaseModel):
    """Request body for POST /chat."""
    claim_id: str = Field(..., description="Claim ID to chat about")
    message: str = Field(..., description="User's message")
    conversation_history: list[ChatMessage] = Field(
        default_factory=list,
        description="Previous messages in the conversation",
    )


class ChatResponse(BaseModel):
    """Response from POST /chat."""
    response: str = Field(..., description="Assistant's response")
    claim_id: str = Field(..., description="Claim ID that was discussed")


# ═══════════════════════════════════════════════════════════════════════
# POST /chat — Chat about a specific claim
# ═══════════════════════════════════════════════════════════════════════

@router.post(
    "/chat",
    summary="Chat about a specific claim",
    response_model=ChatResponse,
)
async def chat_endpoint(
    body: ChatRequest,
    current_user: dict[str, Any] = Depends(
        require_role("patient", "hospital_staff", "insurer", "admin")
    ),
    db: AsyncSession = Depends(get_db),
):
    """
    Ask a question about a claim — answers grounded in claim data.

    The assistant uses Gemini 2.0 Flash with the claim's actual data
    as context. It never makes up information or re-computes decisions.

    Conversation history is passed from the client to maintain context
    across multiple exchanges.
    """
    role = current_user.get("role", "patient")

    # Convert pydantic models to dicts for the chat function
    history = [
        {"role": msg.role, "content": msg.content}
        for msg in body.conversation_history
    ]

    # Call the chat function
    response_text = await chat(
        claim_id=body.claim_id,
        user_message=body.message,
        user_role=role,
        conversation_history=history,
        db=db,
    )

    # Audit log — log that chat occurred, NOT the message content (privacy)
    await log_action(
        db,
        claim_id=body.claim_id,
        actor=current_user.get("email", "system"),
        action_type="assistant_chat",
        module="assistant",
        details={
            "claim_id": body.claim_id,
            "user_role": role,
            # Do NOT log message content for privacy
            "history_length": len(body.conversation_history),
        },
    )

    return ChatResponse(
        response=response_text,
        claim_id=body.claim_id,
    )
