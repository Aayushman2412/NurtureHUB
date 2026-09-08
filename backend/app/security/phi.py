"""Recording access to patient records.

Routers call these rather than `audit.record` directly, so that every patient
touch is described the same way and the trail stays queryable by *data
principal* — "show me everything that touched this child's record" — which is
the query a data-principal access request and a breach investigation both start
from.

The distinction that matters is `subject`: the person the data is about. It is
not always the resource. A growth measurement's resource is a form response; its
subject is the child. Getting that right is what makes the register answer the
questions the DPDP Act gives people the right to ask.
"""
from __future__ import annotations

from typing import Iterable, Optional

from app.security import audit
from app.security.context import get_context, update_context

# Subject types = the categories of data principal this platform holds.
MOTHER = "mother"
CHILD = "child"
LEARNER = "learner"


def set_access_reason(reason: str) -> None:
    """Attach a stated purpose to every audit row for the rest of this request.

    Used by break-glass and supervisory-review paths, where "why" is as much a
    part of the record as "who".
    """
    update_context(access_reason=(reason or "")[:255] or None)


def log_read(
    *,
    resource_type: str,
    resource_id=None,
    subject_type: Optional[str] = None,
    subject_id=None,
    detail: Optional[dict] = None,
    fields: Optional[Iterable[str]] = None,
) -> None:
    """One patient record was opened."""
    payload = dict(detail or {})
    if fields:
        # The *names* of the sensitive fields returned, never their values —
        # enough to answer "was her phone number exposed" without holding it.
        payload["fields"] = sorted(set(fields))
    audit.record(
        audit.Action.PHI_READ,
        resource_type=resource_type,
        resource_id=resource_id,
        subject_type=subject_type,
        subject_id=subject_id,
        record_count=1,
        is_phi=True,
        detail=payload or None,
    )


def log_list(
    *,
    resource_type: str,
    count: int,
    subject_type: Optional[str] = None,
    subject_ids: Optional[Iterable] = None,
    detail: Optional[dict] = None,
) -> None:
    """A set of patient records was listed.

    Subject ids are kept for small result sets, which is where a targeted
    investigation lives. Large listings record the count and the filter instead:
    storing ten thousand ids per page view would make the trail bigger than the
    data it describes, and the query filter reconstructs the set anyway.
    """
    payload = dict(detail or {})
    ids = list(subject_ids or [])
    if ids and len(ids) <= 50:
        payload["subject_ids"] = [str(i) for i in ids]
    elif ids:
        payload["subject_id_sample"] = [str(i) for i in ids[:10]]
    audit.record(
        audit.Action.PHI_LIST,
        resource_type=resource_type,
        subject_type=subject_type,
        record_count=count,
        is_phi=True,
        detail=payload or None,
    )


def log_create(*, resource_type: str, resource_id=None, subject_type=None, subject_id=None,
               detail: Optional[dict] = None) -> None:
    audit.record(
        audit.Action.PHI_CREATE,
        resource_type=resource_type,
        resource_id=resource_id,
        subject_type=subject_type,
        subject_id=subject_id,
        record_count=1,
        is_phi=True,
        detail=detail,
    )


def log_update(*, resource_type: str, resource_id=None, subject_type=None, subject_id=None,
               changed_fields: Optional[Iterable[str]] = None, detail: Optional[dict] = None) -> None:
    payload = dict(detail or {})
    if changed_fields:
        payload["changed_fields"] = sorted(set(changed_fields))
    audit.record(
        audit.Action.PHI_UPDATE,
        resource_type=resource_type,
        resource_id=resource_id,
        subject_type=subject_type,
        subject_id=subject_id,
        record_count=1,
        is_phi=True,
        detail=payload or None,
    )


def log_delete(*, resource_type: str, resource_id=None, subject_type=None, subject_id=None,
               record_count: int = 1, detail: Optional[dict] = None, db=None) -> None:
    """Deletion is written synchronously — it is the one action whose audit row
    cannot be allowed to be lost with the process that performed it."""
    audit.record_sync(
        audit.Action.PHI_DELETE,
        db=db,
        resource_type=resource_type,
        resource_id=resource_id,
        subject_type=subject_type,
        subject_id=subject_id,
        record_count=record_count,
        is_phi=True,
        detail=detail,
    )


def log_export(*, resource_type: str, record_count: int, fmt: str,
               subject_type: Optional[str] = None, detail: Optional[dict] = None,
               db=None) -> None:
    """Patient data left the system in a file.

    Synchronous by design. This is the single most consequential event the trail
    records: at the moment of export the data leaves this system's custody, and
    under the MOU custody is what responsibility follows. It must be durable
    before the bytes reach the client.
    """
    payload = dict(detail or {})
    payload["format"] = fmt
    audit.record_sync(
        audit.Action.PHI_EXPORT,
        db=db,
        resource_type=resource_type,
        subject_type=subject_type,
        record_count=record_count,
        is_phi=True,
        detail=payload,
    )


def log_denied(*, resource_type: str, resource_id=None, reason: str = "not_owner",
               subject_type: Optional[str] = None, subject_id=None) -> None:
    """An attempt to reach a record the caller is not entitled to.

    Ownership checks in this codebase answer 404 rather than 403 so they do not
    confirm a record exists. That is right for the client and useless for the
    trail, so the refusal is recorded here with its true reason.
    """
    audit.record(
        audit.Action.PHI_DENIED,
        resource_type=resource_type,
        resource_id=resource_id,
        subject_type=subject_type,
        subject_id=subject_id,
        record_count=0,
        outcome="denied",
        is_phi=False,
        detail={"reason": reason},
    )


def current_actor_label() -> Optional[str]:
    return get_context().actor_label
