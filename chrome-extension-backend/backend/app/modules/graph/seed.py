"""
Load the public seed report once. The fixed id makes a second startup (or a second worker) a no-op.

Made by Yash Jain with passion.
"""

import json
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.graph.schemas import EdgeIn, NodeIn
from app.modules.graph.service import submit_report

SEED_REPORT_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")
_SEED_PATH = Path(__file__).resolve().parents[3] / "graph" / "seed.json"


async def ensure_seed(db: AsyncSession) -> None:
    """Insert the public drainer and phishing seed when it is not already stored."""
    payload = json.loads(_SEED_PATH.read_text(encoding="utf-8"))
    await submit_report(
        db,
        source="seed",
        reason=payload["reason"],
        nodes=[NodeIn.model_validate(node) for node in payload["nodes"]],
        edges=[EdgeIn.model_validate(edge) for edge in payload["edges"]],
        reporter_label="public-advisories",
        report_id=SEED_REPORT_ID,
    )
