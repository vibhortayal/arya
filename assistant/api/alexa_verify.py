"""Checks that a request on /alexa/skill really comes from Amazon:
the signing certificate URL, the certificate chain (to a trusted root,
for echo-api.amazon.com, in date), the body signature and the request
time. Amazon requires all of these for a skill hosted outside AWS
Lambda."""
import base64, datetime, posixpath, threading, time
from urllib.parse import urlparse

CERT_HOST = "s3.amazonaws.com"
CERT_PATH = "/echo.api/"
SIGNER = "echo-api.amazon.com"
MAX_SKEW_S = 150

_cache = {}            # cert URL -> (fetched_at, pem bytes)
_cache_lock = threading.Lock()
CACHE_S = 6 * 3600


class Refused(Exception):
    pass


def cert_url_ok(url):
    try:
        u = urlparse(url or "")
    except ValueError:
        return False
    if u.scheme.lower() != "https" or (u.hostname or "").lower() != CERT_HOST:
        return False
    if u.port not in (None, 443):
        return False
    path = posixpath.normpath(u.path or "")
    return path.startswith(CERT_PATH)


def _fetch(url):
    import httpx
    r = httpx.get(url, timeout=4.0, follow_redirects=False)
    r.raise_for_status()
    return r.content


_store = None


def _trust_store():
    """The public roots (certifi), read once."""
    global _store
    if _store is None:
        import certifi, warnings
        from cryptography import x509
        from cryptography.x509.verification import Store
        with open(certifi.where(), "rb") as fh, warnings.catch_warnings():
            warnings.simplefilter("ignore")   # one old root has a negative serial
            _store = Store(x509.load_pem_x509_certificates(fh.read()))
    return _store


# Tests swap these two for their own certificate authority.
fetch = _fetch
trust_store = _trust_store


def _chain(url):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(url)
        if hit and now - hit[0] < CACHE_S:
            return hit[1]
    pem = fetch(url)
    with _cache_lock:
        _cache[url] = (now, pem)
    return pem


def verify(headers, body, now=None):
    """Raise Refused unless the request is Amazon's. `headers` is any
    mapping with case-insensitive get (Starlette headers)."""
    from cryptography import x509
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.x509.verification import PolicyBuilder

    url = headers.get("signaturecertchainurl") or ""
    sig = headers.get("signature-256") or ""
    if not url or not sig:
        raise Refused("missing signature headers")
    if not cert_url_ok(url):
        raise Refused("bad certificate url")
    try:
        certs = x509.load_pem_x509_certificates(_chain(url))
    except Exception:
        raise Refused("certificate chain unreadable")
    if not certs:
        raise Refused("empty certificate chain")
    leaf, rest = certs[0], certs[1:]
    when = datetime.datetime.fromtimestamp(now if now is not None else time.time(),
                                           datetime.timezone.utc)
    try:
        verifier = (PolicyBuilder().store(trust_store()).time(when)
                    .build_server_verifier(x509.DNSName(SIGNER)))
        verifier.verify(leaf, rest)
    except Exception:
        raise Refused("certificate not trusted")
    try:
        leaf.public_key().verify(base64.b64decode(sig), body,
                                 padding.PKCS1v15(), hashes.SHA256())
    except (InvalidSignature, ValueError):
        raise Refused("bad signature")


def fresh(timestamp, now=None):
    """The request's own time is within 150 s of ours."""
    try:
        t = datetime.datetime.strptime(str(timestamp), "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=datetime.timezone.utc).timestamp()
    except ValueError:
        return False
    return abs((now if now is not None else time.time()) - t) <= MAX_SKEW_S
