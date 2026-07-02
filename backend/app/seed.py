from sqlalchemy.orm import Session
from app.models import (
    Stage, Tutorial, Test, Question, QuestionOption, Achievement,
    State, District, Block, Village, Facility, EducationalQualification, ExperienceRange,
    ProgramDistrict, User,
)


def seed_database(db: Session):
    # ─── Seed metadata tables (locations, qualifications, experience) ───
    if db.query(State).count() == 0:
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
        kalyanpur = Village(block_id=bhathat.id, name="Kalyanpur")
        bhathat_khas = Village(block_id=bhathat.id, name="Bhathat Khas")
        pipraich_v = Village(block_id=pipraich.id, name="Pipraich Village")
        m_village1 = Village(block_id=malihabad.id, name="Malihabad Khas")
        m_village2 = Village(block_id=malihabad.id, name="Kasmandi Kalan")
        p_village1 = Village(block_id=patnasad.id, name="Sadikpur")
        p_village2 = Village(block_id=patnasad.id, name="Danapur")
        db.add_all([kalyanpur, bhathat_khas, pipraich_v, m_village1, m_village2, p_village1, p_village2])
        db.commit()

        # 5. Facilities
        awc1 = Facility(block_id=bhathat.id, name="Kalyanpur AWC", facility_type="Anganwadi Center (AWC)")
        phc1 = Facility(block_id=bhathat.id, name="Bhathat PHC", facility_type="Primary Health Center (PHC)")
        awc2 = Facility(block_id=pipraich.id, name="Pipraich AWC 1", facility_type="Anganwadi Center (AWC)")
        m_awc = Facility(block_id=malihabad.id, name="Malihabad AWC 1", facility_type="Anganwadi Center (AWC)")
        m_chc = Facility(block_id=malihabad.id, name="Malihabad CHC", facility_type="Primary Health Center (PHC)")
        p_awc = Facility(block_id=patnasad.id, name="Patna Sadar AWC 1", facility_type="Anganwadi Center (AWC)")
        p_phc = Facility(block_id=patnasad.id, name="Patna Sadar PHC", facility_type="Primary Health Center (PHC)")
        db.add_all([awc1, phc1, awc2, m_awc, m_chc, p_awc, p_phc])
        db.commit()

        # 6. Educational Qualifications
        q_hs = EducationalQualification(qualification_name="High School (10th)", has_semi_open_input=False)
        q_ssc = EducationalQualification(qualification_name="Higher Secondary (12th)", has_semi_open_input=False)
        q_grad = EducationalQualification(qualification_name="Graduate (BA/BSc/BCom/etc)", has_semi_open_input=False)
        q_pg = EducationalQualification(qualification_name="Post Graduate (MA/MSc/MCom/etc)", has_semi_open_input=False)
        q_other = EducationalQualification(qualification_name="Other (Please specify)", has_semi_open_input=True)
        db.add_all([q_hs, q_ssc, q_grad, q_pg, q_other])
        db.commit()

        # 7. Experience Ranges
        exp1 = ExperienceRange(label="Under 1 year", order_index=0)
        exp2 = ExperienceRange(label="1 - 3 years", order_index=1)
        exp3 = ExperienceRange(label="3 - 5 years", order_index=2)
        exp4 = ExperienceRange(label="5 - 10 years", order_index=3)
        exp5 = ExperienceRange(label="10+ years", order_index=4)
        db.add_all([exp1, exp2, exp3, exp4, exp5])
        db.commit()

    # ─── Seed Program Districts ───
    if db.query(ProgramDistrict).count() == 0:
        print("Seeding program districts...")
        pd_jalna = ProgramDistrict(name="Jalna", slug="jalna", is_active=True)
        pd_ujjain = ProgramDistrict(name="Ujjain", slug="ujjain", is_active=True)
        pd_meghalaya = ProgramDistrict(name="Meghalaya", slug="meghalaya", is_active=True)
        db.add_all([pd_jalna, pd_ujjain, pd_meghalaya])
        db.commit()

        # Seed the requested users and assign them
        from app.auth import get_password_hash
        pwd_hash = get_password_hash("password123")

        u_meghalaya = User(
            email="ayushman2412@gmail.com",
            password_hash=pwd_hash,
            full_name="Ayushman Meghalaya",
            is_verified=True,
            program_district_id=pd_meghalaya.id,
            avatar_initials="AM"
        )
        u_ujjain = User(
            email="aayushman@edupyramids.org",
            password_hash=pwd_hash,
            full_name="Aayushman Ujjain",
            is_verified=True,
            program_district_id=pd_ujjain.id,
            avatar_initials="AU"
        )
        admin_user = User(
            email="admin@nurturehub.org",
            password_hash=pwd_hash,
            full_name="NurtureHUB Admin",
            is_verified=True,
            is_admin=True,
            avatar_initials="AD"
        )
        db.add_all([u_meghalaya, u_ujjain, admin_user])
        db.commit()

    # ─── Check if stages already seeded ───
    if db.query(Stage).count() > 0:
        print("Database already contains stage data, skipping seeding.")
        return

    print("Seeding stages, tutorials, tests per district...")

    # Fetch program districts
    pd_jalna = db.query(ProgramDistrict).filter(ProgramDistrict.slug == "jalna").first()
    pd_ujjain = db.query(ProgramDistrict).filter(ProgramDistrict.slug == "ujjain").first()
    pd_meghalaya = db.query(ProgramDistrict).filter(ProgramDistrict.slug == "meghalaya").first()

    # ─── Achievements (shared) ───
    ach1 = Achievement(title="Fast Learner", description="Completed your first tutorial video", emoji_icon="⚡")
    ach2 = Achievement(title="Scholar", description="Scored 100% on any assessment", emoji_icon="🎓")
    ach3 = Achievement(title="Graduate", description="Passed all 3 stages of training", emoji_icon="🏆")
    db.add_all([ach1, ach2, ach3])
    db.commit()

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # JALNA — ICDS Foundation focus
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    _seed_jalna(db, pd_jalna.id)

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # UJJAIN — Maternal & Immunization focus
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    _seed_ujjain(db, pd_ujjain.id)

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # MEGHALAYA — Tribal Health focus
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    _seed_meghalaya(db, pd_meghalaya.id)

    print("Database seeding completed successfully.")


# ═══════════════════════════════════════════════
# Per-District Seed Helpers
# ═══════════════════════════════════════════════

def _seed_jalna(db: Session, district_id: int):
    """Seed ICDS Foundation content for Jalna district."""
    # Stage 1
    s1 = Stage(program_district_id=district_id, title="Foundation Skills for ICDS Workers", description="Master the core concepts of child growth monitoring, immunization, and community counseling.", order_index=0)
    db.add(s1)
    db.commit()

    t1 = Tutorial(stage_id=s1.id, title="Introduction to Child Development Tracker", description="Learn how to record developmental milestones and identify growth faltering early.", module_number="Module 1.1", duration_minutes=5, video_url="https://www.w3schools.com/html/mov_bbb.mp4", gradient_colors="from-teal-500 to-cyan-500", order_index=0)
    t2 = Tutorial(stage_id=s1.id, title="Nutrition & Growth Standards", description="Understand the WHO growth standards, weight-for-age charts, and checking for stunting/wasting.", module_number="Module 1.2", duration_minutes=8, video_url="https://www.w3schools.com/html/movie.mp4", gradient_colors="from-emerald-500 to-teal-500", order_index=1)
    t3 = Tutorial(stage_id=s1.id, title="Early Stimulation Play Practices", description="Guide parents on simple home activities that boost cognitive development in children under 3.", module_number="Module 1.3", duration_minutes=6, video_url="https://www.w3schools.com/html/mov_bbb.mp4", gradient_colors="from-cyan-500 to-blue-500", order_index=2)
    db.add_all([t1, t2, t3])
    db.commit()

    test1 = Test(stage_id=s1.id, title="Stage 1 Assessment: Foundations", description="Test your understanding of child growth monitoring, WHO charts, and early milestones.", total_questions=3, duration_minutes=10, passing_score_pct=70, max_attempts=3)
    db.add(test1)
    db.commit()

    q1_1 = Question(test_id=test1.id, text="What is the primary indicator used to assess acute growth faltering (wasting) in WHO charts?", marks=2, order_index=0)
    db.add(q1_1); db.commit()
    db.add_all([
        QuestionOption(question_id=q1_1.id, label="A", text="Weight-for-height (or length)", is_correct=True),
        QuestionOption(question_id=q1_1.id, label="B", text="Height-for-age", is_correct=False),
        QuestionOption(question_id=q1_1.id, label="C", text="Head circumference-for-age", is_correct=False),
        QuestionOption(question_id=q1_1.id, label="D", text="Mid-upper arm circumference (MUAC) only", is_correct=False),
    ])
    q1_2 = Question(test_id=test1.id, text="At what age should complementary feeding start alongside continued breastfeeding?", marks=2, order_index=1)
    db.add(q1_2); db.commit()
    db.add_all([
        QuestionOption(question_id=q1_2.id, label="A", text="At 3 months", is_correct=False),
        QuestionOption(question_id=q1_2.id, label="B", text="At 6 months", is_correct=True),
        QuestionOption(question_id=q1_2.id, label="C", text="At 12 months", is_correct=False),
        QuestionOption(question_id=q1_2.id, label="D", text="When the child gets their first tooth", is_correct=False),
    ])
    q1_3 = Question(test_id=test1.id, text="Which developmental milestone is typically expected of a child by 12 months of age?", marks=2, order_index=2)
    db.add(q1_3); db.commit()
    db.add_all([
        QuestionOption(question_id=q1_3.id, label="A", text="Running steadily without falling", is_correct=False),
        QuestionOption(question_id=q1_3.id, label="B", text="Standing alone and potentially taking first steps", is_correct=True),
        QuestionOption(question_id=q1_3.id, label="C", text="Speaking full complex sentences", is_correct=False),
        QuestionOption(question_id=q1_3.id, label="D", text="Drawing clear geometrical shapes", is_correct=False),
    ])
    db.commit()

    # Stage 2
    s2 = Stage(program_district_id=district_id, title="Advanced Nutritional Interventions", description="Handle micro-nutrient deficiency, SAM, MAM, and coordinate medical referrals.", order_index=1)
    db.add(s2); db.commit()

    t4 = Tutorial(stage_id=s2.id, title="Micro-Nutrient Supplements Guide", description="Proper dosing schedules for Vitamin A, Iron-Folic Acid (IFA), and Zinc supplements.", module_number="Module 2.1", duration_minutes=10, video_url="https://www.w3schools.com/html/movie.mp4", gradient_colors="from-amber-500 to-orange-500", order_index=0)
    t5 = Tutorial(stage_id=s2.id, title="Severe Acute Malnutrition Management", description="How to perform appetite tests, use Ready-to-Use Therapeutic Food (RUTF), and criteria for referral.", module_number="Module 2.2", duration_minutes=12, video_url="https://www.w3schools.com/html/mov_bbb.mp4", gradient_colors="from-rose-500 to-pink-500", order_index=1)
    db.add_all([t4, t5]); db.commit()

    test2 = Test(stage_id=s2.id, title="Stage 2 Assessment: Advanced Nutrition", description="Test your knowledge on supplementation schedules, SAM referral protocols, and RUTF usage.", total_questions=2, duration_minutes=8, passing_score_pct=70, max_attempts=3)
    db.add(test2); db.commit()

    q2_1 = Question(test_id=test2.id, text="What is the MUAC threshold for classifying a child (6-59 months) as having Severe Acute Malnutrition (SAM)?", marks=2, order_index=0)
    db.add(q2_1); db.commit()
    db.add_all([
        QuestionOption(question_id=q2_1.id, label="A", text="Less than 11.5 cm (115 mm)", is_correct=True),
        QuestionOption(question_id=q2_1.id, label="B", text="Between 11.5 and 12.5 cm", is_correct=False),
        QuestionOption(question_id=q2_1.id, label="C", text="Less than 13.5 cm", is_correct=False),
        QuestionOption(question_id=q2_1.id, label="D", text="Only depends on the child's weight status", is_correct=False),
    ])
    q2_2 = Question(test_id=test2.id, text="How often should Vitamin A supplements be administered to children aged 12-59 months?", marks=2, order_index=1)
    db.add(q2_2); db.commit()
    db.add_all([
        QuestionOption(question_id=q2_2.id, label="A", text="Every month", is_correct=False),
        QuestionOption(question_id=q2_2.id, label="B", text="Every 6 months", is_correct=True),
        QuestionOption(question_id=q2_2.id, label="C", text="Once a year", is_correct=False),
        QuestionOption(question_id=q2_2.id, label="D", text="Only when showing clinical signs of deficiency", is_correct=False),
    ])
    db.commit()

    # Stage 3
    s3 = Stage(program_district_id=district_id, title="Community Engagement & Counseling", description="Build communication skills to influence parent behaviors and handle sensitive situations.", order_index=2)
    db.add(s3); db.commit()

    t6 = Tutorial(stage_id=s3.id, title="Home Visit Strategies & Checklists", description="Structuring home visits, rapport building, and tracking pregnant/lactating mothers.", module_number="Module 3.1", duration_minutes=9, video_url="https://www.w3schools.com/html/movie.mp4", gradient_colors="from-purple-500 to-indigo-500", order_index=0)
    t7 = Tutorial(stage_id=s3.id, title="Counseling Mothers on Breastfeeding", description="Effective latching positions, counseling for milk supply issues, and overcoming local misconceptions.", module_number="Module 3.2", duration_minutes=15, video_url="https://www.w3schools.com/html/mov_bbb.mp4", gradient_colors="from-indigo-500 to-violet-500", order_index=1)
    db.add_all([t6, t7]); db.commit()

    test3 = Test(stage_id=s3.id, title="Stage 3 Assessment: Community & Counseling", description="Validate your skills in maternal counseling, breastfeeding support, and home visit sequencing.", total_questions=2, duration_minutes=10, passing_score_pct=70, max_attempts=3)
    db.add(test3); db.commit()

    q3_1 = Question(test_id=test3.id, text="Which counseling technique is most effective during ICDS home visits?", marks=2, order_index=0)
    db.add(q3_1); db.commit()
    db.add_all([
        QuestionOption(question_id=q3_1.id, label="A", text="Lecturing the family on their mistakes", is_correct=False),
        QuestionOption(question_id=q3_1.id, label="B", text="Active listening, praising good practices, and mutual problem solving", is_correct=True),
        QuestionOption(question_id=q3_1.id, label="C", text="Just dropping off brochures and leaving", is_correct=False),
        QuestionOption(question_id=q3_1.id, label="D", text="Fining families that do not comply with growth standards", is_correct=False),
    ])
    q3_2 = Question(test_id=test3.id, text="What is colostrum?", marks=2, order_index=1)
    db.add(q3_2); db.commit()
    db.add_all([
        QuestionOption(question_id=q3_2.id, label="A", text="A type of artificial formula milk", is_correct=False),
        QuestionOption(question_id=q3_2.id, label="B", text="The first, nutrient-rich yellow breastmilk produced after birth", is_correct=True),
        QuestionOption(question_id=q3_2.id, label="C", text="A micro-nutrient tablet", is_correct=False),
        QuestionOption(question_id=q3_2.id, label="D", text="A sanitation solution for work centers", is_correct=False),
    ])
    db.commit()


def _seed_ujjain(db: Session, district_id: int):
    """Seed Maternal & Immunization content for Ujjain district."""
    # Stage 1
    s1 = Stage(program_district_id=district_id, title="Maternal Health Essentials", description="Learn antenatal care, safe delivery practices, and postnatal follow-up protocols.", order_index=0)
    db.add(s1); db.commit()

    t1 = Tutorial(stage_id=s1.id, title="Antenatal Care Visits Protocol", description="Understand the minimum 4-visit ANC schedule, danger signs, and referral criteria.", module_number="Module 1.1", duration_minutes=7, video_url="https://www.w3schools.com/html/mov_bbb.mp4", gradient_colors="from-rose-500 to-pink-500", order_index=0)
    t2 = Tutorial(stage_id=s1.id, title="Iron-Folic Acid Supplementation", description="Dosage, timing, and addressing side effects of IFA tablets during pregnancy.", module_number="Module 1.2", duration_minutes=6, video_url="https://www.w3schools.com/html/movie.mp4", gradient_colors="from-red-500 to-rose-500", order_index=1)
    t3 = Tutorial(stage_id=s1.id, title="Birth Preparedness & Complication Readiness", description="Creating birth plans with families and recognizing obstetric emergencies.", module_number="Module 1.3", duration_minutes=9, video_url="https://www.w3schools.com/html/mov_bbb.mp4", gradient_colors="from-pink-500 to-fuchsia-500", order_index=2)
    db.add_all([t1, t2, t3]); db.commit()

    test1 = Test(stage_id=s1.id, title="Stage 1 Assessment: Maternal Health", description="Test your knowledge of ANC protocols, IFA supplementation, and birth preparedness.", total_questions=2, duration_minutes=8, passing_score_pct=70, max_attempts=3)
    db.add(test1); db.commit()

    q1 = Question(test_id=test1.id, text="How many antenatal care visits are recommended as a minimum during pregnancy?", marks=2, order_index=0)
    db.add(q1); db.commit()
    db.add_all([
        QuestionOption(question_id=q1.id, label="A", text="2 visits", is_correct=False),
        QuestionOption(question_id=q1.id, label="B", text="4 visits", is_correct=True),
        QuestionOption(question_id=q1.id, label="C", text="6 visits", is_correct=False),
        QuestionOption(question_id=q1.id, label="D", text="Only 1 at the time of delivery", is_correct=False),
    ])
    q2 = Question(test_id=test1.id, text="Which is a danger sign during pregnancy that requires immediate medical referral?", marks=2, order_index=1)
    db.add(q2); db.commit()
    db.add_all([
        QuestionOption(question_id=q2.id, label="A", text="Mild nausea in the first trimester", is_correct=False),
        QuestionOption(question_id=q2.id, label="B", text="Severe headache with blurred vision", is_correct=True),
        QuestionOption(question_id=q2.id, label="C", text="Occasional fatigue", is_correct=False),
        QuestionOption(question_id=q2.id, label="D", text="Increased appetite", is_correct=False),
    ])
    db.commit()

    # Stage 2
    s2 = Stage(program_district_id=district_id, title="Immunization & Vaccine Schedule", description="Master the National Immunization Schedule and cold-chain management.", order_index=1)
    db.add(s2); db.commit()

    t4 = Tutorial(stage_id=s2.id, title="National Immunization Schedule", description="Complete vaccine schedule from birth to 16 years with catch-up doses.", module_number="Module 2.1", duration_minutes=10, video_url="https://www.w3schools.com/html/movie.mp4", gradient_colors="from-blue-500 to-indigo-500", order_index=0)
    t5 = Tutorial(stage_id=s2.id, title="Cold Chain Management", description="Proper storage, transport, and monitoring of vaccine temperatures.", module_number="Module 2.2", duration_minutes=8, video_url="https://www.w3schools.com/html/mov_bbb.mp4", gradient_colors="from-indigo-500 to-purple-500", order_index=1)
    db.add_all([t4, t5]); db.commit()

    test2 = Test(stage_id=s2.id, title="Stage 2 Assessment: Immunization", description="Test your knowledge on vaccine schedules and cold chain protocols.", total_questions=2, duration_minutes=8, passing_score_pct=70, max_attempts=3)
    db.add(test2); db.commit()

    q3 = Question(test_id=test2.id, text="At what age should the first dose of Measles vaccine be given?", marks=2, order_index=0)
    db.add(q3); db.commit()
    db.add_all([
        QuestionOption(question_id=q3.id, label="A", text="At birth", is_correct=False),
        QuestionOption(question_id=q3.id, label="B", text="6 weeks", is_correct=False),
        QuestionOption(question_id=q3.id, label="C", text="9 months", is_correct=True),
        QuestionOption(question_id=q3.id, label="D", text="12 months", is_correct=False),
    ])
    q4 = Question(test_id=test2.id, text="What is the ideal temperature range for storing most vaccines?", marks=2, order_index=1)
    db.add(q4); db.commit()
    db.add_all([
        QuestionOption(question_id=q4.id, label="A", text="-20°C to 0°C", is_correct=False),
        QuestionOption(question_id=q4.id, label="B", text="+2°C to +8°C", is_correct=True),
        QuestionOption(question_id=q4.id, label="C", text="+10°C to +25°C", is_correct=False),
        QuestionOption(question_id=q4.id, label="D", text="Room temperature is fine", is_correct=False),
    ])
    db.commit()

    # Stage 3
    s3 = Stage(program_district_id=district_id, title="Infant & Young Child Feeding", description="Evidence-based practices for breastfeeding, complementary feeding, and growth monitoring.", order_index=2)
    db.add(s3); db.commit()

    t6 = Tutorial(stage_id=s3.id, title="Exclusive Breastfeeding Promotion", description="Counseling techniques to support exclusive breastfeeding for the first 6 months.", module_number="Module 3.1", duration_minutes=11, video_url="https://www.w3schools.com/html/movie.mp4", gradient_colors="from-emerald-500 to-green-500", order_index=0)
    t7 = Tutorial(stage_id=s3.id, title="Complementary Feeding Guidelines", description="Age-appropriate food introduction, food diversity, and responsive feeding.", module_number="Module 3.2", duration_minutes=13, video_url="https://www.w3schools.com/html/mov_bbb.mp4", gradient_colors="from-green-500 to-teal-500", order_index=1)
    db.add_all([t6, t7]); db.commit()

    test3 = Test(stage_id=s3.id, title="Stage 3 Assessment: IYCF", description="Validate your knowledge of breastfeeding and complementary feeding practices.", total_questions=2, duration_minutes=10, passing_score_pct=70, max_attempts=3)
    db.add(test3); db.commit()

    q5 = Question(test_id=test3.id, text="For how many months should a baby be exclusively breastfed?", marks=2, order_index=0)
    db.add(q5); db.commit()
    db.add_all([
        QuestionOption(question_id=q5.id, label="A", text="3 months", is_correct=False),
        QuestionOption(question_id=q5.id, label="B", text="6 months", is_correct=True),
        QuestionOption(question_id=q5.id, label="C", text="9 months", is_correct=False),
        QuestionOption(question_id=q5.id, label="D", text="12 months", is_correct=False),
    ])
    q6 = Question(test_id=test3.id, text="What does 'responsive feeding' mean?", marks=2, order_index=1)
    db.add(q6); db.commit()
    db.add_all([
        QuestionOption(question_id=q6.id, label="A", text="Force-feeding the child to finish all food", is_correct=False),
        QuestionOption(question_id=q6.id, label="B", text="Feeding only when the child cries", is_correct=False),
        QuestionOption(question_id=q6.id, label="C", text="Paying attention to hunger and satiety cues and feeding patiently", is_correct=True),
        QuestionOption(question_id=q6.id, label="D", text="Letting the child eat whatever they want", is_correct=False),
    ])
    db.commit()


def _seed_meghalaya(db: Session, district_id: int):
    """Seed Tribal Health content for Meghalaya district."""
    # Stage 1
    s1 = Stage(program_district_id=district_id, title="Tribal Health & Traditional Practices", description="Understanding health challenges in tribal/hill communities and integrating traditional knowledge.", order_index=0)
    db.add(s1); db.commit()

    t1 = Tutorial(stage_id=s1.id, title="Health Challenges in Hill Communities", description="Common health issues in hilly tribal regions: malaria, respiratory infections, and malnutrition.", module_number="Module 1.1", duration_minutes=8, video_url="https://www.w3schools.com/html/mov_bbb.mp4", gradient_colors="from-emerald-600 to-green-500", order_index=0)
    t2 = Tutorial(stage_id=s1.id, title="Bridging Traditional & Modern Health Practices", description="Respectfully integrating traditional healing with evidence-based healthcare.", module_number="Module 1.2", duration_minutes=10, video_url="https://www.w3schools.com/html/movie.mp4", gradient_colors="from-green-500 to-lime-500", order_index=1)
    db.add_all([t1, t2]); db.commit()

    test1 = Test(stage_id=s1.id, title="Stage 1 Assessment: Tribal Health Basics", description="Test understanding of tribal health challenges and cultural sensitivity.", total_questions=2, duration_minutes=8, passing_score_pct=70, max_attempts=3)
    db.add(test1); db.commit()

    q1 = Question(test_id=test1.id, text="Which disease is most prevalent in forested tribal regions of Northeast India?", marks=2, order_index=0)
    db.add(q1); db.commit()
    db.add_all([
        QuestionOption(question_id=q1.id, label="A", text="Diabetes Type 2", is_correct=False),
        QuestionOption(question_id=q1.id, label="B", text="Malaria", is_correct=True),
        QuestionOption(question_id=q1.id, label="C", text="Heart disease", is_correct=False),
        QuestionOption(question_id=q1.id, label="D", text="Osteoporosis", is_correct=False),
    ])
    q2 = Question(test_id=test1.id, text="What is the best approach when a community uses traditional healing for a sick child?", marks=2, order_index=1)
    db.add(q2); db.commit()
    db.add_all([
        QuestionOption(question_id=q2.id, label="A", text="Insist they stop immediately and only use modern medicine", is_correct=False),
        QuestionOption(question_id=q2.id, label="B", text="Respectfully discuss while introducing evidence-based treatments alongside", is_correct=True),
        QuestionOption(question_id=q2.id, label="C", text="Report the family to authorities", is_correct=False),
        QuestionOption(question_id=q2.id, label="D", text="Ignore the situation entirely", is_correct=False),
    ])
    db.commit()

    # Stage 2
    s2 = Stage(program_district_id=district_id, title="Nutrition in Hill Regions", description="Addressing malnutrition using locally available foods and government nutrition programs.", order_index=1)
    db.add(s2); db.commit()

    t3 = Tutorial(stage_id=s2.id, title="Locally Available Nutritious Foods", description="Identifying indigenous foods rich in micro-nutrients: bamboo shoots, local greens, river fish.", module_number="Module 2.1", duration_minutes=7, video_url="https://www.w3schools.com/html/mov_bbb.mp4", gradient_colors="from-amber-500 to-yellow-500", order_index=0)
    t4 = Tutorial(stage_id=s2.id, title="ICDS Supplementary Nutrition Program", description="Distributing Take-Home Rations (THR) and conducting nutrition counseling sessions.", module_number="Module 2.2", duration_minutes=9, video_url="https://www.w3schools.com/html/movie.mp4", gradient_colors="from-yellow-500 to-orange-500", order_index=1)
    db.add_all([t3, t4]); db.commit()

    test2 = Test(stage_id=s2.id, title="Stage 2 Assessment: Hill Nutrition", description="Test your knowledge of local nutrition strategies and ICDS programs.", total_questions=2, duration_minutes=8, passing_score_pct=70, max_attempts=3)
    db.add(test2); db.commit()

    q3 = Question(test_id=test2.id, text="Which locally available food in Meghalaya is rich in protein and iron?", marks=2, order_index=0)
    db.add(q3); db.commit()
    db.add_all([
        QuestionOption(question_id=q3.id, label="A", text="White rice only", is_correct=False),
        QuestionOption(question_id=q3.id, label="B", text="Local river fish and green leafy vegetables", is_correct=True),
        QuestionOption(question_id=q3.id, label="C", text="Refined sugar", is_correct=False),
        QuestionOption(question_id=q3.id, label="D", text="Packaged instant noodles", is_correct=False),
    ])
    q4 = Question(test_id=test2.id, text="What is THR in the context of ICDS?", marks=2, order_index=1)
    db.add(q4); db.commit()
    db.add_all([
        QuestionOption(question_id=q4.id, label="A", text="Total Health Report", is_correct=False),
        QuestionOption(question_id=q4.id, label="B", text="Take-Home Ration", is_correct=True),
        QuestionOption(question_id=q4.id, label="C", text="Training Health Resources", is_correct=False),
        QuestionOption(question_id=q4.id, label="D", text="Therapeutic Hospital Referral", is_correct=False),
    ])
    db.commit()

    # Stage 3
    s3 = Stage(program_district_id=district_id, title="Community Outreach in Remote Areas", description="Strategies for reaching remote villages, mobile health camps, and community mobilization.", order_index=2)
    db.add(s3); db.commit()

    t5 = Tutorial(stage_id=s3.id, title="Planning Mobile Health Camps", description="Logistics, supply planning, and coordination for health camps in remote villages.", module_number="Module 3.1", duration_minutes=10, video_url="https://www.w3schools.com/html/mov_bbb.mp4", gradient_colors="from-violet-500 to-purple-500", order_index=0)
    t6 = Tutorial(stage_id=s3.id, title="Community Mobilization Techniques", description="Working with village headmen, self-help groups, and youth clubs for health awareness.", module_number="Module 3.2", duration_minutes=12, video_url="https://www.w3schools.com/html/movie.mp4", gradient_colors="from-purple-500 to-fuchsia-500", order_index=1)
    db.add_all([t5, t6]); db.commit()

    test3 = Test(stage_id=s3.id, title="Stage 3 Assessment: Community Outreach", description="Validate your skills in planning outreach and community mobilization.", total_questions=2, duration_minutes=10, passing_score_pct=70, max_attempts=3)
    db.add(test3); db.commit()

    q5 = Question(test_id=test3.id, text="Who is the most important stakeholder to engage first when planning a health camp in a tribal village?", marks=2, order_index=0)
    db.add(q5); db.commit()
    db.add_all([
        QuestionOption(question_id=q5.id, label="A", text="The nearest city hospital director", is_correct=False),
        QuestionOption(question_id=q5.id, label="B", text="The village headman or community leader", is_correct=True),
        QuestionOption(question_id=q5.id, label="C", text="The state governor", is_correct=False),
        QuestionOption(question_id=q5.id, label="D", text="No one — just arrive and set up", is_correct=False),
    ])
    q6 = Question(test_id=test3.id, text="What is the key advantage of working with Self-Help Groups (SHGs) for health promotion?", marks=2, order_index=1)
    db.add(q6); db.commit()
    db.add_all([
        QuestionOption(question_id=q6.id, label="A", text="They provide funding for medicines", is_correct=False),
        QuestionOption(question_id=q6.id, label="B", text="They have established trust within the community and can spread health messages effectively", is_correct=True),
        QuestionOption(question_id=q6.id, label="C", text="They replace the need for trained health workers", is_correct=False),
        QuestionOption(question_id=q6.id, label="D", text="They have medical training", is_correct=False),
    ])
    db.commit()
