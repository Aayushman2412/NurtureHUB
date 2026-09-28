"""
Context for each sentence in the language-review workbook.

A reviewer checking "Save" or "Normal" cannot tell a button from an answer
option, or which question an option belongs to, from the words alone — and the
right translation often depends on exactly that. This module answers three
questions for every row:

  where_it_appears(ns, key)    — the screen or form, in plain words
  text_type(ns, key, text)     — heading, question, answer option, button, …
  part_of(ns, key, english)    — for an answer option, the question it answers

and extracts the text of the assessment forms (stored in the database, not in
the translation files) with the same three answers.
"""
from __future__ import annotations

import re
from typing import Dict, Iterator, List, Optional, Tuple

# ── Screens ─────────────────────────────────────────────────────────────────
# (namespace, first key segment) -> screen. Namespace-only entries (segment
# None) cover the rest of that namespace.
SCREENS: Dict[Tuple[str, Optional[str]], str] = {
    ("app", "install"): "'Download the app' help pop-up",
    ("app", "notifications"): "Notifications panel",
    ("app", None): "Top bar and main menu (learner app)",
    ("auth", "login"): "Sign-in page",
    ("auth", "signup"): "Create account page",
    ("auth", "otp"): "Email verification code page",
    ("auth", "forgot"): "Forgot / reset password page",
    ("auth", "google"): "Sign in with Google",
    ("auth", "panel"): "Sign-in pages - side panel",
    ("auth", "passwordRules"): "Password rules checklist (create account, reset password)",
    ("auth", None): "Sign-in and sign-up pages",
    ("common", None): "Shared by every page (footer, language, theme)",
    ("landing", None): "Public home page (before sign-in)",
    ("dashboard", None): "Learner dashboard (home page)",
    ("learner", "profile"): "My profile page",
    ("learner", None): "Learner registration form",
    ("tutorials", "player"): "Video player page",
    ("tutorials", "quiz"): "Quiz shown after a video",
    ("tutorials", None): "Training videos list",
    ("tests", "list"): "Tests list page",
    ("tests", "instructions"): "Test instructions page (before starting)",
    ("tests", "active"): "Taking a test",
    ("tests", "submitted"): "Test submitted page",
    ("tests", "results"): "Test result report",
    ("tests", None): "Tests",
    ("mother", "list"): "My mothers - list page",
    ("mother", "card"): "My mothers - mother card",
    ("mother", "detail"): "Mother details page",
    ("mother", "form"): "Register a mother form",
    ("mother", "child"): "Register / edit a child form",
    ("mother", "options"): "Register a mother / child - answer choices",
    ("assessments", "history"): "Assessments of a mother or child - history page",
    ("assessments", "runner"): "Filling in an assessment form",
    ("assessments", "plan"): "Assessment result - coaching plan",
    ("assessments", "growth"): "Growth check and antenatal forms",
    ("assessments", None): "Assessment forms (all)",
    ("growth", "learner"): "Growth charts page (learner)",
    ("growth", "admin"): "Admin - growth monitor",
    ("growth", "summary"): "Admin - growth monitor: summary table",
    ("growth", "caseDetail"): "Growth - case detail",
    ("growth", "casePage"): "Growth - case detail page",
    ("growth", "visitModal"): "Growth - visit details pop-up",
    ("growth", "filters"): "Growth monitor - filters",
    ("growth", None): "Growth charts (WHO charts)",
    ("offline", None): "Offline and sync messages",
    ("validation", "learner"): "Learner registration form - error messages",
    ("validation", "mother"): "Register a mother form - error messages",
    ("validation", "child"): "Register a child form - error messages",
    ("validation", None): "Forms - error messages",
    ("admin", "layout"): "Admin - side menu and top bar",
    ("admin", "dashboard"): "Admin - dashboard",
    ("admin", "districts"): "Admin - districts",
    ("admin", "projects"): "Admin - projects",
    ("admin", "learners"): "Admin - learners",
    ("admin", "setup"): "Admin - set up a project (pop-up)",
    ("admin", "tracking"): "Admin - video watching tracker",
    ("adminTests", None): "Admin - test manager",
    ("adminTutorials", None): "Admin - videos and phases manager",
    ("adminFormBuilder", None): "Admin - form builder",
    ("adminLiveMonitor", None): "Admin - live test monitoring",
    ("adminResults", None): "Admin - results",
    ("resultsInsights", "testPage"): "Admin - results: one test's page",
    ("resultsInsights", "questions"): "Admin - results: one test's page, question by question",
    ("resultsInsights", "cmp"): "Admin - results: formative vs screening page",
    ("resultsInsights", None): "Admin - results: insights pages",
    ("pipelines", "crosstabs"): "Admin - Crosstabs pipeline",
    ("pipelines", "masd"): "Admin - MASD pipeline",
    ("pipelines", "rawdata"): "Admin - raw data",
    ("pipelines", None): "Admin - data pipelines",
    ("masd", None): "Admin - MASD dashboard (member activity summary)",
    ("server", "email"): "Verification email (sent by the system)",
    ("server", "notification"): "Notifications sent by the system",
}

_HUMAN = re.compile(r"(?<!^)(?=[A-Z])")


def _humanize(segment: str) -> str:
    return _HUMAN.sub(" ", segment).replace("_", " ").strip().capitalize()


def where_it_appears(ns: str, key: str, default: str = "") -> str:
    seg = key.split(".")[0]
    if (ns, seg) in SCREENS:
        return SCREENS[(ns, seg)]
    base = SCREENS.get((ns, None)) or default or ns
    # Admin screens are broad; the first key segment names the part of it.
    if ns.startswith("admin") or ns in ("pipelines", "resultsInsights"):
        return f"{base} > {_humanize(seg)}"
    return base


# ── Kind of text ────────────────────────────────────────────────────────────

BUTTON_WORDS = {
    "save", "cancel", "submit", "back", "next", "continue", "create", "delete", "edit", "add",
    "remove", "retry", "download", "upload", "apply", "close", "done", "finish", "start",
    "register", "signin", "signout", "refresh", "clear", "reset", "resend", "send", "take",
    "view", "open", "copy", "dismiss", "move", "activate", "deactivate", "revert", "generate",
    "ingest", "print", "export", "preview", "expand", "collapse", "select", "gotit", "skip",
    "flag", "unflag", "warn", "run", "sync", "discard", "keep", "exit", "later", "retake",
    "resume", "logout", "login", "toggle", "show", "hide", "choose", "make", "assign",
    "schedule", "end", "iunderstand", "rename", "go", "confirm", "enable", "disable",
}


def text_type(ns: str, key: str, text: str) -> str:
    parts = key.split(".")
    segs = [p.lower() for p in parts]
    last = parts[-1]
    low = last.lower()
    first_word = re.split(r"(?=[A-Z])|_", last)[0].lower()     # "downloadSelected" -> "download"
    words = len(str(text).split())

    if ns == "server":
        if segs[0] == "email":
            return "Email - subject line" if low == "subject" else "Email text"
        return "Notification - title" if low == "title" else "Notification - message"
    if ns == "validation" or "validation" in segs[:-1]:
        return "Error message (shown under a form field)"
    if segs[0] == "likertquestion" or (len(segs) > 1 and segs[1] == "likertquestion") or segs[0] == "trainings":
        return "Question"
    if segs[0] == "options" and ns in ("mother", "learner"):
        return "Answer choice"
    if ns == "resultsInsights" and segs[0] in ("age", "internet", "priortraining"):
        return "Group name (in charts and tables)"
    if ns == "resultsInsights" and segs[0] == "finding":
        return "Finding - a sentence written from the results"
    if any("toast" in s for s in segs) or low.endswith("banner"):
        return "Pop-up message (appears for a few seconds)"
    if low.startswith("confirm") or "confirm" in segs[:-1]:
        return "Confirmation question (pop-up)"
    if "placeholder" in low or "placeholders" in segs:
        return "Placeholder (grey hint inside an empty box)"
    if "excel" in segs[:-1] or "export" in segs[:-1]:
        return "Downloaded Excel - column or sheet name"
    if low.endswith("hint") or low in ("hint", "help", "tip", "footnote", "info") or (low.endswith("note") and words > 4):
        return "Help text"
    if any(s in ("table", "selectiontable", "questionstable", "headers", "columns") for s in segs)             or re.match(r"col[A-Z]", last):
        return "Table column heading"
    if "status" in segs or "badge" in low or segs[0] == "filters" or (len(segs) > 1 and segs[1] == "filters"):
        return "Status or filter label"
    if segs[0] in ("nav", "tabs", "steps") or (len(segs) > 1 and segs[1] in ("nav", "tabs", "steps")):
        return "Menu, tab or step name"
    if low == "eyebrow":
        return "Small heading above the main heading"
    if "fields" in segs[:-1]:
        return "Question / field label on a form"
    if low in ("subtitle", "description", "desc", "intro", "blurb", "body", "sub", "lede") \
            or low.endswith(("subtitle", "description", "body", "intro", "blurb", "sub", "lede", "sentence")) \
            or re.match(r"desc[A-Z]", last):
        return "Subheading / explanation"
    if low in ("title", "heading", "headertitle") or low.endswith(("title", "heading")) \
            or re.match(r"title[A-Z]", last) or low.startswith("section") or segs[0] == "headertitle":
        return "Heading"
    if low.startswith("loading") or low in ("submitting", "saving", "deleting", "uploading", "creating",
                                              "starting", "resetting", "registering", "authenticating",
                                              "processing", "downloading", "reconnecting", "resending",
                                              "signingin", "sendingcode", "verifying", "running"):
        return "Progress message (while waiting)"
    if low.startswith("empty") or "empty" in segs or (
            last.startswith("no") and last[2:3].isupper() and str(text).lower().startswith(("no ", "none", "no-"))):
        return "Message on an empty page or list"
    if "error" in low or "failed" in low or low.startswith("err") or low == "fail":
        return "Error message"
    if any(s in ("stats", "kpi", "scorecard", "tiles") for s in segs[:-1]):
        return "Label on a number card"
    if words <= 6 and (first_word in BUTTON_WORDS or low in BUTTON_WORDS) and not str(text).rstrip().endswith("."):
        return "Button"
    # The registration forms keep their field labels beside their headings and
    # buttons, so this comes after those.
    if (ns == "learner" and segs[0] == "fields") or (ns == "mother" and segs[0] in ("form", "child")):
        return "Question / field label on a form"
    if words > 8 or str(text).rstrip().endswith((".", "?", "!", "…")):
        return "Message / sentence"
    return "Label (short text on screen)"


# ── Which question an answer choice belongs to ──────────────────────────────

_OPTION_QUESTIONS: Dict[Tuple[str, str], str] = {
    ("mother", "occupation"): "mother:form.occupation",
    ("mother", "rationCard"): "mother:form.rationCard",
    ("mother", "socialCategory"): "mother:form.socialCategory",
    ("mother", "videoFrequency"): "mother:form.videoFrequency",
    ("mother", "source"): "mother:form.ratingsQuestion",
    ("mother", "babiesBorn"): "mother:child.babiesBorn",
    ("mother", "gender"): "mother:child.gender",
    ("mother", "deliveryMethod"): "mother:child.deliveryMethod",
    ("mother", "deliveryPlace"): "mother:child.deliveryPlace",
    ("mother", "birthCondition"): "mother:child.birthConditions",
    ("learner", "gender"): "learner:fields.gender",
    ("learner", "marital"): "learner:fields.maritalStatus",
    ("learner", "internet"): "learner:fields.internet",
    ("learner", "recency"): "learner:trainings.nutrition_training",
}


def part_of(ns: str, key: str, english: Dict[str, str]) -> str:
    """The question (or table) this text belongs to, in its English words."""
    parts = key.split(".")
    if parts[0] == "options" and len(parts) == 2 and parts[1] in ("yes", "no"):
        return "Any yes/no question on the form"
    if parts[0] == "options" and len(parts) >= 3 and parts[1] != "likertQuestion":
        group = parts[1]
        if group == "likert" and len(parts) >= 4:
            q = english.get(f"{ns}:options.likertQuestion.{parts[2]}")
            return f"Question: {q}" if q else ""
        if (ns, group) == ("learner", "recency"):
            return "The 5 questions 'When did you last attend … training?'"
        ref = _OPTION_QUESTIONS.get((ns, group))
        if ref and english.get(ref):
            return f"Question: {english[ref]}"
    if ns == "resultsInsights" and parts[0] in ("age", "internet", "priorTraining"):
        return {"age": "Split by: Age group", "internet": "Split by: Internet at work",
                "priorTraining": "Split by: Earlier nutrition training"}[parts[0]]
    return ""


# ── Assessment forms (database) ─────────────────────────────────────────────

FORM_NAMES = {
    "breastfeeding": "Breastfeeding assessment form",
    "complementary_feeding": "Complementary feeding assessment form",
    "mother_protein_intake": "Mother's protein intake form",
    "growth_monitoring": "Check growth form",
    "antenatal": "Antenatal assessment form",
}
# The registration forms are left out on purpose: the learner, mother and
# child registration screens draw their wording from the translation files
# (already in the sheet); their database copies only feed the form builder.


def _clean(s) -> str:
    return str(s).strip() if isinstance(s, str) else ""


def form_rows(form_key: str, schema: dict) -> Iterator[dict]:
    """Every piece of learner-visible text in one form, with its context."""
    name = FORM_NAMES.get(form_key, form_key)

    def row(rid: str, where: str, kind: str, part: str, text: str) -> Optional[dict]:
        text = _clean(text)
        if not re.search(r"[^\W\d_]", text):     # nothing to translate in "0.5" or "10"
            return None
        return {"id": f"form:{form_key}:{rid}", "where": where, "type": kind, "part_of": part, "en": text}

    def question_rows(q: dict, where: str) -> Iterator[Optional[dict]]:
        qid, title = q.get("id", ""), _clean(q.get("title") or q.get("label"))
        kind = q.get("kind")
        if kind == "section":
            yield row(f"{qid}.title", where, "Section heading", "", title)
            for child in q.get("children") or []:
                yield from question_rows(child, f"{where} > {title}")
            return
        if kind == "matrix":
            yield row(f"{qid}.title", where, "Question (answered as a table)", "", title)
            yield row(f"{qid}.help", where, "Help text", f"Question: {title}", q.get("helpText"))
            yield row(f"{qid}.unitLabel", where, "Table column heading", f"Table: {title}", q.get("unitLabel"))
            for col in q.get("columns") or []:
                col_label = _clean(col.get("label"))
                yield row(f"{qid}.col.{col.get('id')}.label", where, "Table column heading", f"Table: {title}", col_label)
                for i, opt in enumerate(col.get("options") or []):
                    yield row(f"{qid}.col.{col.get('id')}.opt{i}.label", where, "Answer choice (in a table column)",
                              f"Table: {title} - column: {col_label}", opt.get("label"))
            for r in q.get("rows") or []:
                rid, food = r.get("id"), _clean(r.get("label"))
                yield row(f"{qid}.row.{rid}.label", where, "Table row (food or item)", f"Table: {title}", food)
                yield row(f"{qid}.row.{rid}.unit", where, "Unit of measure", f"Table: {title} - row: {food}",
                          r.get("unit"))
            return
        yield row(f"{qid}.title", where, "Question", "", title)
        yield row(f"{qid}.help", where, "Help text", f"Question: {title}", q.get("helpText"))
        yield row(f"{qid}.placeholder", where, "Placeholder (grey hint inside an empty box)",
                  f"Question: {title}", q.get("placeholder"))
        for i, opt in enumerate(q.get("options") or []):
            oid = opt.get("id") or opt.get("value") or f"opt{i}"
            label = _clean(opt.get("label"))
            yield row(f"{qid}.opt.{oid}.label", where, "Answer choice", f"Question: {title}", label)
            action = opt.get("action") or {}
            yield row(f"{qid}.opt.{oid}.message", where,
                      "Coaching message (shown when this answer is chosen)",
                      f"Question: {title} - answer: {label}", action.get("message"))

    out: List[Optional[dict]] = []
    if "nodes" in schema:                                   # flow form
        nodes = schema.get("nodes") or {}
        seen, order, cur = set(), [], schema.get("startNodeId")
        while cur and cur in nodes and cur not in seen:     # follow the form's own order
            seen.add(cur)
            order.append(cur)
            cur = nodes[cur].get("next")
        order += [k for k in nodes if k not in seen]        # branches reached by options
        for nid in order:
            out.extend(question_rows(nodes[nid], name))
    else:                                                    # flat form
        for field in schema.get("fields") or []:
            f = dict(field)
            f.setdefault("title", f.get("label"))
            f["options"] = [{"id": o.get("value"), "label": o.get("label")} for o in (f.get("options") or [])]
            out.extend(question_rows(f, name))

    # One row per distinct (context, text): the same "0 days … 7 days" choices
    # repeat in every food table and need translating once.
    seen_rows = set()
    for r in out:
        if not r:
            continue
        sig = (r["type"], re.sub(r"Table: [^-]+- ", "Table: - ", r["part_of"]), r["en"])
        if r["type"].startswith("Answer choice (in a table column)") and sig in seen_rows:
            continue
        seen_rows.add(sig)
        yield r
