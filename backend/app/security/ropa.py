"""Record of Processing Activities — what this system holds and why.

The first question any government counterparty asks before signing is "what data
of our citizens will you hold, where, for how long, and who can see it". Having
that answer written down, versioned, and exportable turns a week of email into a
document. It is also the thing that makes the MOU's custody clause tractable:
you cannot say whose system a breach occurred in without an agreed map of which
data lives in which system.

Seeded once and then owned by whoever holds the data-protection role, who can
edit it from the admin console as the platform changes.
"""
from __future__ import annotations

import json

ACTIVITIES = (
    {
        "key": "learner_registration",
        "name": "Health worker registration and profile",
        "purpose": (
            "Identify and contact the health worker (ASHA / Anganwadi worker / ANM) using the "
            "platform, place them in the correct project and facility, and record their "
            "qualifications and training history."
        ),
        "lawful_basis": "DPDP Act 2023 s.6 - consent at registration; employment-linked programme participation",
        "data_categories": [
            "name", "email", "mobile", "date of birth", "gender", "geography",
            "facility", "designation", "qualifications", "years of service", "training history",
        ],
        "special_category": False,
        "subject_categories": ["Health workers enrolled in the programme"],
        "recipients": ["Programme administrators", "State health department (aggregate reporting)"],
        "storage_location": "Application database, India",
        "cross_border": False,
        "retention_months": 84,
        "retention_rationale": "Programme participation record and training certification history.",
        "security_measures": [
            "Password policy and account lockout",
            "Revocable server-side sessions",
            "Role-scoped access",
            "Audit trail of all access",
        ],
    },
    {
        "key": "mother_registration",
        "name": "Mother registration",
        "purpose": (
            "Register a pregnant or recently delivered mother so a health worker can provide "
            "counselling, follow her pregnancy and link her children's records."
        ),
        "lawful_basis": "DPDP Act 2023 s.6 - consent obtained in person by the health worker",
        "data_categories": [
            "name", "age / date of birth", "mobile", "alternate mobile", "email",
            "weight", "height", "last menstrual period", "expected date of delivery",
            "village / district / block", "health facility", "education", "occupation",
            "ration card type", "social category",
        ],
        "special_category": True,
        "subject_categories": ["Pregnant and postpartum women in the programme area"],
        "recipients": [
            "The registering health worker",
            "Programme administrators for the relevant project",
            "State health department (aggregate and de-identified reporting)",
        ],
        "storage_location": "Application database, India",
        "cross_border": False,
        "retention_months": 84,
        "retention_rationale": "Maternal health record; retained for the programme period and follow-up.",
        "security_measures": [
            "Contact identifiers encrypted at rest (AES-256-GCM)",
            "Ownership-scoped access - a health worker sees only her own registrations",
            "Every read, write and export recorded in a tamper-evident audit trail",
            "Consent recorded per purpose and revocable",
        ],
    },
    {
        "key": "child_registration",
        "name": "Child registration and birth details",
        "purpose": (
            "Register a newborn or infant under the mother's record so feeding practice and "
            "growth can be tracked and support given."
        ),
        "lawful_basis": (
            "DPDP Act 2023 s.9 - verifiable consent of a parent or lawful guardian, "
            "recorded against the mother's registration"
        ),
        "data_categories": [
            "name", "date of birth", "gender", "birth weight", "birth length",
            "delivery method and place", "breastfeeding initiation", "birth conditions",
        ],
        "special_category": True,
        "subject_categories": ["Children under the age of eighteen (in practice, under two)"],
        "recipients": ["The registering health worker", "Programme administrators"],
        "storage_location": "Application database, India",
        "cross_border": False,
        "retention_months": 84,
        "retention_rationale": "Paediatric growth history retains clinical value for years.",
        "security_measures": [
            "Guardian consent recorded with the verification method used",
            "No tracking or behavioural monitoring of children (s.9(3))",
            "No advertising of any kind",
            "Audit trail keyed by child so a guardian access request can be answered exactly",
        ],
    },
    {
        "key": "growth_monitoring",
        "name": "Growth measurement and WHO standard assessment",
        "purpose": (
            "Record weight, height and MUAC over time, plot against WHO growth standards, and "
            "alert the health worker and supervisor when a child needs attention."
        ),
        "lawful_basis": "DPDP Act 2023 s.6 - consent for growth monitoring",
        "data_categories": [
            "weight", "height / length", "MUAC", "measurement date",
            "measurement photographs", "computed z-scores and nutritional status",
        ],
        "special_category": True,
        "subject_categories": ["Children registered in the programme"],
        "recipients": ["The registering health worker", "Programme supervisors and administrators"],
        "storage_location": "Application database, India; media on object storage",
        "cross_border": True,
        "retention_months": 84,
        "retention_rationale": "Longitudinal growth history is the clinical value of the record.",
        "security_measures": [
            "Media served over TLS from a CDN with immutable, unguessable object names",
            "Audit trail records every case opened, by whom",
            "Bulk-access detection on the supervisory views",
        ],
    },
    {
        "key": "assessment_forms",
        "name": "Breastfeeding and complementary-feeding assessments",
        "purpose": "Record structured assessments of feeding practice against the programme's forms.",
        "lawful_basis": "DPDP Act 2023 s.6 - consent for care delivery",
        "data_categories": ["structured questionnaire answers", "free-text notes", "photographs", "videos"],
        "special_category": True,
        "subject_categories": ["Mothers and children in the programme"],
        "recipients": ["The registering health worker", "Programme administrators"],
        "storage_location": "Application database, India; media on object storage",
        "cross_border": True,
        "retention_months": 84,
        "retention_rationale": "Assessment history supports the counselling record.",
        "security_measures": ["Ownership-scoped access", "Versioned form definitions", "Audit trail"],
    },
    {
        "key": "training_assessment",
        "name": "Training tests and live proctoring",
        "purpose": (
            "Deliver staged tutorials and tests to health workers, and monitor test sessions "
            "live to preserve the integrity of certification."
        ),
        "lawful_basis": "DPDP Act 2023 s.6 - consent as a condition of programme certification",
        "data_categories": [
            "test answers and scores", "session activity events", "tab-switch and focus events",
        ],
        "special_category": False,
        "subject_categories": ["Health workers taking programme tests"],
        "recipients": ["Programme administrators and proctors"],
        "storage_location": "Application database, India",
        "cross_border": False,
        "retention_months": 84,
        "retention_rationale": "Certification evidence. Granular activity events expire at 180 days.",
        "security_measures": [
            "Proctoring limited to the duration of a test session",
            "Activity events retained only 180 days",
            "Test-taker informed before the session begins",
        ],
    },
    {
        "key": "programme_analytics",
        "name": "Programme analytics pipelines",
        "purpose": "Produce crosstabs and MASD analyses for programme reporting and evaluation.",
        "lawful_basis": "DPDP Act 2023 s.6 - consent for programme reporting (separate, optional purpose)",
        "data_categories": ["de-identified and aggregated indicators derived from the above"],
        "special_category": False,
        "subject_categories": ["Mothers, children and health workers, in aggregate"],
        "recipients": ["State health department", "Programme evaluators"],
        "storage_location": "Application server volume, India",
        "cross_border": False,
        "retention_months": 60,
        "retention_rationale": "Evaluation cycle plus historical comparison.",
        "security_measures": [
            "Outputs are aggregate; direct identifiers are not carried into pipeline inputs",
            "Pipeline runs recorded with the administrator who started them",
        ],
    },
    {
        "key": "security_operations",
        "name": "Security and audit logging",
        "purpose": (
            "Detect and investigate misuse, satisfy CERT-In log-retention requirements, and "
            "provide the evidence needed to determine custody, control and fault after an incident."
        ),
        "lawful_basis": (
            "DPDP Act 2023 s.7 - legitimate use for compliance with law; "
            "CERT-In Directions dated 28.04.2022"
        ),
        "data_categories": [
            "account identifier", "network address", "browser user agent", "action performed",
            "record identifiers accessed", "timestamps",
        ],
        "special_category": False,
        "subject_categories": ["All platform users"],
        "recipients": ["Data Protection Officer", "CERT-In and the Data Protection Board on request"],
        "storage_location": "Application database, India",
        "cross_border": False,
        "retention_months": 13,
        "retention_rationale": "Exceeds the CERT-In 180-day minimum and covers an annual audit cycle.",
        "security_measures": [
            "Append-only, hash-chained with a keyed MAC",
            "Periodic anchoring to detect truncation",
            "Values of sensitive fields are never written to the log - only field names",
        ],
    },
)


def seed(db, commit: bool = True) -> int:
    """Insert any activity not already recorded. Never overwrites an edited row."""
    from app.models_security import ProcessingActivity

    existing = {row[0] for row in db.query(ProcessingActivity.key).all()}
    created = 0
    for spec in ACTIVITIES:
        if spec["key"] in existing:
            continue
        db.add(
            ProcessingActivity(
                key=spec["key"],
                name=spec["name"],
                purpose=spec["purpose"],
                lawful_basis=spec["lawful_basis"],
                data_categories=json.dumps(spec["data_categories"]),
                special_category=spec["special_category"],
                subject_categories=json.dumps(spec["subject_categories"]),
                recipients=json.dumps(spec.get("recipients") or []),
                storage_location=spec.get("storage_location"),
                cross_border=spec.get("cross_border", False),
                retention_months=spec.get("retention_months"),
                retention_rationale=spec.get("retention_rationale"),
                security_measures=json.dumps(spec.get("security_measures") or []),
                controller=None,
                processor=None,
            )
        )
        created += 1
    if created and commit:
        db.commit()
    return created
