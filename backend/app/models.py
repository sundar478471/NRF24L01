from datetime import datetime
from typing import Optional
from sqlalchemy import Integer, String, Float, Boolean, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func
from backend.app.database import Base

class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String, primary_key=True, index=True) # device_id (e.g. 'receiver-01')
    name: Mapped[str] = mapped_column(String, nullable=False)
    api_key_hash: Mapped[str] = mapped_column(String, nullable=False) # SHA-256 hash of device API key
    firmware_version: Mapped[str] = mapped_column(String, default="1.0.0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    status = relationship("DeviceStatus", back_populates="device", uselist=False, cascade="all, delete-orphan")
    readings = relationship("SensorReading", back_populates="device", cascade="all, delete-orphan")
    motion_events = relationship("MotionEvent", back_populates="device", cascade="all, delete-orphan")
    health = relationship("DeviceHealth", back_populates="device", uselist=False, cascade="all, delete-orphan")
    metrics = relationship("CommunicationMetrics", back_populates="device", uselist=False, cascade="all, delete-orphan")
    ota_updates = relationship("OtaUpdate", back_populates="device", cascade="all, delete-orphan")

class DeviceStatus(Base):
    __tablename__ = "device_status"

    device_id: Mapped[str] = mapped_column(String, ForeignKey("devices.id"), primary_key=True)
    status: Mapped[str] = mapped_column(String, default="OFFLINE", nullable=False) # 'ONLINE', 'OFFLINE', 'CONNECTING', 'ERROR', 'UPDATING'
    last_seen: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_packet_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_humidity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_motion: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    wifi_status: Mapped[str] = mapped_column(String, default="DISCONNECTED", nullable=False) # 'CONNECTED' or 'DISCONNECTED'
    nrf_status: Mapped[str] = mapped_column(String, default="ERROR", nullable=False) # 'ACTIVE' or 'ERROR'
    buffer_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    device = relationship("Device", back_populates="status")

    @property
    def receiver_status(self) -> str:
        return self.status

class SensorReading(Base):
    __tablename__ = "sensor_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String, ForeignKey("devices.id"), index=True, nullable=False)
    temperature: Mapped[float] = mapped_column(Float, nullable=False)
    humidity: Mapped[float] = mapped_column(Float, nullable=False)
    motion: Mapped[bool] = mapped_column(Boolean, nullable=False)
    packet_number: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_buffered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    captured_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    public_id: Mapped[Optional[str]] = mapped_column(String, unique=True, index=True, nullable=True)

    # Relationships
    device = relationship("Device", back_populates="readings")
    blockchain_record = relationship("BlockchainRecord", back_populates="sensor_reading", uselist=False, cascade="all, delete-orphan")

    # Enforce uniqueness of packet number per device to prevent duplicate processing
    __table_args__ = (
        UniqueConstraint("device_id", "packet_number", name="uq_device_packet"),
        Index("idx_device_received", "device_id", "received_at"),
    )

class MotionEvent(Base):
    __tablename__ = "motion_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String, ForeignKey("devices.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String, default="MOTION", nullable=False)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cleared_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True) # Nullable until motion clears
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    device = relationship("Device", back_populates="motion_events")

class BlockchainRecord(Base):
    __tablename__ = "blockchain_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    sensor_record_id: Mapped[int] = mapped_column(Integer, ForeignKey("sensor_readings.id"), unique=True, nullable=False)
    device_id: Mapped[str] = mapped_column(String, nullable=False)
    data_hash: Mapped[str] = mapped_column(String, nullable=False) # SHA-256 string representation
    transaction_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    block_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    network: Mapped[str] = mapped_column(String, nullable=False) # 'hardhat', 'polygon', etc.
    contract_address: Mapped[str] = mapped_column(String, nullable=False)
    recorded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_status: Mapped[str] = mapped_column(String, default="PENDING", nullable=False) # 'PENDING', 'VERIFIED', 'FAILED'
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    sensor_reading = relationship("SensorReading", back_populates="blockchain_record")

class CommunicationMetrics(Base):
    __tablename__ = "communication_metrics"

    device_id: Mapped[str] = mapped_column(String, ForeignKey("devices.id"), primary_key=True)
    packets_sent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    packets_received: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    packets_lost: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    packet_loss_percentage: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    average_latency: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    min_latency: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_latency: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    wifi_reconnects: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    backend_failures: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    device = relationship("Device", back_populates="metrics")

class DeviceHealth(Base):
    __tablename__ = "device_health"

    device_id: Mapped[str] = mapped_column(String, ForeignKey("devices.id"), primary_key=True)
    overall_score: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    nrf_score: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    wifi_score: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    packet_score: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    backend_score: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    sensors_score: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    status_label: Mapped[str] = mapped_column(String, default="EXCELLENT", nullable=False) # EXCELLENT, GOOD, WARNING, CRITICAL
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    device = relationship("Device", back_populates="health")

class FirmwareVersion(Base):
    __tablename__ = "firmware_versions"

    version: Mapped[str] = mapped_column(String, primary_key=True) # e.g., '1.1.0'
    file_url: Mapped[str] = mapped_column(String, nullable=False)
    sha256: Mapped[str] = mapped_column(String, nullable=False) # SHA-256 hash of the binary file
    release_notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

class OtaUpdate(Base):
    __tablename__ = "ota_updates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String, ForeignKey("devices.id"), nullable=False)
    from_version: Mapped[str] = mapped_column(String, nullable=False)
    to_version: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, default="PENDING", nullable=False) # PENDING, DOWNLOADING, VERIFYING, INSTALLING, SUCCESS, FAILED, ROLLED_BACK
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Relationships
    device = relationship("Device", back_populates="ota_updates")

class OfflineBufferRecord(Base):
    __tablename__ = "offline_buffer_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String, ForeignKey("devices.id"), nullable=False)
    packet_number: Mapped[int] = mapped_column(Integer, nullable=False)
    temperature: Mapped[float] = mapped_column(Float, nullable=False)
    humidity: Mapped[float] = mapped_column(Float, nullable=False)
    motion: Mapped[bool] = mapped_column(Boolean, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

