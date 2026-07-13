"""
Database seeding.

Two layers:
  1. Essential reference data (states/districts/blocks/villages/facilities,
     qualifications, experience ranges, achievements) — always seeded, the
     registration form and dashboard need them.
  2. Demo/mock data (program districts, demo users, the 4-phase content flow
     with tutorials, quizzes and tests) — only when settings.SEED_DEMO_DATA is
     true. Set SEED_DEMO_DATA=false in production and ingest real data instead.

Every block is idempotent via count guards, so startup re-seeding is a no-op
on an already-populated database. Use backend/reseed.py to rebuild from scratch.

The demo content follows the 4-phase flow:
  Phase 1: Basic Videos    (stage_type='tutorials') — required before the formative test
  Phase 2: Formative Test  (stage_type='test', test_type='formative', scheduled)
  Phase 3: Add-on Videos   (stage_type='tutorials') — required before the screening test
  Phase 4: Screening Test  (stage_type='test', test_type='screening', scheduled)
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    Stage, Tutorial, TutorialQuestion, TutorialQuestionOption,
    Test, Question, QuestionOption, Achievement,
    State, District, Block, Village, Facility, EducationalQualification, ExperienceRange,
    ProgramDistrict, User, Department, Designation, FacilityType,
    MotherEducationLevel, EducationField, EducationDegree,
)


def seed_database(db: Session):
    _seed_metadata(db)
    _seed_achievements(db)
    _seed_professional_axis(db)   # LR reference data — essential, always seeded
    _seed_mother_reference(db)    # MR education cascade — essential, always seeded

    if not settings.SEED_DEMO_DATA:
        print("SEED_DEMO_DATA is false — skipping demo districts, users and content.")
        return

    _seed_program_districts_and_users(db)

    if db.query(Stage).count() > 0:
        print("Database already contains stage data, skipping content seeding.")
        return

    print("Seeding 4-phase demo content per district...")
    now = datetime.now(timezone.utc)
    formative_at = (now + timedelta(days=7)).replace(hour=10, minute=0, second=0, microsecond=0)
    screening_at = (now + timedelta(days=14)).replace(hour=10, minute=0, second=0, microsecond=0)

    for slug, flow in DEMO_FLOWS.items():
        pd = db.query(ProgramDistrict).filter(ProgramDistrict.slug == slug).first()
        if pd:
            _seed_flow(db, pd.id, flow, formative_at, screening_at)

    print("Database seeding completed successfully.")


# ═══════════════════════════════════════════════
# Essential reference data (always seeded)
# ═══════════════════════════════════════════════

def _seed_metadata(db: Session):
    if db.query(State).count() > 0:
        return
    print("Seeding locations and metadata...")
    # 1. States
    up = State(name="Uttar Pradesh", is_active=True)
    bihar = State(name="Bihar", is_active=True)
    db.add_all([up, bihar])
    db.commit()

    # 2. Districts
    gkp = District(state_id=up.id, name="Gorakhpur")
    lko = District(state_id=up.id, name="Lucknow")
    pat = District(state_id=bihar.id, name="Patna")
    db.add_all([gkp, lko, pat])
    db.commit()

    # 3. Blocks
    bhathat = Block(district_id=gkp.id, name="Bhathat")
    pipraich = Block(district_id=gkp.id, name="Pipraich")
    malihabad = Block(district_id=lko.id, name="Malihabad")
    patnasad = Block(district_id=pat.id, name="Patna Sadar")
    db.add_all([bhathat, pipraich, malihabad, patnasad])
    db.commit()

    # 4. Villages
    db.add_all([
        Village(block_id=bhathat.id, name="Kalyanpur"),
        Village(block_id=bhathat.id, name="Bhathat Khas"),
        Village(block_id=pipraich.id, name="Pipraich Village"),
        Village(block_id=malihabad.id, name="Malihabad Khas"),
        Village(block_id=malihabad.id, name="Kasmandi Kalan"),
        Village(block_id=patnasad.id, name="Sadikpur"),
        Village(block_id=patnasad.id, name="Danapur"),
    ])
    db.commit()

    # 5. Facilities
    db.add_all([
        Facility(block_id=bhathat.id, name="Kalyanpur AWC", facility_type="Anganwadi Center (AWC)"),
        Facility(block_id=bhathat.id, name="Bhathat PHC", facility_type="Primary Health Center (PHC)"),
        Facility(block_id=pipraich.id, name="Pipraich AWC 1", facility_type="Anganwadi Center (AWC)"),
        Facility(block_id=malihabad.id, name="Malihabad AWC 1", facility_type="Anganwadi Center (AWC)"),
        Facility(block_id=malihabad.id, name="Malihabad CHC", facility_type="Primary Health Center (PHC)"),
        Facility(block_id=patnasad.id, name="Patna Sadar AWC 1", facility_type="Anganwadi Center (AWC)"),
        Facility(block_id=patnasad.id, name="Patna Sadar PHC", facility_type="Primary Health Center (PHC)"),
    ])
    db.commit()

    # 6. Educational Qualifications
    db.add_all([
        EducationalQualification(qualification_name="High School (10th)", has_semi_open_input=False),
        EducationalQualification(qualification_name="Higher Secondary (12th)", has_semi_open_input=False),
        EducationalQualification(qualification_name="Graduate (BA/BSc/BCom/etc)", has_semi_open_input=False),
        EducationalQualification(qualification_name="Post Graduate (MA/MSc/MCom/etc)", has_semi_open_input=False),
        EducationalQualification(qualification_name="Other (Please specify)", has_semi_open_input=True),
    ])
    db.commit()

    # 7. Experience Ranges
    db.add_all([
        ExperienceRange(label="Under 1 year", order_index=0),
        ExperienceRange(label="1 - 3 years", order_index=1),
        ExperienceRange(label="3 - 5 years", order_index=2),
        ExperienceRange(label="5 - 10 years", order_index=3),
        ExperienceRange(label="10+ years", order_index=4),
    ])
    db.commit()


def _seed_achievements(db: Session):
    if db.query(Achievement).count() > 0:
        return
    db.add_all([
        Achievement(title="Fast Learner", description="Completed your first tutorial video", emoji_icon="⚡"),
        Achievement(title="Scholar", description="Scored 100% on any assessment", emoji_icon="🎓"),
        Achievement(title="Graduate", description="Completed all phases of training", emoji_icon="🏆"),
    ])
    db.commit()


# ═══════════════════════════════════════════════
# Demo data (SEED_DEMO_DATA only)
# ═══════════════════════════════════════════════

def _seed_program_districts_and_users(db: Session):
    if db.query(ProgramDistrict).count() > 0:
        return
    print("Seeding program districts and demo users...")
    pd_jalna = ProgramDistrict(name="Jalna", slug="jalna", is_active=True)
    pd_ujjain = ProgramDistrict(name="Ujjain", slug="ujjain", is_active=True)
    pd_meghalaya = ProgramDistrict(name="Meghalaya", slug="meghalaya", is_active=True)
    db.add_all([pd_jalna, pd_ujjain, pd_meghalaya])
    db.commit()

    from app.auth import get_password_hash
    pwd_hash = get_password_hash("password123")

    db.add_all([
        User(
            email="ayushman2412@gmail.com", password_hash=pwd_hash,
            full_name="Ayushman Meghalaya", is_verified=True,
            program_district_id=pd_meghalaya.id, avatar_initials="AM",
            role="Anganwadi Worker (AWW)",  # complete profile so demo users land on the dashboard
        ),
        User(
            email="aayushman@edupyramids.org", password_hash=pwd_hash,
            full_name="Aayushman Ujjain", is_verified=True,
            program_district_id=pd_ujjain.id, avatar_initials="AU",
            role="Anganwadi Supervisor",
        ),
        User(
            email="admin@nurturehub.org", password_hash=pwd_hash,
            full_name="NurtureHUB Admin", is_verified=True, is_admin=True,
            avatar_initials="AD", role="Administrator",
        ),
    ])
    db.commit()


def _seed_flow(db: Session, district_id: int, flow: dict, formative_at: datetime, screening_at: datetime):
    """Create the 4 phases (2 tutorial stages + 2 scheduled tests) for one district."""
    # Phase 1: Basic Videos
    _seed_tutorial_stage(db, district_id, order_index=0, phase=flow["phase1"])

    # Phase 2: Formative Test
    _seed_test_stage(
        db, district_id, order_index=1, test_type="formative",
        scheduled_at=formative_at, spec=flow["formative"],
    )

    # Phase 3: Add-on Videos
    _seed_tutorial_stage(db, district_id, order_index=2, phase=flow["phase3"])

    # Phase 4: Screening Test
    _seed_test_stage(
        db, district_id, order_index=3, test_type="screening",
        scheduled_at=screening_at, spec=flow["screening"],
    )


def _seed_tutorial_stage(db: Session, district_id: int, order_index: int, phase: dict):
    stage = Stage(
        program_district_id=district_id, title=phase["title"],
        description=phase["description"], order_index=order_index,
        stage_type="tutorials", quiz_enabled=True,
    )
    db.add(stage)
    db.commit()

    for i, tut in enumerate(phase["tutorials"]):
        tutorial = Tutorial(
            stage_id=stage.id, title=tut["title"], description=tut["description"],
            module_number=tut["module"], duration_minutes=tut["minutes"],
            video_url=tut.get("video_url"), youtube_url=tut.get("youtube_url"),
            start_seconds=tut.get("start_seconds"), end_seconds=tut.get("end_seconds"),
            gradient_colors=tut["gradient"], order_index=i, quiz_enabled=True,
        )
        db.add(tutorial)
        db.commit()
        for qi, q in enumerate(tut.get("quiz", [])):
            question = TutorialQuestion(tutorial_id=tutorial.id, text=q["text"], order_index=qi)
            db.add(question)
            db.commit()
            db.add_all([
                TutorialQuestionOption(
                    question_id=question.id, label=label, text=text, is_correct=correct,
                )
                for label, text, correct in q["options"]
            ])
            db.commit()


def _seed_test_stage(db: Session, district_id: int, order_index: int, test_type: str,
                     scheduled_at: datetime, spec: dict):
    stage = Stage(
        program_district_id=district_id, title=spec["stage_title"],
        description=spec["stage_description"], order_index=order_index,
        stage_type="test", quiz_enabled=False,
    )
    db.add(stage)
    db.commit()

    test = Test(
        stage_id=stage.id, title=spec["title"], description=spec["description"],
        total_questions=len(spec["questions"]), duration_minutes=spec["minutes"],
        passing_score_pct=spec.get("passing_pct", 70), max_attempts=spec.get("max_attempts", 3),
        status="scheduled", test_type=test_type, scheduled_at=scheduled_at,
    )
    db.add(test)
    db.commit()

    for qi, q in enumerate(spec["questions"]):
        question = Question(test_id=test.id, text=q["text"], marks=q.get("marks", 2), order_index=qi)
        db.add(question)
        db.commit()
        db.add_all([
            QuestionOption(question_id=question.id, label=label, text=text, is_correct=correct)
            for label, text, correct in q["options"]
        ])
        db.commit()


# ═══════════════════════════════════════════════
# Demo content definitions
# ═══════════════════════════════════════════════

MP4_A = "https://www.w3schools.com/html/mov_bbb.mp4"
MP4_B = "https://www.w3schools.com/html/movie.mp4"
# A stable public YouTube video to exercise the YouTube player + clipping path
YT_DEMO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"


DEMO_FLOWS = {
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # JALNA — ICDS Foundation focus
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    "jalna": {
        "phase1": {
            "title": "Phase 1: Basic Videos",
            "description": "Core concepts of child growth monitoring, nutrition standards and early stimulation. Complete all videos to become eligible for the Formative Test.",
            "tutorials": [
                {
                    "title": "Introduction to Child Development Tracker",
                    "description": "Learn how to record developmental milestones and identify growth faltering early.",
                    "module": "Module 1.1", "minutes": 5, "video_url": MP4_A,
                    "gradient": "from-teal-500 to-cyan-500",
                    "quiz": [
                        {"text": "What is the main purpose of a child development tracker?",
                         "options": [("A", "To record developmental milestones and spot growth faltering early", True),
                                     ("B", "To register births in the village", False),
                                     ("C", "To track school attendance", False),
                                     ("D", "To calculate family income", False)]},
                        {"text": "How often should a child under 3 be weighed for growth monitoring?",
                         "options": [("A", "Once a year", False),
                                     ("B", "Every month", True),
                                     ("C", "Only when sick", False),
                                     ("D", "Every two years", False)]},
                        {"text": "Growth faltering is best detected by...",
                         "options": [("A", "Comparing the child with neighbours' children", False),
                                     ("B", "A flattening or falling growth curve across visits", True),
                                     ("C", "The child's appetite alone", False),
                                     ("D", "Skin colour", False)]},
                    ],
                },
                {
                    "title": "Nutrition & Growth Standards",
                    "description": "Understand the WHO growth standards, weight-for-age charts, and checking for stunting/wasting.",
                    "module": "Module 1.2", "minutes": 8, "video_url": MP4_B,
                    "gradient": "from-emerald-500 to-teal-500",
                    "quiz": [
                        {"text": "Which chart indicator is used to assess wasting?",
                         "options": [("A", "Weight-for-height (or length)", True),
                                     ("B", "Height-for-age", False),
                                     ("C", "Head circumference", False),
                                     ("D", "Teeth count", False)]},
                        {"text": "Stunting reflects...",
                         "options": [("A", "Short-term acute malnutrition", False),
                                     ("B", "Chronic long-term undernutrition (low height-for-age)", True),
                                     ("C", "Overweight", False),
                                     ("D", "A normal growth pattern", False)]},
                        {"text": "At what age should complementary feeding start alongside breastfeeding?",
                         "options": [("A", "3 months", False), ("B", "6 months", True),
                                     ("C", "12 months", False), ("D", "At the first tooth", False)]},
                    ],
                },
                {
                    "title": "Early Stimulation Play Practices",
                    "description": "Guide parents on simple home activities that boost cognitive development in children under 3.",
                    "module": "Module 1.3", "minutes": 6, "video_url": MP4_A,
                    "gradient": "from-cyan-500 to-blue-500",
                    "quiz": [
                        {"text": "Early stimulation activities mainly boost...",
                         "options": [("A", "Cognitive and motor development", True),
                                     ("B", "Only physical weight gain", False),
                                     ("C", "Nothing measurable", False),
                                     ("D", "Only language after age 5", False)]},
                        {"text": "Which is a good early-stimulation practice for a 1-year-old?",
                         "options": [("A", "Watching television for several hours", False),
                                     ("B", "Simple talk, play and naming objects during daily routines", True),
                                     ("C", "Keeping the child isolated so they rest", False),
                                     ("D", "Formal writing practice", False)]},
                        {"text": "By 12 months, a child is typically expected to...",
                         "options": [("A", "Run steadily", False),
                                     ("B", "Stand alone and possibly take first steps", True),
                                     ("C", "Speak complex sentences", False),
                                     ("D", "Draw shapes", False)]},
                    ],
                },
            ],
        },
        "formative": {
            "stage_title": "Phase 2: Formative Test",
            "stage_description": "A scheduled assessment on the Phase 1 basic videos. Complete all Phase 1 videos to be eligible.",
            "title": "Formative Test: ICDS Foundations",
            "description": "Covers child growth monitoring, WHO charts, milestones and nutrition basics from Phase 1.",
            "minutes": 15,
            "questions": [
                {"text": "What is the primary indicator used to assess acute growth faltering (wasting) in WHO charts?",
                 "options": [("A", "Weight-for-height (or length)", True), ("B", "Height-for-age", False),
                             ("C", "Head circumference-for-age", False), ("D", "MUAC only", False)]},
                {"text": "At what age should complementary feeding start alongside continued breastfeeding?",
                 "options": [("A", "At 3 months", False), ("B", "At 6 months", True),
                             ("C", "At 12 months", False), ("D", "When the child gets their first tooth", False)]},
                {"text": "Which developmental milestone is typically expected of a child by 12 months of age?",
                 "options": [("A", "Running steadily without falling", False),
                             ("B", "Standing alone and potentially taking first steps", True),
                             ("C", "Speaking full complex sentences", False),
                             ("D", "Drawing clear geometrical shapes", False)]},
                {"text": "How often should a child under 3 be weighed for growth monitoring?",
                 "options": [("A", "Every month", True), ("B", "Once a year", False),
                             ("C", "Only when the child looks thin", False), ("D", "Every two years", False)]},
                {"text": "Stunting (low height-for-age) is a sign of...",
                 "options": [("A", "Acute infection", False), ("B", "Chronic long-term undernutrition", True),
                             ("C", "Overfeeding", False), ("D", "Normal variation only", False)]},
            ],
        },
        "phase3": {
            "title": "Phase 3: Add-on Videos",
            "description": "Advanced interventions and counselling skills. Watch after passing the Formative Test (you may preview earlier). Completing all videos makes you eligible for the Screening Test.",
            "tutorials": [
                {
                    "title": "Micro-Nutrient Supplements Guide",
                    "description": "Proper dosing schedules for Vitamin A, Iron-Folic Acid (IFA), and Zinc supplements.",
                    "module": "Module 2.1", "minutes": 10,
                    "youtube_url": YT_DEMO, "start_seconds": 10, "end_seconds": 90,
                    "gradient": "from-amber-500 to-orange-500",
                    "quiz": [
                        {"text": "How often should Vitamin A be given to children aged 12-59 months?",
                         "options": [("A", "Every month", False), ("B", "Every 6 months", True),
                                     ("C", "Once a year", False), ("D", "Only when deficient", False)]},
                        {"text": "IFA supplementation primarily prevents...",
                         "options": [("A", "Anaemia", True), ("B", "Malaria", False),
                                     ("C", "Diarrhoea", False), ("D", "Fever", False)]},
                        {"text": "Zinc is recommended along with ORS in the management of...",
                         "options": [("A", "Diarrhoea", True), ("B", "Cough", False),
                                     ("C", "Skin rash", False), ("D", "Ear pain", False)]},
                    ],
                },
                {
                    "title": "Severe Acute Malnutrition Management",
                    "description": "How to perform appetite tests, use Ready-to-Use Therapeutic Food (RUTF), and criteria for referral.",
                    "module": "Module 2.2", "minutes": 12, "video_url": MP4_A,
                    "gradient": "from-rose-500 to-pink-500",
                    "quiz": [
                        {"text": "The MUAC threshold for SAM in children 6-59 months is...",
                         "options": [("A", "Less than 11.5 cm", True), ("B", "11.5–12.5 cm", False),
                                     ("C", "Less than 13.5 cm", False), ("D", "MUAC is not used", False)]},
                        {"text": "RUTF stands for...",
                         "options": [("A", "Ready-to-Use Therapeutic Food", True),
                                     ("B", "Rapid Universal Treatment Formula", False),
                                     ("C", "Routine Under-five Tracking Form", False),
                                     ("D", "Regional Unit for Tribal Families", False)]},
                        {"text": "A SAM child who fails the appetite test should be...",
                         "options": [("A", "Referred to a facility immediately", True),
                                     ("B", "Given extra RUTF at home", False),
                                     ("C", "Observed for a month", False),
                                     ("D", "Given only water", False)]},
                    ],
                },
                {
                    "title": "Counseling Mothers on Breastfeeding",
                    "description": "Effective latching positions, counseling for milk supply issues, and overcoming local misconceptions.",
                    "module": "Module 2.3", "minutes": 15, "video_url": MP4_B,
                    "gradient": "from-indigo-500 to-violet-500",
                    "quiz": [
                        {"text": "What is colostrum?",
                         "options": [("A", "Artificial formula milk", False),
                                     ("B", "The first, nutrient-rich yellow breastmilk after birth", True),
                                     ("C", "A micro-nutrient tablet", False),
                                     ("D", "A sanitation solution", False)]},
                        {"text": "Which counselling approach works best with mothers?",
                         "options": [("A", "Lecturing on mistakes", False),
                                     ("B", "Active listening, praise and joint problem solving", True),
                                     ("C", "Leaving brochures", False),
                                     ("D", "Threatening fines", False)]},
                        {"text": "Exclusive breastfeeding is recommended for the first...",
                         "options": [("A", "6 weeks", False), ("B", "3 months", False),
                                     ("C", "6 months", True), ("D", "12 months", False)]},
                    ],
                },
            ],
        },
        "screening": {
            "stage_title": "Phase 4: Screening Test",
            "stage_description": "The final scheduled screening. Complete all Phase 3 add-on videos to be eligible. Revise earlier videos while you wait.",
            "title": "Screening Test: Advanced ICDS Practice",
            "description": "Covers supplementation, SAM management and counselling from the add-on videos.",
            "minutes": 20,
            "questions": [
                {"text": "What is the MUAC threshold for classifying a child (6-59 months) as having SAM?",
                 "options": [("A", "Less than 11.5 cm (115 mm)", True), ("B", "Between 11.5 and 12.5 cm", False),
                             ("C", "Less than 13.5 cm", False), ("D", "Only depends on weight status", False)]},
                {"text": "How often should Vitamin A supplements be administered to children aged 12-59 months?",
                 "options": [("A", "Every month", False), ("B", "Every 6 months", True),
                             ("C", "Once a year", False), ("D", "Only with clinical signs", False)]},
                {"text": "Which counseling technique is most effective during ICDS home visits?",
                 "options": [("A", "Lecturing the family on their mistakes", False),
                             ("B", "Active listening, praising good practices, and mutual problem solving", True),
                             ("C", "Just dropping off brochures and leaving", False),
                             ("D", "Fining non-compliant families", False)]},
                {"text": "What is colostrum?",
                 "options": [("A", "A type of artificial formula milk", False),
                             ("B", "The first, nutrient-rich yellow breastmilk produced after birth", True),
                             ("C", "A micro-nutrient tablet", False),
                             ("D", "A sanitation solution for work centers", False)]},
            ],
        },
    },

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # UJJAIN — Maternal & Immunization focus
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    "ujjain": {
        "phase1": {
            "title": "Phase 1: Basic Videos",
            "description": "Antenatal care, IFA supplementation and birth preparedness. Complete all videos to become eligible for the Formative Test.",
            "tutorials": [
                {
                    "title": "Antenatal Care Visits Protocol",
                    "description": "Understand the minimum 4-visit ANC schedule, danger signs, and referral criteria.",
                    "module": "Module 1.1", "minutes": 7, "video_url": MP4_A,
                    "gradient": "from-rose-500 to-pink-500",
                    "quiz": [
                        {"text": "How many ANC visits are recommended as a minimum during pregnancy?",
                         "options": [("A", "2", False), ("B", "4", True), ("C", "6", False), ("D", "1", False)]},
                        {"text": "Which is a danger sign in pregnancy needing immediate referral?",
                         "options": [("A", "Mild nausea", False),
                                     ("B", "Severe headache with blurred vision", True),
                                     ("C", "Occasional fatigue", False), ("D", "Increased appetite", False)]},
                        {"text": "The first ANC visit should ideally happen...",
                         "options": [("A", "In the first trimester", True), ("B", "Only in month 9", False),
                                     ("C", "After delivery", False), ("D", "Whenever convenient after month 6", False)]},
                    ],
                },
                {
                    "title": "Iron-Folic Acid Supplementation",
                    "description": "Dosage, timing, and addressing side effects of IFA tablets during pregnancy.",
                    "module": "Module 1.2", "minutes": 6, "video_url": MP4_B,
                    "gradient": "from-red-500 to-rose-500",
                    "quiz": [
                        {"text": "IFA tablets during pregnancy primarily prevent...",
                         "options": [("A", "Maternal anaemia", True), ("B", "Morning sickness", False),
                                     ("C", "High blood pressure", False), ("D", "Gestational diabetes", False)]},
                        {"text": "A common, harmless side effect of IFA tablets is...",
                         "options": [("A", "Dark stools", True), ("B", "Blurred vision", False),
                                     ("C", "Hair loss", False), ("D", "Fever", False)]},
                        {"text": "To reduce nausea, IFA tablets are best taken...",
                         "options": [("A", "On an empty stomach at dawn", False),
                                     ("B", "After a meal or at night", True),
                                     ("C", "Only with tea", False), ("D", "Crushed into milk", False)]},
                    ],
                },
                {
                    "title": "Birth Preparedness & Complication Readiness",
                    "description": "Creating birth plans with families and recognizing obstetric emergencies.",
                    "module": "Module 1.3", "minutes": 9, "video_url": MP4_A,
                    "gradient": "from-pink-500 to-fuchsia-500",
                    "quiz": [
                        {"text": "A birth preparedness plan should include...",
                         "options": [("A", "Identified facility, transport and money arrangements", True),
                                     ("B", "Only the baby's name", False),
                                     ("C", "Just a list of relatives", False),
                                     ("D", "Nothing until labour starts", False)]},
                        {"text": "Heavy vaginal bleeding during pregnancy is...",
                         "options": [("A", "Normal in the last month", False),
                                     ("B", "An emergency needing immediate facility referral", True),
                                     ("C", "Treated with rest only", False),
                                     ("D", "A sign of twins", False)]},
                        {"text": "Institutional delivery is recommended because...",
                         "options": [("A", "It is legally required everywhere", False),
                                     ("B", "Skilled staff and emergency care are available", True),
                                     ("C", "It is always free of cost", False),
                                     ("D", "Home births are never safe", False)]},
                    ],
                },
            ],
        },
        "formative": {
            "stage_title": "Phase 2: Formative Test",
            "stage_description": "A scheduled assessment on the Phase 1 basic videos. Complete all Phase 1 videos to be eligible.",
            "title": "Formative Test: Maternal Health",
            "description": "Covers ANC protocols, IFA supplementation and birth preparedness from Phase 1.",
            "minutes": 15,
            "questions": [
                {"text": "How many antenatal care visits are recommended as a minimum during pregnancy?",
                 "options": [("A", "2 visits", False), ("B", "4 visits", True),
                             ("C", "6 visits", False), ("D", "Only 1 at the time of delivery", False)]},
                {"text": "Which is a danger sign during pregnancy that requires immediate medical referral?",
                 "options": [("A", "Mild nausea in the first trimester", False),
                             ("B", "Severe headache with blurred vision", True),
                             ("C", "Occasional fatigue", False), ("D", "Increased appetite", False)]},
                {"text": "IFA supplementation during pregnancy prevents...",
                 "options": [("A", "Maternal anaemia", True), ("B", "Twins", False),
                             ("C", "Morning sickness", False), ("D", "Fever", False)]},
                {"text": "A complete birth preparedness plan identifies...",
                 "options": [("A", "Facility, transport and emergency funds in advance", True),
                             ("B", "Only the delivery date", False),
                             ("C", "The baby's horoscope", False), ("D", "Nothing specific", False)]},
            ],
        },
        "phase3": {
            "title": "Phase 3: Add-on Videos",
            "description": "Immunization schedules, cold chain and IYCF. Watch after passing the Formative Test (you may preview earlier). Completing all videos makes you eligible for the Screening Test.",
            "tutorials": [
                {
                    "title": "National Immunization Schedule",
                    "description": "Complete vaccine schedule from birth to 16 years with catch-up doses.",
                    "module": "Module 2.1", "minutes": 10,
                    "youtube_url": YT_DEMO, "start_seconds": 0, "end_seconds": 75,
                    "gradient": "from-blue-500 to-indigo-500",
                    "quiz": [
                        {"text": "At what age should the first dose of Measles vaccine be given?",
                         "options": [("A", "At birth", False), ("B", "6 weeks", False),
                                     ("C", "9 months", True), ("D", "12 months", False)]},
                        {"text": "BCG vaccine is ideally given...",
                         "options": [("A", "At birth", True), ("B", "At 6 months", False),
                                     ("C", "At 5 years", False), ("D", "Only during outbreaks", False)]},
                        {"text": "A child who missed scheduled doses should...",
                         "options": [("A", "Never be vaccinated again", False),
                                     ("B", "Receive catch-up doses as per schedule", True),
                                     ("C", "Restart the entire schedule from birth doses", False),
                                     ("D", "Wait until adulthood", False)]},
                    ],
                },
                {
                    "title": "Cold Chain Management",
                    "description": "Proper storage, transport, and monitoring of vaccine temperatures.",
                    "module": "Module 2.2", "minutes": 8, "video_url": MP4_A,
                    "gradient": "from-indigo-500 to-purple-500",
                    "quiz": [
                        {"text": "The ideal storage temperature for most vaccines is...",
                         "options": [("A", "-20°C to 0°C", False), ("B", "+2°C to +8°C", True),
                                     ("C", "+10°C to +25°C", False), ("D", "Room temperature", False)]},
                        {"text": "Vaccine carriers with conditioned ice packs are used to...",
                         "options": [("A", "Maintain safe temperature during transport", True),
                                     ("B", "Make vaccines stronger", False),
                                     ("C", "Freeze all vaccines solid", False),
                                     ("D", "Save electricity only", False)]},
                        {"text": "A freeze-sensitive vaccine exposed to freezing should be...",
                         "options": [("A", "Used immediately", False),
                                     ("B", "Discarded per protocol after shake test/guidance", True),
                                     ("C", "Thawed and refrozen", False),
                                     ("D", "Mixed with fresh stock", False)]},
                    ],
                },
                {
                    "title": "Exclusive Breastfeeding Promotion",
                    "description": "Counseling techniques to support exclusive breastfeeding for the first 6 months.",
                    "module": "Module 2.3", "minutes": 11, "video_url": MP4_B,
                    "gradient": "from-emerald-500 to-green-500",
                    "quiz": [
                        {"text": "For how many months should a baby be exclusively breastfed?",
                         "options": [("A", "3", False), ("B", "6", True), ("C", "9", False), ("D", "12", False)]},
                        {"text": "Exclusive breastfeeding means the baby receives...",
                         "options": [("A", "Breastmilk plus water", False),
                                     ("B", "Only breastmilk (plus prescribed medicines)", True),
                                     ("C", "Breastmilk plus honey", False),
                                     ("D", "Formula at night", False)]},
                        {"text": "'Responsive feeding' means...",
                         "options": [("A", "Force-feeding until the plate is empty", False),
                                     ("B", "Feeding patiently based on hunger and satiety cues", True),
                                     ("C", "Feeding only when the child cries", False),
                                     ("D", "Letting the child eat anything", False)]},
                    ],
                },
            ],
        },
        "screening": {
            "stage_title": "Phase 4: Screening Test",
            "stage_description": "The final scheduled screening. Complete all Phase 3 add-on videos to be eligible. Revise earlier videos while you wait.",
            "title": "Screening Test: Immunization & IYCF",
            "description": "Covers vaccine schedules, cold chain and infant feeding from the add-on videos.",
            "minutes": 20,
            "questions": [
                {"text": "At what age should the first dose of Measles vaccine be given?",
                 "options": [("A", "At birth", False), ("B", "6 weeks", False),
                             ("C", "9 months", True), ("D", "12 months", False)]},
                {"text": "What is the ideal temperature range for storing most vaccines?",
                 "options": [("A", "-20°C to 0°C", False), ("B", "+2°C to +8°C", True),
                             ("C", "+10°C to +25°C", False), ("D", "Room temperature is fine", False)]},
                {"text": "For how many months should a baby be exclusively breastfed?",
                 "options": [("A", "3 months", False), ("B", "6 months", True),
                             ("C", "9 months", False), ("D", "12 months", False)]},
                {"text": "What does 'responsive feeding' mean?",
                 "options": [("A", "Force-feeding the child to finish all food", False),
                             ("B", "Feeding only when the child cries", False),
                             ("C", "Paying attention to hunger and satiety cues and feeding patiently", True),
                             ("D", "Letting the child eat whatever they want", False)]},
            ],
        },
    },

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # MEGHALAYA — Tribal Health focus
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    "meghalaya": {
        "phase1": {
            "title": "Phase 1: Basic Videos",
            "description": "Health challenges in hill communities and culturally sensitive practice. Complete all videos to become eligible for the Formative Test.",
            "tutorials": [
                {
                    "title": "Health Challenges in Hill Communities",
                    "description": "Common health issues in hilly tribal regions: malaria, respiratory infections, and malnutrition.",
                    "module": "Module 1.1", "minutes": 8, "video_url": MP4_A,
                    "gradient": "from-emerald-600 to-green-500",
                    "quiz": [
                        {"text": "Which disease is most prevalent in forested tribal regions of Northeast India?",
                         "options": [("A", "Diabetes Type 2", False), ("B", "Malaria", True),
                                     ("C", "Heart disease", False), ("D", "Osteoporosis", False)]},
                        {"text": "A key barrier to healthcare in remote hill villages is...",
                         "options": [("A", "Distance and difficult terrain to facilities", True),
                                     ("B", "Too many hospitals", False),
                                     ("C", "Excess doctors", False),
                                     ("D", "Free transport everywhere", False)]},
                        {"text": "Indoor cooking smoke in poorly ventilated homes increases the risk of...",
                         "options": [("A", "Respiratory infections", True), ("B", "Fractures", False),
                                     ("C", "Snake bites", False), ("D", "Sunburn", False)]},
                    ],
                },
                {
                    "title": "Bridging Traditional & Modern Health Practices",
                    "description": "Respectfully integrating traditional healing with evidence-based healthcare.",
                    "module": "Module 1.2", "minutes": 10, "video_url": MP4_B,
                    "gradient": "from-green-500 to-lime-500",
                    "quiz": [
                        {"text": "When a family uses traditional healing for a sick child, the best approach is to...",
                         "options": [("A", "Insist they stop immediately", False),
                                     ("B", "Respectfully discuss while introducing evidence-based care alongside", True),
                                     ("C", "Report them to authorities", False),
                                     ("D", "Ignore the situation", False)]},
                        {"text": "Working with traditional healers can help because they...",
                         "options": [("A", "Hold community trust and can support referrals", True),
                                     ("B", "Can prescribe antibiotics", False),
                                     ("C", "Replace health workers", False),
                                     ("D", "Are government employees", False)]},
                        {"text": "Cultural sensitivity in health work means...",
                         "options": [("A", "Dismissing local beliefs", False),
                                     ("B", "Understanding and respecting local customs while ensuring safe care", True),
                                     ("C", "Only speaking English", False),
                                     ("D", "Avoiding villages with strong traditions", False)]},
                    ],
                },
            ],
        },
        "formative": {
            "stage_title": "Phase 2: Formative Test",
            "stage_description": "A scheduled assessment on the Phase 1 basic videos. Complete all Phase 1 videos to be eligible.",
            "title": "Formative Test: Tribal Health Basics",
            "description": "Covers hill-community health challenges and culturally sensitive practice from Phase 1.",
            "minutes": 15,
            "questions": [
                {"text": "Which disease is most prevalent in forested tribal regions of Northeast India?",
                 "options": [("A", "Diabetes Type 2", False), ("B", "Malaria", True),
                             ("C", "Heart disease", False), ("D", "Osteoporosis", False)]},
                {"text": "What is the best approach when a community uses traditional healing for a sick child?",
                 "options": [("A", "Insist they stop immediately and only use modern medicine", False),
                             ("B", "Respectfully discuss while introducing evidence-based treatments alongside", True),
                             ("C", "Report the family to authorities", False),
                             ("D", "Ignore the situation entirely", False)]},
                {"text": "A major access barrier to healthcare in hill regions is...",
                 "options": [("A", "Difficult terrain and distance to facilities", True),
                             ("B", "Too many clinics", False),
                             ("C", "Lack of mobile phones only", False),
                             ("D", "None — access is easy", False)]},
                {"text": "Indoor cooking smoke mainly increases the risk of...",
                 "options": [("A", "Respiratory infections", True), ("B", "Malaria", False),
                             ("C", "Fractures", False), ("D", "Tooth decay", False)]},
            ],
        },
        "phase3": {
            "title": "Phase 3: Add-on Videos",
            "description": "Nutrition strategies and outreach for remote areas. Watch after passing the Formative Test (you may preview earlier). Completing all videos makes you eligible for the Screening Test.",
            "tutorials": [
                {
                    "title": "Locally Available Nutritious Foods",
                    "description": "Identifying indigenous foods rich in micro-nutrients: bamboo shoots, local greens, river fish.",
                    "module": "Module 2.1", "minutes": 7,
                    "youtube_url": YT_DEMO, "start_seconds": 5, "end_seconds": 80,
                    "gradient": "from-amber-500 to-yellow-500",
                    "quiz": [
                        {"text": "Which locally available food in Meghalaya is rich in protein and iron?",
                         "options": [("A", "White rice only", False),
                                     ("B", "Local river fish and green leafy vegetables", True),
                                     ("C", "Refined sugar", False),
                                     ("D", "Packaged instant noodles", False)]},
                        {"text": "Promoting local foods over packaged foods helps because they are...",
                         "options": [("A", "Cheaper, fresher and more nutritious", True),
                                     ("B", "Always sterile", False),
                                     ("C", "Branded", False),
                                     ("D", "Imported", False)]},
                        {"text": "Dietary diversity for young children means...",
                         "options": [("A", "Feeding from several food groups daily", True),
                                     ("B", "Only rice every day", False),
                                     ("C", "Only milk after age 2", False),
                                     ("D", "Skipping vegetables", False)]},
                    ],
                },
                {
                    "title": "ICDS Supplementary Nutrition Program",
                    "description": "Distributing Take-Home Rations (THR) and conducting nutrition counseling sessions.",
                    "module": "Module 2.2", "minutes": 9, "video_url": MP4_B,
                    "gradient": "from-yellow-500 to-orange-500",
                    "quiz": [
                        {"text": "What is THR in the context of ICDS?",
                         "options": [("A", "Total Health Report", False), ("B", "Take-Home Ration", True),
                                     ("C", "Training Health Resources", False),
                                     ("D", "Therapeutic Hospital Referral", False)]},
                        {"text": "THR is primarily meant for...",
                         "options": [("A", "Pregnant/lactating mothers and young children", True),
                                     ("B", "Only school teachers", False),
                                     ("C", "Village leaders", False),
                                     ("D", "Anyone who asks", False)]},
                        {"text": "Nutrition counselling sessions work best when they...",
                         "options": [("A", "Use local foods and simple demonstrations", True),
                                     ("B", "Use only technical jargon", False),
                                     ("C", "Are held once every five years", False),
                                     ("D", "Exclude mothers-in-law", False)]},
                    ],
                },
                {
                    "title": "Planning Mobile Health Camps",
                    "description": "Logistics, supply planning, and coordination for health camps in remote villages.",
                    "module": "Module 2.3", "minutes": 10, "video_url": MP4_A,
                    "gradient": "from-violet-500 to-purple-500",
                    "quiz": [
                        {"text": "Who should be engaged first when planning a health camp in a tribal village?",
                         "options": [("A", "The nearest city hospital director", False),
                                     ("B", "The village headman or community leader", True),
                                     ("C", "The state governor", False),
                                     ("D", "No one — just arrive", False)]},
                        {"text": "Mobile health camps are especially useful because they...",
                         "options": [("A", "Bring services closer to remote, underserved villages", True),
                                     ("B", "Replace all hospitals", False),
                                     ("C", "Are cheaper than doing nothing", False),
                                     ("D", "Only distribute pamphlets", False)]},
                        {"text": "Self-Help Groups (SHGs) help health promotion because they...",
                         "options": [("A", "Have community trust and spread messages effectively", True),
                                     ("B", "Provide funding for medicines", False),
                                     ("C", "Replace trained health workers", False),
                                     ("D", "Have medical training", False)]},
                    ],
                },
            ],
        },
        "screening": {
            "stage_title": "Phase 4: Screening Test",
            "stage_description": "The final scheduled screening. Complete all Phase 3 add-on videos to be eligible. Revise earlier videos while you wait.",
            "title": "Screening Test: Nutrition & Outreach",
            "description": "Covers local nutrition strategies, ICDS programs and community outreach from the add-on videos.",
            "minutes": 20,
            "questions": [
                {"text": "Which locally available food in Meghalaya is rich in protein and iron?",
                 "options": [("A", "White rice only", False),
                             ("B", "Local river fish and green leafy vegetables", True),
                             ("C", "Refined sugar", False), ("D", "Packaged instant noodles", False)]},
                {"text": "What is THR in the context of ICDS?",
                 "options": [("A", "Total Health Report", False), ("B", "Take-Home Ration", True),
                             ("C", "Training Health Resources", False), ("D", "Therapeutic Hospital Referral", False)]},
                {"text": "Who is the most important stakeholder to engage first when planning a health camp in a tribal village?",
                 "options": [("A", "The nearest city hospital director", False),
                             ("B", "The village headman or community leader", True),
                             ("C", "The state governor", False), ("D", "No one — just arrive and set up", False)]},
                {"text": "What is the key advantage of working with Self-Help Groups (SHGs) for health promotion?",
                 "options": [("A", "They provide funding for medicines", False),
                             ("B", "They have established trust within the community and can spread health messages effectively", True),
                             ("C", "They replace the need for trained health workers", False),
                             ("D", "They have medical training", False)]},
            ],
        },
    },
}


# ═══════════════════════════════════════════════
# Learner Registration — professional-axis reference data
# (from the EP HST "LR notes" sheet). Powers the cascading dropdowns:
# Department → Designation → Facility type, and Department → Education.
# ═══════════════════════════════════════════════

def _seed_professional_axis(db: Session):
    """Seed departments, designations, facility types (+ designation→facility-type
    mapping) and the department-scoped educational qualification lists. Runs once,
    guarded by an empty departments table. Deliberately REPLACES any pre-existing
    generic educational_qualifications with the LR dept-scoped lists (per spec)."""
    if db.query(Department).count() > 0:
        return
    print("Seeding professional-axis master data (departments, designations, facility types, education)...")

    # ── Departments ──
    hfw = Department(code="HFW", name="Health & Family Welfare Department (HFW)", order_index=0)
    wcd = Department(code="WCD", name="Women & Child Development Department (WCD)", order_index=1)
    other_dept = Department(code="OTHER", name="Other", order_index=2)
    db.add_all([hfw, wcd, other_dept])
    db.commit()

    # ── Facility types (ordered by frequency); keyed by a short alias for mapping ──
    ft_specs = [
        ("Anganwadi Centre (AWC)", "AWC"),
        ("Sub-centre (SC)", "SC"),
        ("Health & Wellness Centre (HWC)", "HWC"),
        ("Primary Health Centre (PHC)", "PHC"),
        ("Community Health Centre (CHC)", "CHC"),
        ("Taluk Hospital (TH)", "TH"),
        ("District Hospital (DH)", "DH"),
        ("Medical College Hospital", "MCH"),
        ("ICDS Project Office (CDPO Office)", "ICDS_PO"),
        ("Taluk Health Office (THO)", "THO"),
        ("District Health Office (DHO)", "DHO"),
        ("District ICDS Office", "DICDS"),
        ("Other (Specify)", "OTHER"),
    ]
    ft = {}
    for i, (name, alias) in enumerate(ft_specs):
        obj = FacilityType(name=name, order_index=i, is_other=(alias == "OTHER"))
        db.add(obj)
        ft[alias] = obj
    db.commit()

    # ── Designations (name, [facility-type aliases]) ordered by frequency. An empty
    #    list means the sheet gives no posting mapping → UI falls back to all types. ──
    hfw_desigs = [
        ("ASHA", ["SC"]),
        ("ANM", ["SC", "HWC"]),
        ("CHO (Community Health Officer)", ["HWC"]),
        ("Staff Nurse", ["PHC", "CHC", "TH", "DH"]),
        ("ASHA Facilitator", ["PHC"]),
        ("MLHP (Mid-Level Health Provider)", ["HWC"]),
        ("MPHW (Male)", ["SC", "HWC"]),
        ("Health Assistant (Female)", ["PHC"]),
        ("Health Assistant (Male)", ["PHC"]),
        ("Health Inspector", ["PHC", "THO"]),
        ("Lab Technician", ["PHC", "CHC", "TH", "DH"]),
        ("Pharmacist", ["PHC", "CHC", "TH", "DH"]),
        ("Medical Officer", ["PHC", "CHC", "TH", "DH"]),
        ("Specialist Medical Officer", ["DH", "MCH"]),
        ("Block Health Education Officer", []),
        ("Taluk Health Officer", ["THO"]),
        ("District Health Officer", ["DHO"]),
        ("District Epidemiologist", ["DHO"]),
        ("District Surveillance Officer", ["DHO"]),
        ("Programme Manager", ["DHO"]),
        ("Data Entry Operator", ["PHC", "THO", "DHO"]),
        ("Nutrition Counsellor", ["PHC", "DH", "DICDS"]),
        ("Counsellor", []),
        ("Physiotherapist", []),
        ("Other (Specify)", []),
    ]
    wcd_desigs = [
        ("Anganwadi Worker (AWW)", ["AWC"]),
        ("Lady Supervisor", ["ICDS_PO"]),
        ("Child Development Project Officer (CDPO)", ["ICDS_PO"]),
        ("District Programme Officer", ["DICDS"]),
        ("Poshan Coordinator", ["DICDS", "ICDS_PO"]),
        ("Nutrition Counsellor", ["PHC", "DH", "DICDS"]),
        ("Other (Specify)", []),
    ]
    for dept, desigs in ((hfw, hfw_desigs), (wcd, wcd_desigs)):
        for i, (name, aliases) in enumerate(desigs):
            d = Designation(
                department_id=dept.id, name=name, order_index=i,
                is_other=name.startswith("Other"),
            )
            d.facility_types = [ft[a] for a in aliases]
            db.add(d)
    db.commit()

    # ── Department-scoped education: REPLACE the generic list with the LR lists ──
    db.query(EducationalQualification).delete()
    db.commit()
    hfw_edu = [
        "No formal education", "Primary (I–IV)", "Upper Primary (V–VII)", "High School (VIII–X)",
        "PUC (XI–XII)", "ANM", "GNM", "B.Sc. Nursing", "Post Basic B.Sc. Nursing", "M.Sc. Nursing",
        "MBBS", "BAMS", "BHMS", "BDS", "BPT", "B.Pharm", "M.Pharm", "MPH", "MD/MS", "Diploma",
        "Graduate", "Postgraduate", "PhD", "Other",
    ]
    wcd_edu = [
        "No formal education", "Primary (I–IV)", "Upper Primary (V–VII)", "High School (VIII–X)",
        "PUC (XI–XII)", "Anganwadi Training Certificate", "Diploma", "Graduate", "Postgraduate",
        "BSW", "MSW", "Nutrition/Home Science", "Other",
    ]
    for dept, names in ((hfw, hfw_edu), (wcd, wcd_edu)):
        for i, name in enumerate(names):
            db.add(EducationalQualification(
                qualification_name=name, department_id=dept.id, order_index=i,
                has_semi_open_input=(name == "Other"),
            ))
    db.commit()
    print("Professional-axis master data seeded.")


# ═══════════════════════════════════════════════
# Mother Registration — education cascade reference data
# (from the EP HST "MR" + "MR notes" sheets). Education level → field → degree.
# HWC/PHC and Karnataka geography rows are uploaded separately, not seeded here.
# ═══════════════════════════════════════════════

_MR_EDUCATION_LEVELS = [
    ("Illiterate", False), ("No formal education", False), ("Lower Primary (I–IV)", False),
    ("Higher Primary (V–VII)", False), ("High School (VIII–X)", False), ("PUC (XI–XII)", False),
    ("Diploma", True), ("Graduate", True), ("Postgraduate", True),
]

# field name -> ordered degree list
_MR_DEGREES = {
    "Health Sciences": [
        "Auxiliary Nurse Midwife (ANM)", "General Nursing and Midwifery (GNM)",
        "Diploma in Pharmacy (D.Pharm)", "Diploma in Medical Laboratory Technology (DMLT)",
        "Diploma in Nutrition and Dietetics", "Diploma in Public Health (DPH)",
        "Bachelor of Medicine and Bachelor of Surgery (MBBS)", "Bachelor of Science in Nursing (B.Sc. Nursing)",
        "Post Basic Bachelor of Science in Nursing (Post Basic B.Sc. Nursing)", "Bachelor of Dental Surgery (BDS)",
        "Bachelor of Ayurvedic Medicine and Surgery (BAMS)", "Bachelor of Homeopathic Medicine and Surgery (BHMS)",
        "Bachelor of Physiotherapy (BPT)", "Bachelor of Pharmacy (B.Pharm)",
        "Bachelor of Science in Nutrition and Dietetics (B.Sc. Nutrition)",
        "Bachelor of Science in Home Science (B.Sc. Home Science)",
        "Bachelor of Science in Medical Laboratory Technology (B.Sc. MLT)", "Bachelor of Public Health (BPH)",
        "Bachelor of Occupational Therapy (BOT)", "Bachelor of Optometry (B.Optom)",
        "Doctor of Medicine (MD)", "Master of Surgery (MS)", "Master of Science in Nursing (M.Sc. Nursing)",
        "Master of Public Health (MPH)", "Master of Science in Nutrition and Dietetics (M.Sc. Nutrition)",
        "Master of Pharmacy (M.Pharm)", "Master of Dental Surgery (MDS)", "Master of Physiotherapy (MPT)",
        "Master of Hospital Administration (MHA)", "Master of Occupational Therapy (MOT)",
        "Doctor of Philosophy (PhD)", "Other",
    ],
    "Engineering & Technology": [
        "Diploma in Engineering", "Bachelor of Engineering (BE)", "Bachelor of Technology (B.Tech)",
        "Master of Engineering (ME)", "Master of Technology (M.Tech)", "Other",
    ],
    "Science": ["Bachelor of Science (B.Sc.)", "Master of Science (M.Sc.)", "Other"],
    "Arts, Commerce & Humanities": [
        "Bachelor of Arts (BA)", "Bachelor of Commerce (B.Com.)", "Master of Arts (MA)",
        "Master of Commerce (M.Com.)", "Bachelor of Social Work (BSW)", "Master of Social Work (MSW)", "Other",
    ],
    "Management": ["Bachelor of Business Administration (BBA)", "Master of Business Administration (MBA)", "Other"],
    "Law": ["Bachelor of Laws (LLB)", "Master of Laws (LLM)", "Other"],
    "Agriculture": [
        "Bachelor of Science in Agriculture (B.Sc. Agriculture)", "Master of Science in Agriculture (M.Sc. Agriculture)",
        "Bachelor of Veterinary Science and Animal Husbandry (BVSc & AH)", "Master of Veterinary Science (MVSc)", "Other",
    ],
    "Education (Teaching)": [
        "Diploma in Education (D.Ed.)", "Bachelor of Education (B.Ed.)", "Master of Education (M.Ed.)", "Other",
    ],
    "Computer Science & Information Technology": [
        "Bachelor of Computer Applications (BCA)", "Master of Computer Applications (MCA)",
        "Bachelor of Computer Science (B.Sc. Computer Science)", "Master of Computer Science (M.Sc. Computer Science)", "Other",
    ],
    "Other": ["Other"],
}


def _seed_mother_reference(db: Session):
    """Seed mother education levels + the education field → degree cascade. Runs once,
    guarded by an empty mother_education_levels table."""
    if db.query(MotherEducationLevel).count() > 0:
        return
    print("Seeding mother-registration education reference data...")

    for i, (name, requires_field) in enumerate(_MR_EDUCATION_LEVELS):
        db.add(MotherEducationLevel(name=name, order_index=i, requires_field=requires_field))

    for fi, (field_name, degrees) in enumerate(_MR_DEGREES.items()):
        field = EducationField(name=field_name, order_index=fi)
        db.add(field)
        db.flush()  # need field.id for degrees
        for di, deg in enumerate(degrees):
            db.add(EducationDegree(field_id=field.id, name=deg, order_index=di))
    db.commit()
    print("Mother-registration education reference data seeded.")
