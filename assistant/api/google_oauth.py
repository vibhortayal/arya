"""Arya's own Google sign-in (authorization-code flow).

Why: with Supabase's Google provider, Google's screen names the Supabase
project host. Here the redirect URI lives on Arya's own domain, so the
screen names Arya. Google only has to prove the email, which is all the
Supabase bridge did for Google anyway; the code is exchanged server to
server, so the ID token comes straight from Google over TLS.

Feature flag: used only when GOOGLE_OAUTH_CLIENT_ID and
GOOGLE_OAUTH_CLIENT_SECRET are both set. Otherwise /auth/google keeps
using the Supabase provider.
"""
import base64
import json
import os
import secrets
from urllib.parse import urlencode

import httpx

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
TIMEOUT = 10.0


class GoogleError(Exception):
    """Google refused, or could not be reached. Message is user-safe."""


def _id():
    return os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")


def _secret():
    return os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")


def configured():
    return bool(_id() and _secret())


def new_state():
    return secrets.token_urlsafe(24)


def start_url(redirect_uri, state):
    return AUTH_URL + "?" + urlencode({
        "client_id": _id(), "redirect_uri": redirect_uri, "response_type": "code",
        "scope": "openid email", "state": state, "prompt": "select_account"})


def email_for_code(code, redirect_uri):
    """Exchange the authorization code; return the Google-verified email."""
    try:
        r = httpx.post(TOKEN_URL, data={
            "code": code, "client_id": _id(), "client_secret": _secret(),
            "redirect_uri": redirect_uri, "grant_type": "authorization_code"}, timeout=TIMEOUT)
    except httpx.HTTPError:
        raise GoogleError("Google sign-in unavailable, try again")
    if r.status_code >= 400:
        raise GoogleError("that Google sign-in has expired")
    return _claims_email(r.json().get("id_token"))


def _claims_email(id_token):
    # Received directly from Google's token endpoint over TLS, so the
    # signature need not be re-checked (Google's own guidance); the
    # audience, issuer and verified flag still are.
    try:
        part = str(id_token).split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except (IndexError, ValueError):
        raise GoogleError("that Google sign-in could not be read")
    email = (claims.get("email") or "").strip().lower()
    if claims.get("aud") != _id() or claims.get("iss") not in ISSUERS:
        raise GoogleError("that Google sign-in is not for Arya")
    if not email or claims.get("email_verified") not in (True, "true"):
        raise GoogleError("that email is not verified")
    return email
