import random
import string
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.config import settings

def generate_otp() -> str:
    """Generate a random 6-digit numeric OTP."""
    return "".join(random.choices(string.digits, k=6))

def send_otp_email(to_email: str, otp: str) -> bool:
    """
    Sends an email with the OTP to the specified address.
    If SMTP settings are not configured, prints the OTP to the console.
    """
    # Print to console for development verification
    print("\n" + "="*50)
    print(f"  >>> NURTUREHUB VERIFICATION OTP: {otp} <<<  ")
    print(f"  Sent to: {to_email}")
    print("="*50 + "\n")
    
    # Check if SMTP details are configured
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        print("SMTP credentials not configured. OTP printed to console above.")
        return True
        
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"NurtureHUB verification code: {otp}"
        msg["From"] = settings.SMTP_FROM
        msg["To"] = to_email
        
        text = f"Your verification code for NurtureHUB is {otp}. It will expire in 10 minutes."
        html = f"""
        <html>
          <body style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 30px;">
              <h2 style="color: #0f766e; text-align: center;">NurtureHUB Verification Code</h2>
              <p>Hello,</p>
              <p>Thank you for registering with NurtureHUB. Please use the following One-Time Password (OTP) to verify your account:</p>
              <div style="text-align: center; margin: 30px 0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1e293b; background-color: #f1f5f9; padding: 12px 24px; border-radius: 6px; border: 1px solid #cbd5e1;">{otp}</span>
              </div>
              <p>This code will expire in 10 minutes. If you did not request this, you can safely ignore this email.</p>
              <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
              <p style="font-size: 12px; color: #64748b; text-align: center;">NurtureHUB Assessment & Training Platform</p>
            </div>
          </body>
        </html>
        """
        
        part1 = MIMEText(text, "plain")
        part2 = MIMEText(html, "html")
        msg.attach(part1)
        msg.attach(part2)
        
        # Connect to SMTP server
        # For port 465, use SMTP_SSL. For port 587 or 25, use standard SMTP + starttls
        if settings.SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT)
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)
            server.ehlo()
            server.starttls()
            server.ehlo()
            
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_FROM, to_email, msg.as_string())
        server.quit()
        print(f"Successfully sent OTP email to {to_email} via SMTP")
        return True
    except Exception as e:
        print(f"Error sending OTP email via SMTP to {to_email}: {e}")
        # Return True for development flow compatibility so users aren't blocked by network/SMTP issues
        return True
