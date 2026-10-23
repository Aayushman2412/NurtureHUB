"""Record IDs, not names, on the administrators' screens (launch review of 19 Oct 2026).

Parag Chitalia: "We need to incorporate PII and privacy concerns — use
anonymized IDs instead of names for admins." The health worker who registered
a mother keeps seeing her name: she visits her. A supervisor reading a whole
district needs to know WHICH case — the record ID (MR-…, CR-…) answers that —
not who the woman is. So every admin-facing growth view replaces the mother's
and the baby's name with their record ID and leaves out the mother's mobile.

The masking happens on the server, before the response leaves: a name that is
never sent cannot leak from a browser cache, a screenshot or an export.
ADMIN_PATIENT_NAMES=true puts the names back (the programme's call).
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from app.config import settings


def names_shown() -> bool:
    return bool(settings.ADMIN_PATIENT_NAMES)


def _id(uid: Optional[str], fallback: Optional[str]) -> Optional[str]:
    return uid or (None if fallback is None else "—")


def case(c: Dict[str, Any]) -> Dict[str, Any]:
    """A growth case (routers/growth._build_cases)."""
    if names_shown():
        return c
    out = dict(c)
    out["child"] = {**c["child"], "name": _id(c["child"].get("uid"), c["child"].get("name"))}
    if c.get("mother"):
        out["mother"] = {**c["mother"], "name": _id(c["mother"].get("uid"), c["mother"].get("name"))}
    return out


def cases(items: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [case(c) for c in items]


def summary_row(r: Dict[str, Any]) -> Dict[str, Any]:
    """A growth summary-table row (routers/growth._summary_rows)."""
    if names_shown():
        return r
    out = dict(r)
    ids = r.get("ids") or {}
    out["identity"] = {**(r.get("identity") or {}),
                       "mother_name": _id(ids.get("mother_uid"), (r.get("identity") or {}).get("mother_name"))}
    out["ids"] = {**ids, "child_name": _id((r.get("identity") or {}).get("child_uid"), ids.get("child_name"))}
    return out


def summary_rows(items: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [summary_row(r) for r in items]


def falter_row(r: Dict[str, Any]) -> Dict[str, Any]:
    """A faltering-list row (app/faltering.build)."""
    if names_shown():
        return r
    out = dict(r)
    out["mother"] = {**r["mother"], "name": _id(r["mother"].get("uid"), r["mother"].get("name"))}
    out["child"] = {**r["child"], "name": _id(r["child"].get("uid"), r["child"].get("name"))}
    return out


def person(p: Optional[Dict[str, Any]], *, drop: Iterable[str] = ()) -> Optional[Dict[str, Any]]:
    """{id, uid, name, …} → the name is the uid; `drop` removes direct
    identifiers such as the mobile number."""
    if p is None or names_shown():
        return p
    out = {k: v for k, v in p.items() if k not in set(drop)}
    out["name"] = _id(p.get("uid"), p.get("name"))
    return out


def response_detail(d: Dict[str, Any], child_uid: Optional[str], mother_uid: Optional[str]) -> Dict[str, Any]:
    """A serialized form response (routers/forms._serialize_detail)."""
    if names_shown():
        return d
    out = dict(d)
    if d.get("child_name") is not None:
        out["child_name"] = _id(child_uid, d.get("child_name"))
    if d.get("mother_name") is not None:
        out["mother_name"] = _id(mother_uid, d.get("mother_name"))
    return out


def case_detail(d: Dict[str, Any]) -> Dict[str, Any]:
    """The admin case page (routers/growth._case_detail): names become record
    IDs; the mother's mobile is left out."""
    if names_shown():
        return d
    out = dict(d)
    child_uid = (d.get("child") or {}).get("uid")
    mother_uid = (d.get("mother") or {}).get("uid")
    out["child"] = person(d.get("child"))
    out["mother"] = person(d.get("mother"), drop=("mobile",))
    out["visits"] = [{**v, "responses": [response_detail(r, child_uid, mother_uid) for r in v.get("responses") or []]}
                     for v in d.get("visits") or []]
    out["mother_forms"] = [response_detail(r, child_uid, mother_uid) for r in d.get("mother_forms") or []]
    return out
