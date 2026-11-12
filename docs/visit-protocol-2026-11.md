# EduPoshan visit protocol (LAP, November 2026)

The rules Dr. Rupal set with Nandish between 30 Oct and 4 Nov 2026
(Nandish's Claude chat "Visit Flows", meetings of 3 and 5 Nov). This file is
the single source the code follows; change it first, then the code.

Form codes: **MF** mother form · **AF** antenatal (pregnancy check) ·
**PF** mother's protein form · **ChF** child form · **CG** check growth ·
**BF** breastfeeding assessment · **CF** complementary feeding assessment.

Day numbers count from the adoption visit (day 0) unless a rule says
otherwise. A visit done within **±2 days** of its due day counts for that day.

**Which projects follow it.** The protocol is a per-project setting. Projects
created from now on use it, and so does **Chandrapur** (decided 12 Nov 2026).
The projects already running (Jalna, Ujjain, Meghalaya) stay on the earlier
schedule and the 5-month split unless someone switches them on the admin
Projects page.

## Adoption types (buckets)

| Bucket | Who | Split |
|---|---|---|
| 1 · ANC | adopted while pregnant | — |
| 2 · PNC <6M | baby under 180 days at adoption | 180 days (was 150 = "5 months"; the change applies to new projects) |
| 3 · PNC ≥6M | baby 180 days or older at adoption | |

## Bucket 1 · ANC

- Day 0: MF → AF → PF.
- Every 15 days until delivery: AF + PF.
- From 35 weeks of pregnancy, every visit first asks **"Has the delivery happened?"**
  - **No** → AF + PF as usual; ask again at the next visit.
  - **Yes** → ChF → CG → BF. No AF any more. The mother moves to Bucket 2; its
    visit days count from this first visit after delivery. PF then follows the
    PNC protein rule below.

## Bucket 2 · PNC under 6 months

- Day 0: MF → ChF → CG → BF → PF.
- Visit days: 0, 1, 2, 3, 5, 7, 10, 12, 14, 21, 28, 42, then every 30 days.
  CG at every visit; BF by the breastfeeding rule below.
- **From the first visit at which the baby is 180 days or older ("CF day 0")**
  the complementary-feeding schedule sets every visit:

  | CF day | Forms |
  |---|---|
  | 0 | CG · CF-1 |
  | 5 | CG · CF-2 |
  | 10 | CG · CF-3 |
  | 15 | CG · CF-4 |
  | 30 | CG · CF-5 |
  | 45 | CG · CF-6 |
  | 60 | CG · CF-7 |
  | every 30 days after | CG · CF, until the child is 1 year old |
  | after 1 year of age | CG · CF every 3 months until the adoption ends |

  BF joins these visits only while fewer than 5 BF forms have been done.

## Bucket 3 · PNC 6 months or older

| Day | Forms |
|---|---|
| 0 | MF · ChF · CG · BF-1 · CF-1 · PF |
| 1 | CG · BF-2 |
| 2 | CG · BF-3 |
| 3 | CG · BF-4 |
| 5 | CG · BF-5 · CF-2 |
| 10 | CG · CF-3 |
| 15 | CG · CF-4 |
| 30 | CG · CF-5 |
| 45 | CG · CF-6 |
| 60 | CG · CF-7 |
| every 30 days after day 60 | CG · CF, until the child is 1 year old |
| after 1 year of age | CG · CF every 3 months until the adoption ends |

Missed BF forms are done at the next visits until 5 are complete. BF stops if
the mother is not breastfeeding at all.

## Breastfeeding rule (Bucket 2, until 180 days)

1. **Points drop out.** A BF question answered "green" (correct practice) in
   two *consecutive* BF forms is not shown in later BF forms. Consecutive means
   back to back, not "any two".
2. **BF stops** (from the next visit) when the last two BF forms were all green
   **and** weight-for-age is at or above the **30th percentile** (z ≥ −0.52)
   **and** the weight-for-age z-score change since the previous check is
   **zero or positive**.
3. Otherwise BF repeats (a baby below the 30th percentile keeps getting BF even
   when gaining; a falling z-score keeps BF even when all answers are green).
4. **BF reopens** after stopping if weight-for-age falls below the 30th
   percentile or the z-score change turns negative.
5. **At 180 days** the rule ends: BF stops if 5 BF forms are done, otherwise
   it continues until 5 are done.
6. **Mother not breastfeeding:** the learner counsels her to restart. If
   breastfeeding is still stopped at 2 consecutive visits after counselling,
   the learner confirms the adoption as a **drop-out**.

## Mother's protein form (Buckets 2 and 3, and ANC mothers after delivery)

- First PF at the adoption visit (for a mother from Bucket 1: the first visit
  after delivery).
- Then every 15 days, filled at the nearest child visit, never less than
  10 days after the previous PF.
- **Stops for good** once two consecutive PFs each show at least **40 g
  high-quality protein** and at least **80 g total protein**.

## Growth status, priority and data checks

**Growth trend** compares weight-for-age z (WAZ) with the last check at least
14 days earlier: faltering < −0.67 · slowed −0.66…−0.01 · no change 0 ·
improved +0.01…+0.67 · catch-up > +0.67. Babies under 3 weeks use the newborn
rule instead (NICE NG75): more than 10 % below birth weight, or birth weight
not regained by 3 weeks.

**Priority score** (proposal from the chat, numbers adjustable; Nandish to
confirm the final order) = status score × trend multiplier.
- Status score = 1 + Σ(extra death risk of each indicator) using Olofin 2013:
  wasting 11.63 / 3.38 / 1.62, underweight 9.40 / 2.63 / 1.52, stunting
  5.48 / 2.28 / 1.46 for severe / moderate / mild (normal 1.00); extra risk is
  the value minus 1.
- Trend multiplier: faltering 2.0 · slowed 1.5 · no change or first check 1.0 ·
  improved 0.8 · catch-up 0.6.
- Moderate or severe on all three indicators: score × 2.
- Tiers: ≥ 9 refer / act today · 3–9 act this week · 1.5–3 counsel at next
  visit · < 1.5 not flagged. Severe wasting or severe underweight is always
  tier 1.

**Entry checks when a measurement is saved** (compared with the previous
check, WHO velocity tables scaled to the interval):
- impossible values: WAZ < −6 or > +5, LAZ < −6 or > +6, WLZ < −5 or > +5 → re-measure;
- likely typing error: weight more than 1.5× or less than 0.67× the previous;
- weight loss ≥ 10 % → re-weigh, check danger signs, refer today; 5–10 % → ask
  about diarrhoea, fever and feeding, revisit within 7 days;
- length more than 1 cm shorter than before → re-measure with two people.

## Still to come from Nandish / Dr. Rupal

- The final priority order of the malnutrition groups.
- Breastfeeding question → video segment sheet (per hold), for the learner to
  send the mother one WhatsApp message with the clips for her wrong points.
- Hold-specific breastfeeding flow ("which hold are you assessing?"); below the
  30th percentile teach the hold, above the 50th do not insist.
