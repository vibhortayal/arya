"""Supabase Auth bridge — email codes and Google sign-in.

Arya keeps its own accounts and its own session cookie. Supabase only
proves that a person controls an email address; this module asks it and
returns that address. No Supabase library and no browser-side Supabase
code: the server talks to the GoTrue REST API, so the same-origin CSP
stays as it is.

Env: SUPABASE_URL, SUPABASE_ANON_KEY (the publishable key; it is not a
secret, but it lives in the VM env, not in the repo).
"""
import os
from urllib.parse import quote

import httpx

TIMEOUT = 10.0


class AuthError(Exception):
    """Supabase refused, or could not be reached. Message is user-safe."""


def _url():
    return os.environ.get("SUPABASE_URL", "").rstrip("/")


def _key():
    return os.environ.get("SUPABASE_ANON_KEY", "")


def configured():
    return bool(_url() and _key())


def _headers(token=None):
    return {"apikey": _key(), "Authorization": "Bearer " + (token or _key()),
            "Content-Type": "application/json"}


def _post(path, body):
    try:
        r = httpx.post(_url() + path, json=body, headers=_headers(), timeout=TIMEOUT)
    except httpx.HTTPError:
        raise AuthError("sign-in service unavailable, try again")
    return r


def send_code(email):
    """Email a one-time code (and link) to this address."""
    r = _post("/auth/v1/otp", {"email": email, "create_user": True})
    if r.status_code == 429:
        raise AuthError("too many codes requested, wait a minute")
    if r.status_code >= 400:
        raise AuthError("could not send the code")


def verify_code(email, code):
    """Exchange the emailed code for a verified email address."""
    r = _post("/auth/v1/verify", {"type": "email", "email": email, "token": code})
    if r.status_code >= 400:
        raise AuthError("that code is wrong or expired")
    return _verified_email(r.json().get("user"))


def email_for_token(access_token):
    """Verified email for a Supabase access token (Google redirect)."""
    try:
        r = httpx.get(_url() + "/auth/v1/user",
                      headers=_headers(access_token), timeout=TIMEOUT)
    except httpx.HTTPError:
        raise AuthError("sign-in service unavailable, try again")
    if r.status_code >= 400:
        raise AuthError("that sign-in has expired")
    return _verified_email(r.json())


def _verified_email(user):
    user = user or {}
    email = (user.get("email") or "").strip().lower()
    if not email or not (user.get("email_confirmed_at") or user.get("confirmed_at")):
        raise AuthError("that email is not verified")
    return email


def google_url(redirect_to):
    return (_url() + "/auth/v1/authorize?provider=google&redirect_to="
            + quote(redirect_to, safe=""))
