"""Chandrapur follows the November 2026 visit protocol

The product owner, 12 Nov 2026: "apply the new one to chandrapur as well".
d0151815badc gave every existing project the legacy protocol ("lap_2025")
and the 150-day PNC split; this moves Chandrapur alone to "lap_2026_11" and
180 days (docs/visit-protocol-2026-11.md, "Which projects follow it"). Every
other existing project keeps the legacy values; projects created from now on
get the new ones from the admin API.

Data only. Chandrapur is matched by slug or by name (case-insensitive); when
there is no such project nothing changes. The downgrade puts that row back on
the legacy values.

Revision ID: e3a9c4b7d218
Revises: d0151815badc
Create Date: 2026-11-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e3a9c4b7d218"
down_revision: Union[str, Sequence[str], None] = "d0151815badc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PROJECT = "chandrapur"
NEW = ("lap_2026_11", 180)
LEGACY = ("lap_2025", 150)


def set_protocol(conn, protocol: str, split_days: int, project: str = PROJECT) -> int:
    """Set one project's visit protocol and PNC split; the rows changed (0 if absent)."""
    result = conn.execute(
        sa.text("UPDATE program_districts SET visit_protocol = :protocol, pnc_split_days = :split "
                "WHERE slug = :project OR lower(name) = :project"),
        {"protocol": protocol, "split": split_days, "project": project},
    )
    return result.rowcount or 0


def upgrade() -> None:
    set_protocol(op.get_bind(), *NEW)


def downgrade() -> None:
    set_protocol(op.get_bind(), *LEGACY)
