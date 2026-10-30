"""
Transactional email delivery through SMTP (Gmail) or Resend; in development without either, codes go to the console.

Made by Yash Jain with passion.
"""

import html
from email.message import EmailMessage

import aiosmtplib
import httpx

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger

logger = get_logger("email")
RESEND_URL = "https://api.resend.com/emails"


async def _send_smtp(to: str, subject: str, text: str, html_body: str) -> None:
    """Send through SMTP (Gmail: smtp.gmail.com:587 with STARTTLS and an App Password)."""
    settings = get_settings()
    assert settings.smtp_host and settings.smtp_username and settings.smtp_password
    message = EmailMessage()
    message["From"] = settings.email_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(text)
    message.add_alternative(html_body, subtype="html")
    try:
        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password.get_secret_value(),
            use_tls=settings.smtp_implicit_tls,
            start_tls=not settings.smtp_implicit_tls,
            timeout=15,
        )
    except (aiosmtplib.SMTPException, OSError) as exc:
        logger.error("email_smtp_failed", error=type(exc).__name__, detail=str(exc)[:200])
        raise AppError("email_unavailable", "Could not send email, try again shortly", 503) from exc


async def send_email(to: str, subject: str, text: str, html_body: str) -> None:
    """Send one email via SMTP, else Resend, else (development only) print it; 503 on failure."""
    settings = get_settings()
    if settings.smtp_configured:
        await _send_smtp(to, subject, text, html_body)
        return
    if settings.resend_api_key is None:
        if settings.is_production:
            raise AppError("email_unavailable", "Email delivery is not configured", 503)
        logger.warning("email_dev_console", to=to, subject=subject, text=text)
        return

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {settings.resend_api_key.get_secret_value()}"},
                json={
                    "from": settings.email_from,
                    "to": [to],
                    "subject": subject,
                    "text": text,
                    "html": html_body,
                },
            )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error("email_send_failed", error=type(exc).__name__)
        raise AppError("email_unavailable", "Could not send email, try again shortly", 503) from exc


async def send_login_code(to: str, code: str, ttl_minutes: int) -> None:
    """Email the 6-digit login code with an anti-phishing note."""
    text = (
        f"Your Stack3 login code is {code}\n\n"
        f"It expires in {ttl_minutes} minutes. Stack3 will never ask you for this code by chat or phone, "
        "and never asks for your seed phrase."
    )
    html_body = (
        f"<p>Your Stack3 login code is</p><p style='font-size:28px;letter-spacing:6px'><b>{html.escape(code)}</b></p>"
        f"<p>It expires in {ttl_minutes} minutes. Stack3 will never ask you for this code by chat or phone, "
        "and never asks for your seed phrase.</p>"
    )
    await send_email(to, "Your Stack3 login code", text, html_body)


async def send_team_invite(to: str, team_name: str, inviter_email: str, link: str) -> None:
    """Email a team invite link."""
    safe_team, safe_inviter, safe_link = html.escape(team_name), html.escape(inviter_email), html.escape(link)
    text = f"{inviter_email} invited you to join {team_name} on Stack3 Security.\n\nAccept: {link}"
    html_body = (
        f"<p>{safe_inviter} invited you to join <b>{safe_team}</b> on Stack3 Security.</p>"
        f"<p><a href='{safe_link}'>Accept the invite</a></p>"
    )
    await send_email(to, f"Join {team_name} on Stack3", text, html_body)
