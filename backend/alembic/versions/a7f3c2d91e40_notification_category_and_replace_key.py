"""Notifications get a category and a replace key

Learner Redesign review (30 Oct 2026, Nandish's page): the bell showed
system messages a learner cannot act on ("0 step(s) as per LAP, 0 need
attention"), the same "See Baby of Priyanka within 2 days" twice, and an old
training notice next to visit alerts. The panel now groups notifications as
"Act today", "Tomorrow" and "For your information", training messages move
to the Training tab once she adopts, and one alert per child per problem is
kept — a new one replaces the old (app/notify.create_notification).

Schema: two nullable columns on notifications — category (varchar 20) and
dedupe_key (varchar 160, indexed). Data: existing rows are given a category
from their title / link; the empty "0 step(s) … 0 need attention" summaries
become "hidden" (kept, never listed); older copies of the same care alert
for the same user are marked read. The downgrade drops the two columns.

Revision ID: a7f3c2d91e40
Revises: e3a9c4b7d218
Create Date: 2026-11-14
"""
from typing import Sequence, Tuple, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a7f3c2d91e40"
down_revision: Union[str, Sequence[str], None] = "e3a9c4b7d218"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Care prompts (app/care_alerts.py): what the learner should do today.
ACT_TODAY_TITLES = (
    "see % within % days", "counsel %", "%: breastfeeding still stopped", "follow up with %",
    "% needs a call", "today: % visit%", "% not done yet",
)
# Training and tests (routers/tutorials, tests, admin selection, flow.py).
TRAINING_TITLES = (
    "tutorial completed", "test attempt completed%", "%face-to-face%", "%training%",
    "%results%", "%not selected%",
)
TRAINING_LINKS = ("/tutorials%", "/results%", "/tests%")
EMPTY_SUMMARY = "0 step(s) as per lap, 0 need attention.%"


def _any_like(column: str, patterns: Sequence[str], prefix: str) -> Tuple[str, dict]:
    clauses, params = [], {}
    for i, pattern in enumerate(patterns):
        key = f"{prefix}{i}"
        clauses.append(f"lower({column}) LIKE :{key}")
        params[key] = pattern
    return "(" + " OR ".join(clauses) + ")", params


def upgrade() -> None:
    op.add_column("notifications", sa.Column("category", sa.String(length=20), nullable=True))
    op.add_column("notifications", sa.Column("dedupe_key", sa.String(length=160), nullable=True))
    op.create_index(op.f("ix_notifications_dedupe_key"), "notifications", ["dedupe_key"], unique=False)

    conn = op.get_bind()
    act, act_params = _any_like("title", ACT_TODAY_TITLES, "a")
    conn.execute(sa.text(f"UPDATE notifications SET category = 'act_today' WHERE category IS NULL AND {act}"),
                 act_params)
    titles, t_params = _any_like("title", TRAINING_TITLES, "t")
    links, l_params = _any_like("coalesce(link, '')", TRAINING_LINKS, "l")
    conn.execute(sa.text(f"UPDATE notifications SET category = 'training' "
                         f"WHERE category IS NULL AND ({titles} OR {links})"),
                 {**t_params, **l_params})
    conn.execute(sa.text("UPDATE notifications SET category = 'hidden', is_read = true "
                         "WHERE lower(message) LIKE :empty"), {"empty": EMPTY_SUMMARY})
    conn.execute(sa.text("UPDATE notifications SET category = 'info' WHERE category IS NULL"))
    # One alert per child per problem: older copies of the same care alert read.
    conn.execute(sa.text(
        "UPDATE notifications SET is_read = true WHERE category = 'act_today' AND is_read = false "
        "AND id NOT IN (SELECT max(id) FROM notifications WHERE category = 'act_today' "
        "GROUP BY user_id, title, coalesce(link, ''))"))


def downgrade() -> None:
    op.drop_index(op.f("ix_notifications_dedupe_key"), table_name="notifications")
    op.drop_column("notifications", "dedupe_key")
    op.drop_column("notifications", "category")
