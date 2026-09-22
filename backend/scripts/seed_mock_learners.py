"""
Seed Mock Learners (Pre-Test State).

Generates realistic mock learners (default 300 per district) for Jalna, Ujjain,
and Meghalaya to visualize platform data landing prior to test taking:
  1. Master geography (States, Districts, Blocks, Villages, Facilities)
  2. Complete learner profiles (AWWs, Supervisors, ANMs, ASHAs)
  3. Tutorial video watch engagement across 4 realistic cohorts
  4. Post-tutorial quiz attempts, responses, and scores
  5. Face-to-face training selections and in-app notifications
  6. Zero adoptions / 0 mother-child records (clean pre-test state)
  7. Scheduled tests remain untouched with 0 candidate attempts

Usage:
  python -m scripts.seed_mock_learners [--districts jalna,ujjain] [--count 300]
  python -m scripts.seed_mock_learners --remove
  # Undo a rehearsal top-up, keeping the original 300 per district
  python -m scripts.seed_mock_learners --remove --districts jalna --above 300
"""

import argparse
import random
import re
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.auth import get_password_hash
from app.database import SessionLocal
from app.models import (
    Block,
    Department,
    Designation,
    District,
    EducationalQualification,
    ExperienceRange,
    Facility,
    FaceToFaceSelection,
    Notification,
    ProgramDistrict,
    Question,
    Stage,
    State,
    Test,
    Tutorial,
    TutorialQuestion,
    TutorialQuestionOption,
    TutorialQuizResponse,
    User,
    UserTutorialProgress,
    Village,
)
from app.security.crypto import phone_index

MOCK_EMAIL_DOMAIN = "nurturehub.mock"

# ─────────────────────────────────────────────────────────────────────────────
# Geographic Masters Reference Data
# ─────────────────────────────────────────────────────────────────────────────

GEO_DATA = {
    "jalna": {
        "state_name": "Maharashtra",
        "district_name": "Jalna",
        "blocks": [
            "Jalna", "Bhokardan", "Ambad", "Ghansawangi",
            "Jafrabad", "Badnapur", "Partur", "Mantha",
        ],
    },
    "ujjain": {
        "state_name": "Madhya Pradesh",
        "district_name": "Ujjain",
        "blocks": [
            "Ujjain Rural", "Ghattia", "Tarana", "Mahidpur",
            "Nagda", "Badnagar", "Khachrod",
        ],
    },
    "meghalaya": {
        "state_name": "Meghalaya",
        "district_name": "East Khasi Hills",
        "blocks": [
            "Mawlai", "Mylliem", "Umling", "Rongram", "Mawkynrew",
        ],
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# Regional Names
# ─────────────────────────────────────────────────────────────────────────────

REGIONAL_NAMES = {
    "jalna": {
        "first_names": [
            "Pooja", "Sunita", "Rekha", "Vandana", "Anita", "Savita", "Shobha",
            "Dipali", "Renuka", "Rupali", "Sneha", "Swati", "Meena", "Jyoti",
            "Priyanka", "Ashwini", "Komal", "Madhuri", "Pallavi", "Manisha",
            "Archana", "Kavita", "Ujjwala", "Sangeeta", "Vaishali", "Rohini",
            "Sheetal", "Chhaya", "Pratibha", "Surekha", "Vidya", "Aparna",
            "Sarita", "Mangala", "Shubhangi", "Anjali", "Varsha", "Neeta",
        ],
        "last_names": [
            "Jadhav", "Shinde", "Pawar", "Patil", "Gaikwad", "Kulkarni", "More",
            "Chavan", "Deshmukh", "Joshi", "Bhosale", "Kadam", "Waghmare",
            "Thorat", "Kale", "Ghuge", "Khillare", "Dabhade", "Sawant", "Rathod",
            "Solanke", "Surve", "Mane", "Tambe", "Kharat", "Bankar", "Auti", "Shelke",
        ],
    },
    "ujjain": {
        "first_names": [
            "Meera", "Pooja", "Radha", "Kavita", "Seema", "Anita", "Rekha",
            "Sunita", "Mamta", "Aarti", "Suman", "Sarita", "Bhavna", "Usha",
            "Manju", "Santosh", "Geeta", "Sharda", "Kamla", "Lata", "Pushpa",
            "Maya", "Kiran", "Damyanti", "Vimla", "Shashi", "Nisha", "Deepika",
            "Hemlata", "Rani", "Indira", "Kusum", "Chanda", "Basanti", "Pinki",
        ],
        "last_names": [
            "Rathore", "Chouhan", "Verma", "Malviya", "Sharma", "Solanki",
            "Gehlot", "Tomar", "Gurjar", "Yadav", "Patidar", "Jain", "Tiwari",
            "Pandey", "Mishra", "Bairagi", "Parmar", "Jat", "Choudhary", "Dubey",
            "Upadhyay", "Joshi", "Sen", "Shukla", "Nagar", "Patel", "Meena",
        ],
    },
    "meghalaya": {
        "first_names": [
            "Banrida", "Wanda", "Iba", "Dari", "Daphilashisha", "Banteilang",
            "Ribasuk", "Ibashisha", "Silchi", "Sengkim", "Tengsim", "Rikman",
            "Aibor", "Balapynshngain", "Balarilang", "Dapbiang", "Iada", "Ibanylla",
            "Kyntiew", "Larisa", "Mebanker", "Phidalia", "Rikynti", "Samlin",
            "Therisa", "Wanri", "Badap", "Elgiva", "Careen", "Deimon",
        ],
        "last_names": [
            "Lyngdoh", "Syiem", "Marbaniang", "Kharkongor", "Mawlong", "Nongrum",
            "Khongwir", "Nongstoin", "Sangma", "Marak", "Momin", "Shullai",
            "Dkhar", "Rymbai", "Passah", "Sutnga", "Warjri", "Diengdoh", "Kharbhih",
        ],
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

def _ensure_geography(db: Session, district_slug: str) -> Tuple[int, int, List[int], List[int], List[int]]:
    """Ensures State, District, Blocks, Villages, and Facilities exist."""
    info = GEO_DATA.get(district_slug)
    if not info:
        raise ValueError(f"Unknown district slug: {district_slug}")

    # State
    state = db.query(State).filter(State.name == info["state_name"]).first()
    if not state:
        state = State(name=info["state_name"], is_active=True)
        db.add(state)
        db.flush()

    # District
    district = db.query(District).filter(
        District.state_id == state.id, District.name == info["district_name"]
    ).first()
    if not district:
        district = District(state_id=state.id, name=info["district_name"])
        db.add(district)
        db.flush()

    block_ids = []
    village_ids = []
    facility_ids = []

    for b_name in info["blocks"]:
        block = db.query(Block).filter(
            Block.district_id == district.id, Block.name == b_name
        ).first()
        if not block:
            block = Block(district_id=district.id, name=b_name)
            db.add(block)
            db.flush()
        block_ids.append(block.id)

        # Villages under block
        v_names = [f"{b_name} Khas", f"{b_name} Village 1", f"{b_name} Village 2"]
        for v_name in v_names:
            v = db.query(Village).filter(
                Village.block_id == block.id, Village.name == v_name
            ).first()
            if not v:
                v = Village(block_id=block.id, name=v_name)
                db.add(v)
                db.flush()
            village_ids.append(v.id)

        # Facilities under block
        f_tuples = [
            (f"{b_name} AWC 1", "Anganwadi Center (AWC)"),
            (f"{b_name} AWC 2", "Anganwadi Center (AWC)"),
            (f"{b_name} PHC", "Primary Health Center (PHC)"),
            (f"{b_name} Sub-Centre", "Sub-Centre / Health & Wellness Centre"),
        ]
        for f_name, f_type in f_tuples:
            fac = db.query(Facility).filter(
                Facility.block_id == block.id, Facility.name == f_name
            ).first()
            if not fac:
                fac = Facility(block_id=block.id, name=f_name, facility_type=f_type)
                db.add(fac)
                db.flush()
            facility_ids.append(fac.id)

    db.commit()
    return state.id, district.id, block_ids, village_ids, facility_ids


def _get_or_create_program_district(db: Session, slug: str) -> ProgramDistrict:
    # If slug is meghalaya or khasi, ensure both parent state Meghalaya and child district Khasi exist.
    # Learners belong to the concrete district Khasi (East Khasi Hills).
    if slug in ("meghalaya", "khasi"):
        state_pd = db.query(ProgramDistrict).filter(ProgramDistrict.slug == "meghalaya").first()
        if not state_pd:
            state_pd = ProgramDistrict(
                name="Meghalaya",
                slug="meghalaya",
                code="ML",
                state_prefix="ML",
                level="state",
                is_active=True,
            )
            db.add(state_pd)
            db.commit()

        # Match on the code too: it is the column with the UNIQUE constraint the
        # insert below would collide with, so an existing KH project named
        # anything else ("east khasi", slug east-khasi) must be found, not
        # re-created.
        district_pd = (
            db.query(ProgramDistrict)
            .filter(
                (ProgramDistrict.slug == "khasi")
                | (func.lower(ProgramDistrict.name) == "khasi")
                | (ProgramDistrict.code == "KH")
            )
            .first()
        )
        if not district_pd:
            district_pd = ProgramDistrict(
                name="Khasi",
                slug="khasi",
                code="KH",
                state_prefix="ML",
                level="district",
                parent_id=state_pd.id,
                inherits_content=True,
                is_active=True,
            )
            db.add(district_pd)
            db.commit()
        elif not district_pd.parent_id:
            district_pd.parent_id = state_pd.id
            db.commit()
        return district_pd

    pd = db.query(ProgramDistrict).filter(ProgramDistrict.slug == slug).first()
    if not pd:
        name_map = {"jalna": "Jalna", "ujjain": "Ujjain"}
        code_map = {"jalna": "JL", "ujjain": "UJ"}
        prefix_map = {"jalna": "MH", "ujjain": "MP"}
        pd = ProgramDistrict(
            name=name_map.get(slug, slug.capitalize()),
            slug=slug,
            code=code_map.get(slug, slug[:2].upper()),
            state_prefix=prefix_map.get(slug, slug[:2].upper()),
            level="district",
            is_active=True,
        )
        db.add(pd)
        db.commit()
    return pd


# ─────────────────────────────────────────────────────────────────────────────
# Seeding Execution
# ─────────────────────────────────────────────────────────────────────────────

def _learner_number(email: str) -> Optional[int]:
    """learner.jl.301@nurturehub.mock -> 301 (None if not a numbered learner)."""
    m = re.match(r"learner\.[a-z]+\.(\d+)@", email or "")
    return int(m.group(1)) if m else None


def remove_mock_data(db: Session, districts: Optional[List[str]] = None, above: Optional[int] = None):
    """Remove mock learners and their associated progress records.

    With `above`, only learners numbered above it go — so a rehearsal that
    topped a district up to thousands can be undone without touching the
    original cohort everyone demos with.
    """
    print("Purging existing mock learners...")
    query = db.query(User).filter(User.email.like(f"%@{MOCK_EMAIL_DOMAIN}"))
    if districts:
        expanded_districts = list(districts)
        if "meghalaya" in expanded_districts and "khasi" not in expanded_districts:
            expanded_districts.append("khasi")
        pds = db.query(ProgramDistrict).filter(ProgramDistrict.slug.in_(expanded_districts)).all()
        pd_ids = [p.id for p in pds]
        if pd_ids:
            query = query.filter(User.program_district_id.in_(pd_ids))

    mock_users = query.all()
    if above is not None:
        mock_users = [u for u in mock_users if (_learner_number(u.email) or 0) > above]
        print(f"Keeping learners numbered {above} and below.")
    user_ids = [u.id for u in mock_users]
    print(f"Found {len(user_ids)} mock users to delete.")

    if not user_ids:
        print("No mock users found to remove.")
        return

    # Delete dependent child tables (cascade usually cleans up, but explicit is safest)
    db.query(FaceToFaceSelection).filter(FaceToFaceSelection.user_id.in_(user_ids)).delete(synchronize_session=False)
    db.query(Notification).filter(Notification.user_id.in_(user_ids)).delete(synchronize_session=False)
    db.query(TutorialQuizResponse).filter(TutorialQuizResponse.user_id.in_(user_ids)).delete(synchronize_session=False)
    db.query(UserTutorialProgress).filter(UserTutorialProgress.user_id.in_(user_ids)).delete(synchronize_session=False)
    db.query(User).filter(User.id.in_(user_ids)).delete(synchronize_session=False)
    db.commit()
    print("Purge completed successfully.")


def seed_learners_for_district(db: Session, district_slug: str, count: int = 300):
    print(f"\n========================================================")
    print(f"Seeding {count} mock learners for {district_slug.upper()}...")
    print(f"========================================================")

    pd = _get_or_create_program_district(db, district_slug)
    state_id, district_id, block_ids, village_ids, facility_ids = _ensure_geography(db, district_slug)

    # Master data lookups
    dept_hfw = db.query(Department).filter(Department.code == "HFW").first()
    dept_wcd = db.query(Department).filter(Department.code == "WCD").first()
    wcd_id = dept_wcd.id if dept_wcd else None
    hfw_id = dept_hfw.id if dept_hfw else None

    desig_aww = db.query(Designation).filter(Designation.name.ilike("%Anganwadi Worker%")).first()
    desig_sup = db.query(Designation).filter(Designation.name.ilike("%Supervisor%")).first()
    desig_anm = db.query(Designation).filter(Designation.name == "ANM").first()
    desig_asha = db.query(Designation).filter(Designation.name == "ASHA").first()
    desig_sn = db.query(Designation).filter(Designation.name.ilike("%Staff Nurse%")).first()

    quals = db.query(EducationalQualification).all()
    qual_ids = [q.id for q in quals] or [None]
    exp_ranges = db.query(ExperienceRange).all()
    exp_ids = [e.id for e in exp_ranges] or [None]

    # Fetch district's tutorial stages and tutorials
    stages = db.query(Stage).filter(
        Stage.program_district_id == pd.id, Stage.stage_type == "tutorials"
    ).order_by(Stage.order_index).all()
    stage_ids = [s.id for s in stages]

    tutorials = db.query(Tutorial).options(
        joinedload(Tutorial.quiz_questions).joinedload(TutorialQuestion.options)
    ).filter(Tutorial.stage_id.in_(stage_ids)).order_by(Tutorial.stage_id, Tutorial.order_index).all() if stage_ids else []

    print(f"Found {len(stages)} tutorial stages and {len(tutorials)} tutorial videos for {pd.name}.")

    pwd_hash = get_password_hash("password123")
    names_pool = REGIONAL_NAMES.get(district_slug, REGIONAL_NAMES["jalna"])

    # Split count into cohorts:
    # Cohort A: Top performers (~45%) - Full watch, high quiz scores -> Selected for F2F
    # Cohort B: Average (~30%) - Partial/good watch, decent quiz scores
    # Cohort C: Laggards (~15%) - Low watch, poor/skipped quizzes
    # Cohort D: Inactive (~10%) - Just registered, 0-1 videos opened
    count_a = int(count * 0.45)
    count_b = int(count * 0.30)
    count_c = int(count * 0.15)
    count_d = count - count_a - count_b - count_c

    cohort_assignments = (
        ["A"] * count_a +
        ["B"] * count_b +
        ["C"] * count_c +
        ["D"] * count_d
    )
    random.seed(42 + hash(district_slug) % 1000)
    random.shuffle(cohort_assignments)

    now = datetime.now(timezone.utc)
    seeded_users = []
    face_to_face_candidates = []

    # Map district slug to short prefix
    dist_prefix = {"jalna": "jl", "ujjain": "uj", "meghalaya": "ml"}.get(district_slug, district_slug[:2])

    for i in range(1, count + 1):
        email = f"learner.{dist_prefix}.{i:03d}@{MOCK_EMAIL_DOMAIN}"

        # Check if already exists
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            seeded_users.append((existing, cohort_assignments[i - 1]))
            continue

        first_name = random.choice(names_pool["first_names"])
        last_name = random.choice(names_pool["last_names"])
        full_name = f"{first_name} {last_name}"
        initials = f"{first_name[0]}{last_name[0]}"

        # Role & Designation
        is_wcd = random.random() < 0.70
        if is_wcd:
            dept_id = wcd_id
            dept_name = "Women & Child Development (WCD)"
            if random.random() < 0.75:
                desig_id = desig_aww.id if desig_aww else None
                role_name = "Anganwadi Worker (AWW)"
                category = "AWW"
            else:
                desig_id = desig_sup.id if desig_sup else None
                role_name = "Lady Supervisor"
                category = "Supervisor"
        else:
            dept_id = hfw_id
            dept_name = "Health & Family Welfare (HFW)"
            r = random.random()
            if r < 0.50:
                desig_id = desig_asha.id if desig_asha else None
                role_name = "ASHA"
                category = "ASHA"
            elif r < 0.85:
                desig_id = desig_anm.id if desig_anm else None
                role_name = "ANM"
                category = "ANM"
            else:
                desig_id = desig_sn.id if desig_sn else None
                role_name = "Staff Nurse"
                category = "Staff Nurse"

        phone_num = f"98{random.randint(10000000, 99999999)}"
        p_lookup = phone_index(phone_num, "users.phone")

        years_service = round(random.uniform(2.0, 18.0), 1)
        years_desig = round(min(years_service, random.uniform(1.0, years_service)), 1)
        years_fac = round(min(years_desig, random.uniform(0.5, years_desig)), 1)
        distance = round(random.uniform(0.5, 22.0), 1)

        age = random.randint(23, 52)
        dob = (now - timedelta(days=age * 365 + random.randint(0, 300))).date()

        user = User(
            email=email,
            password_hash=pwd_hash,
            full_name=full_name,
            avatar_initials=initials,
            age=age,
            date_of_birth=dob,
            gender="Female",
            phone=phone_num,
            phone_lookup=p_lookup,
            state_id=state_id,
            district_id=district_id,
            block_id=random.choice(block_ids) if block_ids else None,
            village_id=random.choice(village_ids) if village_ids else None,
            facility_id=random.choice(facility_ids) if facility_ids else None,
            department_id=dept_id,
            department=dept_name,
            designation_id=desig_id,
            role=role_name,
            learner_category=category,
            qualification_id=random.choice(qual_ids),
            experience_range_id=random.choice(exp_ids),
            years_service=years_service,
            years_designation=years_desig,
            years_facility=years_fac,
            residence_distance_km=distance,
            marital_status="Married" if random.random() < 0.88 else "Never married",
            has_children=True if random.random() < 0.85 else False,
            number_children=random.choice([1, 2, 3]) if random.random() < 0.85 else 0,
            internet_workplace=random.choice(["Always", "Often", "Sometimes"]),
            nutrition_training="Yes" if random.random() < 0.70 else "No",
            pregnancy_nutrition_training="Yes" if random.random() < 0.65 else "No",
            breastfeeding_training="Yes" if random.random() < 0.75 else "No",
            complementary_feeding_training="Yes" if random.random() < 0.60 else "No",
            growth_monitoring_training="Yes" if random.random() < 0.80 else "No",
            is_verified=True,
            is_admin=False,
            program_district_id=pd.id,
            created_at=now - timedelta(days=random.randint(15, 60)),
        )
        db.add(user)
        seeded_users.append((user, cohort_assignments[i - 1]))

    db.commit()
    print(f"Ensured {len(seeded_users)} users in database for {pd.name}.")

    # Re-runs (e.g. topping a project up from 300 to 6,000 for a load
    # rehearsal) must not touch learners who already have history: their
    # progress rows would collide with uq_user_tutorial, and they would be
    # selected for face-to-face a second time. Only NEW learners get generated
    # progress and selections.
    user_ids = [u.id for u, _ in seeded_users]
    already = set()
    for start in range(0, len(user_ids), 1000):
        chunk = user_ids[start:start + 1000]
        already.update(uid for (uid,) in db.query(UserTutorialProgress.user_id)
                       .filter(UserTutorialProgress.user_id.in_(chunk)).distinct().all())
    if already:
        print(f"Keeping existing history for {len(already)} learner(s); generating for the new ones only.")
        seeded_users = [(u, c) for u, c in seeded_users if u.id not in already]

    # ─────────────────────────────────────────────────────────────────────────
    # Tutorial Progress & Quiz Responses
    # ─────────────────────────────────────────────────────────────────────────
    total_progress_rows = 0
    total_quiz_answers = 0

    for user, cohort in seeded_users:
        if cohort == "A":
            # Cohort A: Top Performers (Candidate for F2F)
            face_to_face_candidates.append(user)
            # Watched all tutorials
            for t_idx, tut in enumerate(tutorials):
                watch_pct = round(random.uniform(92.0, 100.0), 1)
                duration = (tut.duration_minutes or 5) * 60
                watch_time = round(duration * (watch_pct / 100.0), 1)
                comp_at = now - timedelta(days=random.randint(2, 20), hours=random.randint(1, 12))

                # Post-tutorial quiz
                quiz_questions = tut.quiz_questions
                q_count = len(quiz_questions)
                correct_count = 0

                if q_count > 0:
                    quiz_status = "completed"
                    # Cohort A gets 80-100% correct
                    for q in quiz_questions:
                        correct_opt = next((o for o in q.options if o.is_correct), None)
                        wrong_opts = [o for o in q.options if not o.is_correct]
                        # 90% chance right
                        if random.random() < 0.90 or not wrong_opts:
                            sel_opt = correct_opt
                            is_corr = True
                            correct_count += 1
                        else:
                            sel_opt = random.choice(wrong_opts)
                            is_corr = False

                        if sel_opt:
                            resp = TutorialQuizResponse(
                                user_id=user.id,
                                tutorial_id=tut.id,
                                question_id=q.id,
                                selected_option_id=sel_opt.id,
                                is_correct=is_corr,
                                answered_at=comp_at,
                            )
                            db.add(resp)
                            total_quiz_answers += 1
                else:
                    quiz_status = "n/a"

                prog = UserTutorialProgress(
                    user_id=user.id,
                    tutorial_id=tut.id,
                    is_completed=True,
                    completed_at=comp_at,
                    watch_pct=watch_pct,
                    watch_time_seconds=watch_time,
                    last_position_seconds=watch_time,
                    video_duration_seconds=float(duration),
                    quiz_status=quiz_status,
                    quiz_score=float(correct_count) if q_count > 0 else None,
                    quiz_total=q_count if q_count > 0 else None,
                )
                db.add(prog)
                total_progress_rows += 1

        elif cohort == "B":
            # Cohort B: Steady Average Learners
            for t_idx, tut in enumerate(tutorials):
                # Phase 1: watched; Phase 3: partial
                is_phase_1 = (t_idx < len(tutorials) // 2)
                if is_phase_1:
                    watch_pct = round(random.uniform(70.0, 95.0), 1)
                    is_comp = True
                else:
                    watch_pct = round(random.uniform(30.0, 75.0), 1)
                    is_comp = watch_pct >= 60.0

                duration = (tut.duration_minutes or 5) * 60
                watch_time = round(duration * (watch_pct / 100.0), 1)
                comp_at = now - timedelta(days=random.randint(1, 15)) if is_comp else None

                quiz_questions = tut.quiz_questions
                q_count = len(quiz_questions)
                correct_count = 0

                if q_count > 0:
                    # 75% completed, 15% skipped, 10% pending
                    r = random.random()
                    if r < 0.75:
                        quiz_status = "completed"
                        for q in quiz_questions:
                            correct_opt = next((o for o in q.options if o.is_correct), None)
                            wrong_opts = [o for o in q.options if not o.is_correct]
                            if random.random() < 0.65 or not wrong_opts:
                                sel_opt = correct_opt
                                is_corr = True
                                correct_count += 1
                            else:
                                sel_opt = random.choice(wrong_opts)
                                is_corr = False
                            if sel_opt:
                                resp = TutorialQuizResponse(
                                    user_id=user.id,
                                    tutorial_id=tut.id,
                                    question_id=q.id,
                                    selected_option_id=sel_opt.id,
                                    is_correct=is_corr,
                                    answered_at=comp_at or now,
                                )
                                db.add(resp)
                                total_quiz_answers += 1
                    elif r < 0.90:
                        quiz_status = "skipped"
                    else:
                        quiz_status = "pending"
                else:
                    quiz_status = "n/a"

                prog = UserTutorialProgress(
                    user_id=user.id,
                    tutorial_id=tut.id,
                    is_completed=is_comp,
                    completed_at=comp_at,
                    watch_pct=watch_pct,
                    watch_time_seconds=watch_time,
                    last_position_seconds=watch_time,
                    video_duration_seconds=float(duration),
                    quiz_status=quiz_status,
                    quiz_score=float(correct_count) if quiz_status == "completed" else None,
                    quiz_total=q_count if quiz_status == "completed" else None,
                )
                db.add(prog)
                total_progress_rows += 1

        elif cohort == "C":
            # Cohort C: Laggards / Partial Watchers (only watched 1-2 videos)
            for t_idx, tut in enumerate(tutorials):
                if t_idx < 2:
                    watch_pct = round(random.uniform(25.0, 55.0), 1)
                    duration = (tut.duration_minutes or 5) * 60
                    watch_time = round(duration * (watch_pct / 100.0), 1)
                    quiz_status = random.choice(["skipped", "pending"])
                    prog = UserTutorialProgress(
                        user_id=user.id,
                        tutorial_id=tut.id,
                        is_completed=False,
                        completed_at=None,
                        watch_pct=watch_pct,
                        watch_time_seconds=watch_time,
                        last_position_seconds=watch_time,
                        video_duration_seconds=float(duration),
                        quiz_status=quiz_status,
                        quiz_score=None,
                        quiz_total=None,
                    )
                    db.add(prog)
                    total_progress_rows += 1

        else:
            # Cohort D: Inactive / Newly Enrolled
            if tutorials and random.random() < 0.40:
                tut = tutorials[0]
                watch_pct = round(random.uniform(5.0, 15.0), 1)
                duration = (tut.duration_minutes or 5) * 60
                watch_time = round(duration * (watch_pct / 100.0), 1)
                prog = UserTutorialProgress(
                    user_id=user.id,
                    tutorial_id=tut.id,
                    is_completed=False,
                    completed_at=None,
                    watch_pct=watch_pct,
                    watch_time_seconds=watch_time,
                    last_position_seconds=watch_time,
                    video_duration_seconds=float(duration),
                    quiz_status="pending",
                )
                db.add(prog)
                total_progress_rows += 1

    db.commit()
    print(f"Generated {total_progress_rows} tutorial progress records and {total_quiz_answers} quiz answers.")

    # ─────────────────────────────────────────────────────────────────────────
    # Face-to-Face Training Selection (~25% of total, drawn from Cohort A)
    # ─────────────────────────────────────────────────────────────────────────
    f2f_target = int(count * 0.25)
    selected_f2f = face_to_face_candidates[:f2f_target]
    print(f"Selecting {len(selected_f2f)} top learners for Face-to-Face training in {pd.name}...")

    for user in selected_f2f:
        f2f = FaceToFaceSelection(
            user_id=user.id,
            program_district_id=pd.id,
            uploaded_by="admin@nurturehub.org",
            notified=True,
            selected_at=now - timedelta(days=random.randint(1, 4)),
        )
        db.add(f2f)

        notif = Notification(
            user_id=user.id,
            title="Selected for Face-to-Face Training",
            message=(
                "Congratulations! Based on your exemplary tutorial engagement and quiz scores, "
                "you have been selected for the upcoming in-person Face-to-Face Clinical Training workshop. "
                "Please await further instructions from your block supervisor."
            ),
            link="/tutorials",
            is_read=False,
            created_at=now - timedelta(days=1),
        )
        db.add(notif)

    db.commit()
    print(f"Face-to-Face selections and notifications recorded successfully for {pd.name}.\n")


def main():
    parser = argparse.ArgumentParser(description="Seed mock learners in pre-test state.")
    parser.add_argument(
        "--districts",
        type=str,
        default=None,
        help="Comma-separated district slugs (default: all districts 'jalna,ujjain,meghalaya')",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=300,
        help="Number of mock learners to create per district (default: 300)",
    )
    parser.add_argument(
        "--remove",
        action="store_true",
        help="Remove previously seeded mock data instead of seeding",
    )
    parser.add_argument(
        "--above",
        type=int,
        default=None,
        help="With --remove: only remove learners numbered above this (e.g. 300 keeps the original cohort)",
    )

    args = parser.parse_args()
    db = SessionLocal()

    try:
        if args.districts:
            district_slugs = [d.strip().lower() for d in args.districts.split(",") if d.strip()]
        else:
            district_slugs = list(GEO_DATA.keys()) if not args.remove else None

        if args.remove:
            remove_mock_data(db, district_slugs, above=args.above)
            return

        for dist_slug in district_slugs:
            if dist_slug not in GEO_DATA:
                print(f"Warning: Unknown district '{dist_slug}'. Available: {list(GEO_DATA.keys())}")
                continue
            seed_learners_for_district(db, dist_slug, count=args.count)

        print("\nAll mock seeding finished successfully!")
        print("Summary of data landing:")
        print("  - Admin Learners: visible at /admin/learners")
        print("  - Admin Results: full matrix visible at /admin/results")
        print("  - Face-to-Face Selections: visible at /admin/results/face-to-face")
        print("  - Adoptions/Mothers/Children: 0 (clean pre-test state)")
        print("  - Tests: ready in 'scheduled' status")

    finally:
        db.close()


if __name__ == "__main__":
    main()
