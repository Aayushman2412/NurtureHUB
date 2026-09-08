"""NurtureHUB data-protection layer.

Everything in this package exists to satisfy one operational requirement: when
patient (mother/child) medical records are handled by this system, NurtureHUB
must be able to demonstrate — with evidence — what happened, who did it, from
where, and under whose control. That is the standard the Maharashtra MOU sets:
breach responsibility follows *custody, control and technical system*, and on
shared systems it is apportioned by *fault and control*.

The layers, in the order a request meets them:

  1. transport/edge  — security headers, HSTS, CSP        (`middleware`)
  2. identity        — password policy, lockout, MFA, revocable sessions
                       (`passwords`, `sessions`, `mfa`)
  3. authorisation   — role/ownership scoping already enforced per-router
  4. confidentiality — application-level field encryption for direct
                       identifiers + blind indexes           (`crypto`)
  5. accountability  — hash-chained, append-only audit trail (`audit`)
  6. detection       — anomaly rules over the audit trail    (`anomaly`)
  7. governance      — consent, data-subject rights, retention, breach
                       register with statutory clocks
                       (`consent`, `retention`, `incidents`)

Nothing here is optional decoration: layers 5-7 are what make the MOU clause
answerable at all.
"""
