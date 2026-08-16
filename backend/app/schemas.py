from pydantic import BaseModel, Field, field_validator
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Optional, List

def convert_to_kolkata(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.astimezone(ZoneInfo("Asia/Kolkata"))
    if isinstance(v, str):
        try:
            dt = datetime.fromisoformat(v)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(ZoneInfo("Asia/Kolkata"))
        except ValueError:
            pass
    return v

# ----------------------------------------
# Sensor Reading Schemas
# ----------------------------------------
class SensorReadingCreate(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=50, description="Unique identifier of the receiver device")
    temperature: float = Field(..., ge=-40.0, le=80.0, description="Temperature in Celsius (-40 to 80)")
    humidity: float = Field(..., ge=0.0, le=100.0, description="Relative Humidity percentage (0 to 100)")
    motion: bool = Field(..., description="Motion detection state (true=motion, false=no motion)")
    packet_number: int = Field(..., ge=0, description="Monotonically increasing sequence packet number")
    
    # Optional parameters for metrics and buffering
    received_at_ms: Optional[int] = Field(default=None, description="Receiver millisecond timestamp for latency")
    captured_at: Optional[datetime] = Field(default=None, description="Original capture timestamp for buffered packets")
    is_buffered: Optional[bool] = Field(default=False, description="Whether packet was uploaded from buffer")
    wifi_reconnects: Optional[int] = Field(default=None, description="Wi-Fi reconnect count from device")
    backend_failures: Optional[int] = Field(default=None, description="Backend failure count from device")
    uptime: Optional[int] = Field(default=None, description="Uptime in seconds from device")
    buffer_count: Optional[int] = Field(default=None, description="Current buffered packets count on device")
    firmware_version: Optional[str] = Field(default=None, description="Firmware version of the device")

    @field_validator("device_id")
    @classmethod
    def validate_device_id(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Device ID cannot be empty or whitespace only")
        return v.strip()

class SensorReadingResponse(BaseModel):
    id: int
    device_id: str
    temperature: float
    humidity: float
    motion: bool
    packet_number: int
    latency_ms: Optional[int] = None
    is_buffered: bool = False
    captured_at: Optional[datetime] = None
    received_at: datetime
    created_at: datetime
    public_id: Optional[str] = None

    @field_validator("received_at", "created_at", "captured_at", mode="before")
    @classmethod
    def localize_datetimes(cls, v):
        return convert_to_kolkata(v)

    class Config:
        from_attributes = True

class PublicSensorReadingResponse(BaseModel):
    record_id: str
    device_id: str
    packet_number: int
    temperature: float
    humidity: float
    motion: bool
    timestamp: datetime
    latency_ms: Optional[int] = None
    is_buffered: bool = False
    firmware_version: str
    device_health: Optional[int] = None
    nrf_status: str
    wifi_status: str
    packet_loss_percentage: Optional[float] = None
    blockchain_status: str
    hash: Optional[str] = None

    @field_validator("timestamp", mode="before")
    @classmethod
    def localize_datetimes(cls, v):
        return convert_to_kolkata(v)

    class Config:
        from_attributes = True

class IngestionResponse(BaseModel):
    success: bool = True

# ----------------------------------------
# Device Schemas
# ----------------------------------------
class DeviceCreate(BaseModel):
    id: str = Field(..., min_length=3, max_length=50)
    name: str = Field(..., min_length=3, max_length=100)
    api_key: str = Field(..., min_length=16, description="Cleartext api key used during setup. Exposed once.")

class DeviceResponse(BaseModel):
    id: str
    name: str
    firmware_version: str
    created_at: datetime

    @field_validator("created_at", mode="before")
    @classmethod
    def localize_datetimes(cls, v):
        return convert_to_kolkata(v)

    class Config:
        from_attributes = True

class DeviceHeartbeat(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=50)
    wifi_status: str = Field(..., description="Wi-Fi status: CONNECTED or DISCONNECTED")
    nrf_status: str = Field(..., description="NRF Link status: ACTIVE or ERROR")
    
    wifi_reconnects: Optional[int] = Field(default=None)
    backend_failures: Optional[int] = Field(default=None)
    uptime: Optional[int] = Field(default=None)
    buffer_count: Optional[int] = Field(default=None)
    firmware_version: Optional[str] = Field(default=None)

class DeviceStatusResponse(BaseModel):
    device_id: str
    status: str
    last_seen: Optional[datetime] = None
    last_packet_number: Optional[int] = None
    last_temperature: Optional[float] = None
    last_humidity: Optional[float] = None
    last_motion: Optional[bool] = None
    wifi_status: str
    nrf_status: str
    buffer_count: int
    updated_at: datetime
    receiver_status: str

    @field_validator("last_seen", "updated_at", mode="before")
    @classmethod
    def localize_datetimes(cls, v):
        return convert_to_kolkata(v)

    class Config:
        from_attributes = True

# ----------------------------------------
# Motion Event Schemas
# ----------------------------------------
class MotionEventResponse(BaseModel):
    id: int
    device_id: str
    event_type: str
    detected_at: datetime
    cleared_at: Optional[datetime] = None
    created_at: datetime

    @field_validator("detected_at", "cleared_at", "created_at", mode="before")
    @classmethod
    def localize_datetimes(cls, v):
        return convert_to_kolkata(v)

    class Config:
        from_attributes = True

# ----------------------------------------
# Blockchain Record Schemas
# ----------------------------------------
class BlockchainRecordResponse(BaseModel):
    id: int
    sensor_record_id: int
    device_id: str
    data_hash: str
    transaction_hash: Optional[str] = None
    block_number: Optional[int] = None
    network: str
    contract_address: str
    recorded_at: Optional[datetime] = None
    verification_status: str
    created_at: datetime

    @field_validator("recorded_at", "created_at", mode="before")
    @classmethod
    def localize_datetimes(cls, v):
        return convert_to_kolkata(v)

    class Config:
        from_attributes = True

# ----------------------------------------
# Integrity Verification Schema
# ----------------------------------------
class VerificationResponse(BaseModel):
    record_id: int
    device_id: str
    packet_number: int
    computed_hash: str
    blockchain_hash: Optional[str] = None
    transaction_hash: Optional[str] = None
    block_number: Optional[int] = None
    network: str
    verification_status: str # 'VERIFIED', 'PENDING', 'NOT_REGISTERED', 'INTEGRITY_FAILURE'
    message: str
    timestamp: datetime

    @field_validator("timestamp", mode="before")
    @classmethod
    def localize_datetimes(cls, v):
        return convert_to_kolkata(v)

# ----------------------------------------
# Communication Metrics Schemas
# ----------------------------------------
class CommunicationMetricsResponse(BaseModel):
    device_id: str
    packets_sent: int
    packets_received: int
    packets_lost: int
    packet_loss_percentage: float
    average_latency: Optional[float] = None
    min_latency: Optional[float] = None
    max_latency: Optional[float] = None
    wifi_reconnects: int
    backend_failures: int
    calculated_at: datetime

    @field_validator("calculated_at", mode="before")
    @classmethod
    def localize_datetimes(cls, v):
        return convert_to_kolkata(v)

    class Config:
        from_attributes = True

# ----------------------------------------
# Device Health Schemas
# ----------------------------------------
class DeviceHealthResponse(BaseModel):
    device_id: str
    overall_score: int
    nrf_score: int
    wifi_score: int
    packet_score: int
    backend_score: int
    sensors_score: int
    status_label: str
    updated_at: datetime

    @field_validator("updated_at", mode="before")
    @classmethod
    def localize_datetimes(cls, v):
        return convert_to_kolkata(v)

    class Config:
        from_attributes = True

# ----------------------------------------
# Firmware Version Schemas
# ----------------------------------------
class FirmwareVersionCreate(BaseModel):
    version: str = Field(..., min_length=5, max_length=20)
    file_url: str = Field(...)
    sha256: str = Field(..., min_length=64, max_length=64)
    release_notes: Optional[str] = None
    is_active: bool = True

class FirmwareVersionResponse(BaseModel):
    version: str
    file_url: str
    sha256: str
    release_notes: Optional[str] = None
    created_at: datetime
    is_active: bool

    @field_validator("created_at", mode="before")
    @classmethod
    def localize_datetimes(cls, v):
        return convert_to_kolkata(v)

    class Config:
        from_attributes = True

# ----------------------------------------
# OTA Update Schemas
# ----------------------------------------
class OtaUpdateResponse(BaseModel):
    id: int
    device_id: str
    from_version: str
    to_version: str
    status: str
    progress: int
    started_at: datetime
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None

    @field_validator("started_at", "completed_at", mode="before")
    @classmethod
    def localize_datetimes(cls, v):
        return convert_to_kolkata(v)

    class Config:
        from_attributes = True

class OtaTriggerResponse(BaseModel):
    success: bool
    update_id: int
    message: str

class OtaCheckResponse(BaseModel):
    ota_pending: bool
    ota_url: Optional[str] = None
    ota_version: Optional[str] = None
    ota_sha256: Optional[str] = None
    update_id: Optional[int] = None

class OtaStatusUpdate(BaseModel):
    status: str # DOWNLOADING, VERIFYING, INSTALLING, SUCCESS, FAILED
    progress: int
    error_message: Optional[str] = None
    update_id: Optional[int] = None

