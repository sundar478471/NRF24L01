import secrets
import hashlib
from fastapi import Header, HTTPException, Security, Depends
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.models import Device

from typing import Optional

# Header name for device authentication
API_KEY_HEADER = APIKeyHeader(name="X-Device-API-Key", auto_error=False)

def generate_api_key() -> str:
    """Generates a secure cryptographically random API key for device setup."""
    return f"iot_key_{secrets.token_hex(20)}"

def hash_api_key(api_key: str) -> str:
    """Computes the SHA-256 hash of an API key for safe database storage."""
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()

from fastapi import Request

async def verify_device_credentials(
    request: Request,
    x_device_api_key_header: Optional[str] = Security(API_KEY_HEADER),
    db: Session = Depends(get_db)
) -> Device:
    """
    Validates the device ID and either the X-Device-API-Key or X-Device-Key header.
    Extracts device_id from the JSON payload body.
    """
    try:
        body = await request.json()
        device_id = body.get("device_id")
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid request body or JSON format"
        )
        
    if not device_id:
        raise HTTPException(
            status_code=422,
            detail="Missing 'device_id' in request body"
        )

    x_device_api_key = (
        request.headers.get("X-Device-API-Key")
        or request.headers.get("X-Device-Key")
        or x_device_api_key_header
    )

    if not x_device_api_key:
        raise HTTPException(
            status_code=401,
            detail="Missing device API key header (X-Device-API-Key or X-Device-Key)"
        )
    
    # Hash incoming key and verify by database lookup
    incoming_hash = hash_api_key(x_device_api_key)
    device = db.query(Device).filter(Device.api_key_hash == incoming_hash).first()
    if not device:
        raise HTTPException(
            status_code=403,
            detail="Invalid device credentials"
        )
    
    # Prevent device ID impersonation (verify that payload device_id matches the authenticated device's ID)
    if device.id != device_id:
        raise HTTPException(
            status_code=403,
            detail="Invalid device credentials"
        )
        
    return device

