import base64
import logging
import string
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.config import settings

logger = logging.getLogger(__name__)


class EmailDeliveryError(Exception):
    """Raised when an OTP email could not be delivered. In production this is
    surfaced to the caller so the user can retry, rather than silently swallowed."""
    pass


def generate_otp() -> str:
    """Generate a random 6-digit numeric OTP (from the OS's CSPRNG — a code
    that guards an account must not come from a predictable generator)."""
    import secrets
    return "".join(secrets.choice(string.digits) for _ in range(6))


def _mask_email(email: str) -> str:
    parts = email.split("@")
    if len(parts) == 2 and len(parts[0]) > 2:
        return f"{parts[0][0]}***{parts[0][-1]}@{parts[1]}"
    return email


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


def _login_smtp(server: smtplib.SMTP, user: str, password: str) -> None:
    """
    Authenticate against the SMTP server.
    
    Google SMTP responds with `535 5.7.8 BadCredentials` and abruptly closes the
    TCP connection if credentials fail. When smtplib retries with AUTH LOGIN on a
    closed socket, it hides the 535 error and raises `Connection unexpectedly closed`.
    We test AUTH PLAIN first to catch and surface the authentic 535 rejection.
    """
    try:
        auth_plain = base64.b64encode(f"\0{user}\0{password}".encode()).decode()
        code, resp = server.docmd("AUTH", f"PLAIN {auth_plain}")
        if code == 235:
            return
        if code == 535:
            detail = resp.decode("utf-8", errors="ignore").replace("\n", " ").strip()
            raise smtplib.SMTPAuthenticationError(
                code,
                f"Google SMTP rejected credentials: {detail}. "
                "Ensure a valid 16-character Google App Password (not your account password) "
                "is set in SMTP_PASSWORD with 2-Step Verification enabled."
            )
    except smtplib.SMTPAuthenticationError:
        raise
    except Exception:
        pass

    # Standard fallback
    server.login(user, password)


def _deliver_smtp(host: str, port: int, use_starttls: bool, user: str, password: str, to_email: str, msg: MIMEMultipart) -> None:
    context = ssl.create_default_context()
    if use_starttls:
        server = smtplib.SMTP(host, port, timeout=settings.SMTP_TIMEOUT)
        server.ehlo()
        server.starttls(context=context)
        server.ehlo()
    else:
        server = smtplib.SMTP_SSL(host, port, context=context, timeout=settings.SMTP_TIMEOUT)

    _login_smtp(server, user, password)
    server.sendmail(user, to_email, msg.as_string())

    # Some mail servers immediately terminate the socket upon completion, causing
    # server.quit() to raise SMTPServerDisconnected even though the email was sent.
    try:
        server.quit()
    except Exception:
        try:
            server.close()
        except Exception:
            pass


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
    smtp_user = (settings.SMTP_USER or "").strip()
    smtp_password = (settings.SMTP_PASSWORD or "").strip().replace(" ", "")

    if not smtp_user or not smtp_password:
        if settings.is_production:
            raise EmailDeliveryError("SMTP credentials are not configured.")
        print("SMTP credentials not configured. OTP printed to console above (dev only).")
        return

    msg = _build_otp_message(to_email, otp)
    host = settings.SMTP_HOST.strip()
    primary_port = int(settings.SMTP_PORT)

    # Build connection attempts: try configured port, and if that fails due to
    # port blocking or network reset, fall back between 587 (STARTTLS) and 465 (SSL).
    attempts: list[tuple[bool, int]] = []
    if primary_port == 465:
        attempts.append((False, 465))
        if host in ("smtp.gmail.com", "smtp.googlemail.com"):
            attempts.append((True, 587))
    else:
        attempts.append((True, primary_port))
        if host in ("smtp.gmail.com", "smtp.googlemail.com") and primary_port != 465:
            attempts.append((False, 465))

    last_error: Exception | None = None
    for use_starttls, port in attempts:
        mode = "STARTTLS" if use_starttls else "SSL"
        try:
            _deliver_smtp(
                host=host,
                port=port,
                use_starttls=use_starttls,
                user=smtp_user,
                password=smtp_password,
                to_email=to_email,
                msg=msg,
            )
            print(f"Successfully sent OTP email to {to_email} via SMTP ({host}:{port} {mode})")
            return
        except smtplib.SMTPAuthenticationError as auth_err:
            last_error = auth_err
            print(f"Error authenticating with SMTP ({host}:{port} {mode}) as {_mask_email(smtp_user)}: {auth_err}")
            # Authentication errors indicate bad credentials — don't retry other ports
            break
        except Exception as e:
            last_error = e
            print(f"SMTP attempt failed on {host}:{port} ({mode}) for {to_email}: {type(e).__name__}: {e}")

    # All attempts exhausted
    print(f"Error sending OTP email via SMTP to {to_email}: {last_error}")
    if settings.is_production:
        raise EmailDeliveryError(str(last_error)) from last_error
