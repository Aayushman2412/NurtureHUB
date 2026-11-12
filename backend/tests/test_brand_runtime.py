"""Runtime behaviour behind the EduPoshan rename: sender header, defaults, markers."""
from app.config import settings
from app.routers.admin_forms import FORM_TEMPLATE_FORMAT, is_form_template_format
from app.utils import _build_otp_message, sender_address


def test_sender_uses_smtp_from_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_FROM", "Custom Sender <ops@example.org>")
    assert sender_address() == "Custom Sender <ops@example.org>"


def test_sender_falls_back_to_app_name_on_the_smtp_login(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_FROM", "")
    monkeypatch.setattr(settings, "SMTP_USER", "mailer@example.org")
    assert sender_address() == "EduPoshan <mailer@example.org>"


def test_sender_ignores_the_old_compose_default(monkeypatch):
    # docker-compose.yml on the server still hands this in when SMTP_FROM is unset.
    monkeypatch.setattr(settings, "SMTP_FROM", "NurtureHUB <noreply@nurturehub.org>")
    monkeypatch.setattr(settings, "SMTP_USER", "mailer@example.org")
    assert sender_address() == "EduPoshan <mailer@example.org>"


def test_sender_without_any_smtp_login_uses_a_local_address(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_FROM", "")
    monkeypatch.setattr(settings, "SMTP_USER", "")
    assert sender_address() == "EduPoshan <noreply@localhost>"


def test_otp_email_carries_the_new_name_and_palette(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_FROM", "")
    msg = _build_otp_message("a@example.org", "123456")
    assert msg["Subject"] == "EduPoshan verification code: 123456"
    assert msg["From"].startswith("EduPoshan <")
    html = msg.get_payload()[1].get_payload(decode=True).decode("utf-8")
    for token in ("123456", "#0F5562", "#F3F5F7", "#D0D7DC", "#EEF7F8", "#AEDADF",
                  "#0E3A43", "#55616B", "Training and field records"):
        assert token in html
    assert "#D14432" not in html


def test_app_names_and_defaults():
    assert settings.APP_NAME == "EduPoshan"
    assert settings.PROJECT_NAME == "EduPoshan API"
    assert settings.MFA_ISSUER == "EduPoshan"
    assert settings.VAPID_SUBJECT == "mailto:admin@eduposhan.org"


def test_form_template_marker_accepts_new_and_legacy():
    assert FORM_TEMPLATE_FORMAT == "eduposhan-form-template"
    assert is_form_template_format("eduposhan-form-template")
    assert is_form_template_format("nurturehub-form-template")
    assert not is_form_template_format("something-else")
    assert not is_form_template_format(None)


def test_audit_and_storage_loggers_sit_under_the_redacted_parent():
    import inspect
    from app import storage
    from app.security import audit, redaction
    assert audit.logger.name == "eduposhan.audit"
    assert storage.logger.name == "eduposhan.storage"
    # The redacting filter is installed on the parent's handlers; children propagate to it.
    assert '"eduposhan"' in inspect.getsource(redaction.install_log_redaction)
