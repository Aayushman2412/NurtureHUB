"""One-time codes over WhatsApp (review of 17 Oct 2026).

Sir: "let's not take email as the first step to login; let's take WhatsApp
number based login as the first approach". A learner in a village often
uses a phone someone at home set up for her and may not know which email
address it has, let alone open it — but she reads WhatsApp.

This sends an AUTHENTICATION template through the WhatsApp Cloud API
(graph.facebook.com/<version>/<phone-number-id>/messages). The template is
created and approved in Meta's WhatsApp Manager; its body carries the code as
{{1}} and its copy-code button the same code (Meta's standard OTP layout).

Not configured (no token / number id / template): `available()` is False and
sign-up by mobile number still works — the number is simply confirmed later.
In development the code is printed to the server log instead, like the email
OTP, so the whole flow can be tried locally. Never in production.
"""
from __future__ import annotations

import logging

import requests

from app.config import settings

log = logging.getLogger(__name__)


class WhatsAppDeliveryError(RuntimeError):
    """The code could not be handed to WhatsApp. Never carries the code."""


def configured() -> bool:
    return bool(
        (settings.WHATSAPP_ACCESS_TOKEN or "").strip()
        and (settings.WHATSAPP_PHONE_NUMBER_ID or "").strip()
        and (settings.WHATSAPP_OTP_TEMPLATE or "").strip()
    )


def available() -> bool:
    """Whether a code can reach the learner: really over WhatsApp, or — in
    development only — through the server log."""
    return configured() or not settings.is_production


def send_otp(mobile: str, code: str) -> None:
    """Send `code` to the ten-digit Indian `mobile`. Raises
    WhatsAppDeliveryError on any failure; the caller decides what to tell the
    learner."""
    if not configured():
        if settings.is_production:
            raise WhatsAppDeliveryError("WhatsApp is not configured.")
        print("\n" + "=" * 50)
        print(f"  >>> NURTUREHUB WHATSAPP OTP: {code} <<<  (dev only — WhatsApp not configured)")
        print(f"  To: ******{mobile[-4:]}")
        print("=" * 50 + "\n")
        return

    url = (f"https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}/"
           f"{settings.WHATSAPP_PHONE_NUMBER_ID.strip()}/messages")
    payload = {
        "messaging_product": "whatsapp",
        "to": f"91{mobile}",
        "type": "template",
        "template": {
            "name": settings.WHATSAPP_OTP_TEMPLATE.strip(),
            "language": {"code": settings.WHATSAPP_TEMPLATE_LANG or "en"},
            "components": [
                {"type": "body", "parameters": [{"type": "text", "text": code}]},
                {"type": "button", "sub_type": "url", "index": "0",
                 "parameters": [{"type": "text", "text": code}]},
            ],
        },
    }
    try:
        res = requests.post(
            url, json=payload, timeout=settings.WHATSAPP_TIMEOUT,
            headers={"Authorization": f"Bearer {settings.WHATSAPP_ACCESS_TOKEN.strip()}"},
        )
    except requests.RequestException as exc:
        log.warning("WhatsApp OTP send failed: %s", type(exc).__name__)
        raise WhatsAppDeliveryError("WhatsApp could not be reached.") from None
    if res.status_code >= 300:
        # Meta's error code only — the body echoes the request, code included.
        try:
            err = (res.json() or {}).get("error", {})
            reason = f"{err.get('code')}/{err.get('error_subcode')}"
        except ValueError:
            reason = "unparseable"
        log.warning("WhatsApp OTP send refused: HTTP %s (%s)", res.status_code, reason)
        raise WhatsAppDeliveryError("WhatsApp refused the message.")
