import random
import string
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.config import settings


class EmailDeliveryError(Exception):
    """Raised when an OTP email could not be delivered. In production this is
    surfaced to the caller so the user can retry, rather than silently swallowed."""
    pass


def generate_otp() -> str:
    """Generate a random 6-digit numeric OTP."""
    return "".join(random.choices(string.digits, k=6))


def _build_otp_message(to_email: str, otp: str) -> MIMEMultipart:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"NurtureHUB verification code: {otp}"
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email

    text = (
        f"Your verification code for NurtureHUB is {otp}. "
        f"It will expire in {settings.OTP_EXPIRE_MINUTES} minutes."
    )
    html = f"""
    <html>
      <body style="font-family: 'Segoe UI', Arial, sans-serif; padding: 24px; color: #3A100B; background-color: #FEF5F3;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #FDE7E2; border-radius: 12px; padding: 32px;">
          <h2 style="color: #D14432; text-align: center; margin-top: 0;">NurtureHUB Verification Code</h2>
          <p>Hello,</p>
          <p>Thank you for using NurtureHUB. Please use the following One-Time Password (OTP) to verify your account:</p>
          <div style="text-align: center; margin: 32px 0;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #8A2A1D; background-color: #FEF5F3; padding: 14px 26px; border-radius: 10px; border: 1px solid #FACCC2;">{otp}</span>
          </div>
          <p>This code will expire in {settings.OTP_EXPIRE_MINUTES} minutes. If you did not request this, you can safely ignore this email.</p>
          <hr style="border: 0; border-top: 1px solid #FDE7E2; margin: 32px 0;" />
          <p style="font-size: 12px; color: #A98A82; text-align: center;">NurtureHUB · Assessment &amp; Training Platform</p>
        </div>
      </body>
    </html>
    """

    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))
    return msg


def send_otp_email(to_email: str, otp: str) -> None:
    """
    Deliver an OTP email over SMTP.

    - Development: prints the OTP to the console for convenience. If SMTP is
      configured it also attempts a real send, but delivery failures are
      logged and swallowed so local flows are never blocked.
    - Production: a real send is mandatory. Missing SMTP config or any send
      failure raises EmailDeliveryError so the API can return an error instead
      of telling the user to check an inbox that will never receive the code.
    """
    # Dev convenience: surface the code in the server log. Never in production.
    if not settings.is_production:
        print("\n" + "=" * 50)
        print(f"  >>> NURTUREHUB VERIFICATION OTP: {otp} <<<  ")
        print(f"  Sent to: {to_email}")
        print("=" * 50 + "\n")

    # SMTP not configured
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        if settings.is_production:
            raise EmailDeliveryError("SMTP credentials are not configured.")
        print("SMTP credentials not configured. OTP printed to console above (dev only).")
        return

    try:
        msg = _build_otp_message(to_email, otp)

        # Port 465 → implicit SSL; 587/25 → STARTTLS. A timeout prevents a slow
        # or unreachable mail server from hanging the request worker.
        if settings.SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=settings.SMTP_TIMEOUT)
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=settings.SMTP_TIMEOUT)
            server.ehlo()
            server.starttls()
            server.ehlo()

        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_USER, to_email, msg.as_string())
        server.quit()
        print(f"Successfully sent OTP email to {to_email} via SMTP")
    except Exception as e:
        print(f"Error sending OTP email via SMTP to {to_email}: {e}")
        if settings.is_production:
            # Fail loud so the endpoint returns an error and the user can retry.
            raise EmailDeliveryError(str(e)) from e
        # Dev: don't block local flows on a flaky/unconfigured mail server.
