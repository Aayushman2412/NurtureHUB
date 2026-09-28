"""MASD — Member Activity Summary Dashboard.

The analysts' district report (adoption target fulfilment, activity intensity,
and malnutrition outcomes against NFHS) computed inside NurtureHUB from the
app's own data, instead of by scripts over downloaded exports.

  rules.py        the programme rules (ideal activities, targets, bands)
  engine.py       the analysis — pure, data in → report out
  data.py         loads one project's records for the engine
  insights.py     the plain-language findings under each chart
  pptx_export.py  the report as a PowerPoint deck
  xlsx_export.py  the learner-level MASD sheet and summaries as Excel
"""
