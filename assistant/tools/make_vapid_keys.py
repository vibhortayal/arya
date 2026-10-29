"""Write fresh VAPID keys for push reminders into an env file.
Usage: python tools/make_vapid_keys.py deploy/.env
The private key goes straight into the file and is never printed."""
import base64, sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def main(path):
    key = ec.generate_private_key(ec.SECP256R1())
    priv = b64(key.private_numbers().private_value.to_bytes(32, "big"))
    pub = b64(key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    with open(path, "a") as fh:
        fh.write(f"\nARYA_VAPID_PRIVATE_KEY={priv}\nARYA_VAPID_PUBLIC_KEY={pub}\n"
                 "ARYA_VAPID_SUBJECT=mailto:you@example.com\n")
    print(f"VAPID keys appended to {path}. Set ARYA_VAPID_SUBJECT to your email,"
          " then ARYA_PUSH_REMINDERS=1 to turn reminders on.")


if __name__ == "__main__":
    main(sys.argv[1])
