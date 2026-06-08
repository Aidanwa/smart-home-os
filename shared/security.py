import base64
import hashlib
import os
from cryptography.fernet import Fernet

# Reuse the central secret key as our operational seed
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")

def _get_fernet_key() -> bytes:
    """Derive a valid 32-byte URL-safe base64 key from the JWT secret key using SHA-256."""
    key_hash = hashlib.sha256(JWT_SECRET_KEY.encode()).digest()
    return base64.urlsafe_b64encode(key_hash)

def encrypt_secret(plain_text: str) -> str:
    """Encrypt a plain text string securely using symmetric Fernet encryption."""
    if not plain_text:
        return ""
    cipher = Fernet(_get_fernet_key())
    return cipher.encrypt(plain_text.encode()).decode()

def decrypt_secret(encrypted_text: str) -> str:
    """Decrypt a ciphertext string back into plain text using symmetric Fernet encryption."""
    if not encrypted_text:
        return ""
    cipher = Fernet(_get_fernet_key())
    return cipher.decrypt(encrypted_text.encode()).decode()