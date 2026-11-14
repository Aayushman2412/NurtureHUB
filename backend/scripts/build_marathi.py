"""Switch Marathi on from the review drafts, and give the visit forms their
Hindi and Marathi wording (Learner Redesign review, 30 Oct 2026: "Marathi
first"; "language menu offers only English and Hindi").

  * App strings: frontend/src/i18n/locales/mr/<ns>.json from
    translation_drafts/mr.json — only for strings whose English is still the
    English the draft was written for (commit DRAFTED_AT), so a reworded
    sentence falls back to English instead of showing an old translation.
    Strings added since have no Marathi yet and show in English.
  * Form text: frontend/src/i18n/locales/{hi,mr}/forms.json — each question,
    help line and option of the visit forms (their default version in the
    database), with the English it translates; the app shows a translation
    only while that English is unchanged (frontend/src/lib/formText.ts).
  * Registers Marathi in frontend/src/i18n/index.ts (once).

These are first drafts awaiting the language team's review
(scripts/export_translation_sheet.py exports them for it).

    cd backend && ./venv-win/Scripts/python.exe scripts/build_marathi.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Dict

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
REPO = BACKEND.parent
LOCALES = REPO / "frontend" / "src" / "i18n" / "locales"
DRAFTS = HERE / "translation_drafts"
DRAFTED_AT = "208d933"          # the commit the Marathi first draft was written against
FORMS = ("growth_monitoring", "antenatal", "breastfeeding", "complementary_feeding", "mother_protein_intake")

sys.path[:0] = [str(BACKEND), str(HERE)]


def _flatten(d: dict, prefix: str = "") -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out.update(_flatten(v, f"{prefix}{k}."))
        else:
            out[f"{prefix}{k}"] = v
    return out


def _nest(flat: Dict[str, object]) -> dict:
    out: dict = {}
    for key, value in flat.items():
        node = out
        parts = key.split(".")
        for p in parts[:-1]:
            node = node.setdefault(p, {})
        node[parts[-1]] = value
    return out


def _english_then(ns: str) -> Dict[str, str]:
    try:
        raw = subprocess.run(["git", "show", f"{DRAFTED_AT}:frontend/src/i18n/locales/en/{ns}.json"],
                             cwd=REPO, capture_output=True, check=True).stdout.decode("utf-8")
    except subprocess.CalledProcessError:
        return {}
    return _flatten(json.loads(raw))


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_ui() -> None:
    mr = json.loads((DRAFTS / "mr.json").read_text(encoding="utf-8"))
    kept = stale = 0
    for en_file in sorted((LOCALES / "en").glob("*.json")):
        ns = en_file.stem
        current = _flatten(json.loads(en_file.read_text(encoding="utf-8")))
        then = _english_then(ns)
        out = {}
        for key, english in current.items():
            draft = mr.get(f"{ns}:{key}")
            if not draft:
                continue
            if then.get(key) == english:
                out[key] = draft
                kept += 1
            else:
                stale += 1
        _write(LOCALES / "mr" / f"{ns}.json", _nest(out))
    print(f"app strings: {kept} in Marathi, {stale} drafts skipped (English changed since {DRAFTED_AT})")


def build_forms() -> None:
    from app import models
    from app.database import SessionLocal
    from translation_context import form_rows

    db = SessionLocal()
    try:
        drafts = {lang: json.loads((DRAFTS / f"{lang}.json").read_text(encoding="utf-8")) for lang in ("hi", "mr")}
        out: Dict[str, dict] = {"hi": {}, "mr": {}}
        for key in FORMS:
            definition = db.query(models.FormDefinition).filter(models.FormDefinition.form_key == key).first()
            if definition is None:
                continue
            for row in form_rows(key, definition.schema_json or {}):
                rid = row["id"].split(":", 2)[2]
                for lang in ("hi", "mr"):
                    tr = drafts[lang].get(row["id"])
                    if tr:
                        out[lang][f"{key}.{rid}"] = {"en": row["en"], "tr": tr}
        for lang, flat in out.items():
            _write(LOCALES / lang / "forms.json", _nest(flat))
            print(f"forms ({lang}): {len(flat)} pieces of text")
    finally:
        db.close()


def main() -> None:
    from import_translation_sheet import register_marathi

    build_ui()
    build_forms()
    print("registered Marathi in i18n/index.ts" if register_marathi() else "Marathi already registered")


if __name__ == "__main__":
    main()
