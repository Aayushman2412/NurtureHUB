from sqlalchemy.orm import Session
from app.models import Stage, Tutorial, Test, Question, QuestionOption, Achievement

def seed_database(db: Session):
    # Check if database is already seeded
    if db.query(Stage).count() > 0:
        print("Database already contains data, skipping seeding.")
        return
        
    print("Seeding database...")
    
    # --- Achievements ---
    ach1 = Achievement(title="Fast Learner", description="Completed your first tutorial video", emoji_icon="⚡")
    ach2 = Achievement(title="Scholar", description="Scored 100% on any assessment", emoji_icon="🎓")
    ach3 = Achievement(title="Graduate", description="Passed all 3 stages of training", emoji_icon="🏆")
    db.add_all([ach1, ach2, ach3])
    db.commit()
    
    # --- STAGE 1 ---
    s1 = Stage(title="Foundation Skills for ICDS Workers", description="Master the core concepts of child growth monitoring, immunization, and community counseling.", order_index=0)
    db.add(s1)
    db.commit()
    
    t1 = Tutorial(
        stage_id=s1.id,
        title="Introduction to Child Development Tracker",
        description="Learn how to record developmental milestones and identify growth faltering early.",
        module_number="Module 1.1",
        duration_minutes=5,
        video_url="https://www.w3schools.com/html/mov_bbb.mp4",
        gradient_colors="from-teal-500 to-cyan-500",
        order_index=0
    )
    t2 = Tutorial(
        stage_id=s1.id,
        title="Nutrition & Growth Standards",
        description="Understand the WHO growth standards, weight-for-age charts, and checking for stunting/wasting.",
        module_number="Module 1.2",
        duration_minutes=8,
        video_url="https://www.w3schools.com/html/movie.mp4",
        gradient_colors="from-emerald-500 to-teal-500",
        order_index=1
    )
    t3 = Tutorial(
        stage_id=s1.id,
        title="Early Stimulation Play Practices",
        description="Guide parents on simple home activities that boost cognitive development in children under 3.",
        module_number="Module 1.3",
        duration_minutes=6,
        video_url="https://www.w3schools.com/html/mov_bbb.mp4",
        gradient_colors="from-cyan-500 to-blue-500",
        order_index=2
    )
    db.add_all([t1, t2, t3])
    db.commit()
    
    test1 = Test(
        stage_id=s1.id,
        title="Stage 1 Assessment: Foundations",
        description="Test your understanding of child growth monitoring, WHO charts, and early milestones.",
        total_questions=3,
        duration_minutes=10,
        passing_score_pct=70,
        max_attempts=3
    )
    db.add(test1)
    db.commit()
    
    # Questions for Test 1
    q1_1 = Question(test_id=test1.id, text="What is the primary indicator used to assess acute growth faltering (wasting) in WHO charts?", marks=2, order_index=0)
    db.add(q1_1)
    db.commit()
    db.add_all([
        QuestionOption(question_id=q1_1.id, label="A", text="Weight-for-height (or length)", is_correct=True),
        QuestionOption(question_id=q1_1.id, label="B", text="Height-for-age", is_correct=False),
        QuestionOption(question_id=q1_1.id, label="C", text="Head circumference-for-age", is_correct=False),
        QuestionOption(question_id=q1_1.id, label="D", text="Mid-upper arm circumference (MUAC) only", is_correct=False)
    ])
    
    q1_2 = Question(test_id=test1.id, text="At what age should complementary feeding start alongside continued breastfeeding?", marks=2, order_index=1)
    db.add(q1_2)
    db.commit()
    db.add_all([
        QuestionOption(question_id=q1_2.id, label="A", text="At 3 months", is_correct=False),
        QuestionOption(question_id=q1_2.id, label="B", text="At 6 months", is_correct=True),
        QuestionOption(question_id=q1_2.id, label="C", text="At 12 months", is_correct=False),
        QuestionOption(question_id=q1_2.id, label="D", text="When the child gets their first tooth", is_correct=False)
    ])
    
    q1_3 = Question(test_id=test1.id, text="Which developmental milestone is typically expected of a child by 12 months of age?", marks=2, order_index=2)
    db.add(q1_3)
    db.commit()
    db.add_all([
        QuestionOption(question_id=q1_3.id, label="A", text="Running steadily without falling", is_correct=False),
        QuestionOption(question_id=q1_3.id, label="B", text="Standing alone and potentially taking first steps", is_correct=True),
        QuestionOption(question_id=q1_3.id, label="C", text="Speaking full complex sentences", is_correct=False),
        QuestionOption(question_id=q1_3.id, label="D", text="Drawing clear geometrical shapes", is_correct=False)
    ])
    db.commit()
    
    # --- STAGE 2 ---
    s2 = Stage(title="Advanced Nutritional Interventions", description="Handle micro-nutrient deficiency, SAM, MAM, and coordinate medical referrals.", order_index=1)
    db.add(s2)
    db.commit()
    
    t4 = Tutorial(
        stage_id=s2.id,
        title="Micro-Nutrient Supplements Guide",
        description="Proper dosing schedules for Vitamin A, Iron-Folic Acid (IFA), and Zinc supplements.",
        module_number="Module 2.1",
        duration_minutes=10,
        video_url="https://www.w3schools.com/html/movie.mp4",
        gradient_colors="from-amber-500 to-orange-500",
        order_index=0
    )
    t5 = Tutorial(
        stage_id=s2.id,
        title="Severe Acute Malnutrition Management",
        description="How to perform appetite tests, use Ready-to-Use Therapeutic Food (RUTF), and criteria for referral.",
        module_number="Module 2.2",
        duration_minutes=12,
        video_url="https://www.w3schools.com/html/mov_bbb.mp4",
        gradient_colors="from-rose-500 to-pink-500",
        order_index=1
    )
    db.add_all([t4, t5])
    db.commit()
    
    test2 = Test(
        stage_id=s2.id,
        title="Stage 2 Assessment: Advanced Nutrition",
        description="Test your knowledge on supplementation schedules, SAM referral protocols, and RUTF usage.",
        total_questions=2,
        duration_minutes=8,
        passing_score_pct=70,
        max_attempts=3
    )
    db.add(test2)
    db.commit()
    
    q2_1 = Question(test_id=test2.id, text="What is the MUAC threshold for classifying a child (6-59 months) as having Severe Acute Malnutrition (SAM)?", marks=2, order_index=0)
    db.add(q2_1)
    db.commit()
    db.add_all([
        QuestionOption(question_id=q2_1.id, label="A", text="Less than 11.5 cm (115 mm)", is_correct=True),
        QuestionOption(question_id=q2_1.id, label="B", text="Between 11.5 and 12.5 cm", is_correct=False),
        QuestionOption(question_id=q2_1.id, label="C", text="Less than 13.5 cm", is_correct=False),
        QuestionOption(question_id=q2_1.id, label="D", text="Only depends on the child's weight status", is_correct=False)
    ])
    
    q2_2 = Question(test_id=test2.id, text="How often should Vitamin A supplements be administered to children aged 12-59 months?", marks=2, order_index=1)
    db.add(q2_2)
    db.commit()
    db.add_all([
        QuestionOption(question_id=q2_2.id, label="A", text="Every month", is_correct=False),
        QuestionOption(question_id=q2_2.id, label="B", text="Every 6 months", is_correct=True),
        QuestionOption(question_id=q2_2.id, label="C", text="Once a year", is_correct=False),
        QuestionOption(question_id=q2_2.id, label="D", text="Only when showing clinical signs of deficiency", is_correct=False)
    ])
    db.commit()
    
    # --- STAGE 3 ---
    s3 = Stage(title="Community Engagement & Counseling", description="Build communication skills to influence parent behaviors and handle sensitive situations.", order_index=2)
    db.add(s3)
    db.commit()
    
    t6 = Tutorial(
        stage_id=s3.id,
        title="Home Visit Strategies & Checklists",
        description="Structuring home visits, rapport building, and tracking pregnant/lactating mothers.",
        module_number="Module 3.1",
        duration_minutes=9,
        video_url="https://www.w3schools.com/html/movie.mp4",
        gradient_colors="from-purple-500 to-indigo-500",
        order_index=0
    )
    t7 = Tutorial(
        stage_id=s3.id,
        title="Counseling Mothers on Breastfeeding",
        description="Effective latching positions, counseling for milk supply issues, and overcoming local misconceptions.",
        module_number="Module 3.2",
        duration_minutes=15,
        video_url="https://www.w3schools.com/html/mov_bbb.mp4",
        gradient_colors="from-indigo-500 to-violet-500",
        order_index=1
    )
    db.add_all([t6, t7])
    db.commit()
    
    test3 = Test(
        stage_id=s3.id,
        title="Stage 3 Assessment: Community & Counseling",
        description="Validate your skills in maternal counseling, breastfeeding support, and home visit sequencing.",
        total_questions=2,
        duration_minutes=10,
        passing_score_pct=70,
        max_attempts=3
    )
    db.add(test3)
    db.commit()
    
    q3_1 = Question(test_id=test3.id, text="Which counseling technique is most effective during ICDS home visits?", marks=2, order_index=0)
    db.add(q3_1)
    db.commit()
    db.add_all([
        QuestionOption(question_id=q3_1.id, label="A", text="Lecturing the family on their mistakes", is_correct=False),
        QuestionOption(question_id=q3_1.id, label="B", text="Active listening, praising good practices, and mutual problem solving", is_correct=True),
        QuestionOption(question_id=q3_1.id, label="C", text="Just dropping off brochures and leaving", is_correct=False),
        QuestionOption(question_id=q3_1.id, label="D", text="Fining families that do not comply with growth standards", is_correct=False)
    ])
    
    q3_2 = Question(test_id=test3.id, text="What is colostrum?", marks=2, order_index=1)
    db.add(q3_2)
    db.commit()
    db.add_all([
        QuestionOption(question_id=q3_2.id, label="A", text="A type of artificial formula milk", is_correct=False),
        QuestionOption(question_id=q3_2.id, label="B", text="The first, nutrient-rich yellow breastmilk produced after birth", is_correct=True),
        QuestionOption(question_id=q3_2.id, label="C", text="A micro-nutrient tablet", is_correct=False),
        QuestionOption(question_id=q3_2.id, label="D", text="A sanitation solution for work centers", is_correct=False)
    ])
    db.commit()
    
    print("Database seeding completed successfully.")
