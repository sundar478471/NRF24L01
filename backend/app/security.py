import secrets
import hashlib
from fastapi import Header, HTTPException, Security, Depends
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session
from backend.app.database import get_db
from backend.app.models import Device

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
    x_device_api_key: str = Security(API_KEY_HEADER),
    db: Session = Depends(get_db)
) -> Device:
    """
    Validates the device ID and the X-Device-API-Key header.
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

    if not x_device_api_key:
        raise HTTPException(
            status_code=401,
            detail="Missing device API key header (X-Device-API-Key)"
        )
    
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(
            status_code=404,
            detail=f"Device '{device_id}' not found"
        )
    
    # Hash incoming key and verify
    incoming_hash = hash_api_key(x_device_api_key)
    if not secrets.compare_digest(device.api_key_hash, incoming_hash):
        raise HTTPException(
            status_code=403,
            detail="Invalid device credentials"
        )
        
    return device
