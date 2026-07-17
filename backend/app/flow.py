"""
Shared helpers for the 4-phase training flow.

Rules encoded here:
  - Tutorial phases are never locked for watching (users may pre-watch add-on
    videos before passing the formative test).
  - A test is *eligible* only when every tutorial in every earlier tutorial
    phase (lower order_index, same district) is completed. Formative test ->
    Phase 1 videos; Screening test -> Phase 1 + Phase 3 videos.
  - A test can only be *taken* while its admin-controlled status is 'active'.
  - Once every tutorial is completed and every test has at least one submitted
    attempt, the user is done and awaits results.
"""

from typing import Optional, Set, Tuple

from sqlalchemy.orm import Session

from app.models import (
    Notification, Stage, Test, TestAttempt, Tutorial, User, UserTutorialProgress,
)

AWAITING_RESULTS_TITLE = "Results Pending"


def get_completed_tutorial_ids(db: Session, user: User) -> Set[int]:
    rows = db.query(UserTutorialProgress.tutorial_id).filter(
        UserTutorialProgress.user_id == user.id,
        UserTutorialProgress.is_completed == True,  # noqa: E712
    ).all()
    return {r[0] for r in rows}


def tutorial_ids_required_before(db: Session, district_id: Optional[int], order_index: int) -> Set[int]:
    """
    All tutorial ids a test in the stage at `order_index` requires: every tutorial
    in that stage or any earlier one. Uses <= (not <) so a test wrongly attached to
    a tutorial-bearing stage — or an old-format DB where a stage holds both tutorials
    and its test — still gates on that stage's own videos. Dedicated test stages have
    no tutorials, so including them is a no-op for the normal 4-phase flow.
    """
    if district_id is None:
        return set()
    stage_ids = [
        s.id for s in db.query(Stage).filter(
            Stage.program_district_id == district_id,
            Stage.order_index <= order_index,
        ).all()
    ]
    if not stage_ids:
        return set()
    rows = db.query(Tutorial.id).filter(Tutorial.stage_id.in_(stage_ids)).all()
    return {r[0] for r in rows}


def test_eligibility(db: Session, user: User, test: Test) -> Tuple[bool, int]:
    """(eligible, missing_tutorials_count) based on required earlier videos."""
    stage = db.query(Stage).filter(Stage.id == test.stage_id).first()
    if not stage:
        return True, 0
    required = tutorial_ids_required_before(db, stage.program_district_id, stage.order_index)
    if not required:
        return True, 0
    completed = get_completed_tutorial_ids(db, user)
    missing = len(required - completed)
    return missing == 0, missing


def test_lock_state_precomputed(
    test: Test,
    required_tutorial_ids: Set[int],
    completed_tutorial_ids: Set[int],
) -> Tuple[bool, Optional[str]]:
    """(is_locked, lock_reason) from in-memory sets — no DB queries.

    Same rules as test_lock_state(), but the caller supplies the required- and
    completed-tutorial sets so a page rendering many tests (dashboard, tests
    list) computes eligibility once instead of issuing ~4 queries per test.
    """
    missing = len(required_tutorial_ids - completed_tutorial_ids)
    if missing:
        return True, f"Complete all required videos first ({missing} remaining)."
    if test.status != "active":
        if test.status == "ended":
            return True, "This test has ended."
        if test.scheduled_at:
            return True, "The test has not been started by the admin yet. Check the scheduled date."
        return True, "The test has not been started by the admin yet."
    return False, None


def test_lock_state(db: Session, user: User, test: Test) -> Tuple[bool, Optional[str]]:
    """(is_locked, lock_reason) combining eligibility and the admin lifecycle gate."""
    eligible, missing = test_eligibility(db, user, test)
    if not eligible:
        return True, f"Complete all required videos first ({missing} remaining)."
    if test.status != "active":
        if test.status == "ended":
            return True, "This test has ended."
        if test.scheduled_at:
            return True, "The test has not been started by the admin yet. Check the scheduled date."
        return True, "The test has not been started by the admin yet."
    return False, None


def is_awaiting_results(db: Session, user: User) -> bool:
    """True when the user finished every tutorial and submitted every test in their district."""
    district_id = user.program_district_id
    if not district_id:
        return False
    stage_ids = [
        s.id for s in db.query(Stage).filter(Stage.program_district_id == district_id).all()
    ]
    if not stage_ids:
        return False

    tutorial_ids = {t.id for t in db.query(Tutorial.id).filter(Tutorial.stage_id.in_(stage_ids)).all()}
    test_ids = {t.id for t in db.query(Test.id).filter(Test.stage_id.in_(stage_ids)).all()}
    if not tutorial_ids and not test_ids:
        return False

    completed = get_completed_tutorial_ids(db, user)
    if tutorial_ids - completed:
        return False

    for test_id in test_ids:
        submitted = db.query(TestAttempt).filter(
            TestAttempt.user_id == user.id,
            TestAttempt.test_id == test_id,
            TestAttempt.submitted_at.isnot(None),
        ).first()
        if not submitted:
            return False
    return True


def ensure_awaiting_results_notification(db: Session, user: User) -> None:
    """Create the one-time 'wait for your results' notification when the flow is complete."""
    # The session runs with autoflush=False; flush so the in-flight attempt
    # update (submitted_at) is visible to the eligibility queries below.
    db.flush()
    if not is_awaiting_results(db, user):
        return
    exists = db.query(Notification).filter(
        Notification.user_id == user.id,
        Notification.title == AWAITING_RESULTS_TITLE,
    ).first()
    if exists:
        return
    db.add(Notification(
        user_id=user.id,
        title=AWAITING_RESULTS_TITLE,
        message=(
            "Congratulations! You have completed all tutorials and tests. "
            "Please wait for your results — you will be notified once they are announced."
        ),
    ))
