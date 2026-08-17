import logging
import asyncio
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Any, cast
from contextlib import asynccontextmanager
import random
import math
import time

from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Request, Query, BackgroundTasks
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import desc, text
import os

from backend.app.config import settings
from backend.app.database import engine, Base, get_db, SessionLocal
from backend.app.models import (
    Device, DeviceStatus, SensorReading, MotionEvent, BlockchainRecord,
    CommunicationMetrics, DeviceHealth, FirmwareVersion, OtaUpdate, OfflineBufferRecord
)
from backend.app.schemas import (
    SensorReadingCreate, SensorReadingResponse, DeviceResponse,
    DeviceStatusResponse, MotionEventResponse, BlockchainRecordResponse,
    VerificationResponse, IngestionResponse, DeviceHeartbeat,
    CommunicationMetricsResponse, DeviceHealthResponse, FirmwareVersionCreate,
    FirmwareVersionResponse, OtaUpdateResponse, OtaTriggerResponse,
    OtaCheckResponse, OtaStatusUpdate, PublicSensorReadingResponse
)
from backend.app.security import verify_device_credentials, generate_api_key, hash_api_key
from backend.app.blockchain import (
    blockchain_client, blockchain_queue, enqueue_blockchain_record,
    blockchain_worker_loop, compute_sensor_hash, process_blockchain_record
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("api_main")

def ensure_columns():
    db = SessionLocal()
    try:
        # 1. Alter device_status to add buffer_count if missing
        try:
            db.execute(text("SELECT buffer_count FROM device_status LIMIT 1"))
        except Exception:
            logger.info("Upgrading table device_status: adding buffer_count column")
            db.execute(text("ALTER TABLE device_status ADD COLUMN buffer_count INTEGER DEFAULT 0"))
            db.commit()
            
        # 2. Alter devices to add firmware_version if missing
        try:
            db.execute(text("SELECT firmware_version FROM devices LIMIT 1"))
        except Exception:
            logger.info("Upgrading table devices: adding firmware_version column")
            db.execute(text("ALTER TABLE devices ADD COLUMN firmware_version VARCHAR DEFAULT '1.0.0'"))
            db.commit()

        # 3. Alter sensor_readings to add latency_ms if missing
        try:
            db.execute(text("SELECT latency_ms FROM sensor_readings LIMIT 1"))
        except Exception:
            logger.info("Upgrading table sensor_readings: adding latency_ms column")
            db.execute(text("ALTER TABLE sensor_readings ADD COLUMN latency_ms INTEGER NULL"))
            db.commit()

        # 4. Alter sensor_readings to add is_buffered if missing
        try:
            db.execute(text("SELECT is_buffered FROM sensor_readings LIMIT 1"))
        except Exception:
            logger.info("Upgrading table sensor_readings: adding is_buffered column")
            db.execute(text("ALTER TABLE sensor_readings ADD COLUMN is_buffered BOOLEAN DEFAULT FALSE"))
            db.commit()

        # 5. Alter sensor_readings to add captured_at if missing
        try:
            db.execute(text("SELECT captured_at FROM sensor_readings LIMIT 1"))
        except Exception:
            logger.info("Upgrading table sensor_readings: adding captured_at column")
            db.execute(text("ALTER TABLE sensor_readings ADD COLUMN captured_at TIMESTAMP NULL"))
            db.commit()

        # 6. Alter sensor_readings to add public_id if missing
        try:
            db.execute(text("SELECT public_id FROM sensor_readings LIMIT 1"))
        except Exception:
            logger.info("Upgrading table sensor_readings: adding public_id column")
            db.execute(text("ALTER TABLE sensor_readings ADD COLUMN public_id VARCHAR NULL"))
            db.commit()
            
            # Backfill public_id for existing records
            import uuid
            readings = db.query(SensorReading).filter(SensorReading.public_id == None).all()
            if readings:
                logger.info(f"Backfilling public_id for {len(readings)} existing records...")
                for r in readings:
                    r.public_id = str(uuid.uuid4())
                db.commit()
    except Exception as e:
        logger.error(f"Error performing dynamic database upgrades: {e}")
    finally:
        db.close()

def seed_database():
    db = SessionLocal()
    try:
        # Create schema tables if not exist
        Base.metadata.create_all(bind=engine)
        
        # Run dynamic column upgrades
        ensure_columns()

        default_api_key = settings.DEVICE_API_KEY or "receiver-key-super-secret-12345"
        hashed = hash_api_key(default_api_key)
        
        # Check if default device exists
        dev = db.query(Device).filter(Device.id == "receiver-01").first()
        if not dev:
            logger.info("Seeding default device 'receiver-01'...")
            new_device = Device(
                id="receiver-01",
                name="Primary ESP32 Receiver Node",
                api_key_hash=hashed,
                firmware_version="1.0.0"
            )
            db.add(new_device)
            db.commit()
            
            # Create device status
            status_entry = DeviceStatus(
                device_id="receiver-01",
                status="OFFLINE",
                wifi_status="DISCONNECTED",
                nrf_status="ERROR",
                buffer_count=0
            )
            db.add(status_entry)
            db.commit()
            logger.info(f"Default device receiver-01 seeded. API Key is: {default_api_key}")
        else:
            # Update key hash if it changed in environment
            if settings.DEVICE_API_KEY and dev.api_key_hash != hashed:
                logger.info("Updating default device 'receiver-01' API key hash from environment...")
                dev.api_key_hash = hashed
                db.commit()
                
        # Seed default firmware versions if they don't exist
        v100 = db.query(FirmwareVersion).filter(FirmwareVersion.version == "1.0.0").first()
        if not v100:
            db.add(FirmwareVersion(
                version="1.0.0",
                file_url="/static/firmware/receiver_v1.0.0.bin",
                sha256="0000000000000000000000000000000000000000000000000000000000000000",
                release_notes="Initial release firmware",
                is_active=True
            ))
            db.commit()
            
        v110 = db.query(FirmwareVersion).filter(FirmwareVersion.version == "1.1.0").first()
        if not v110:
            db.add(FirmwareVersion(
                version="1.1.0",
                file_url="/static/firmware/receiver_v1.1.0.bin",
                sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", # Dummy SHA-256 for testing
                release_notes="Feature upgrade: Secure Digital Twin, OTA, and offline buffering support",
                is_active=True
            ))
            db.commit()
            
        # Seed initial health and metrics if they don't exist
        health = db.query(DeviceHealth).filter(DeviceHealth.device_id == "receiver-01").first()
        if not health:
            db.add(DeviceHealth(
                device_id="receiver-01",
                overall_score=100,
                nrf_score=100,
                wifi_score=100,
                packet_score=100,
                backend_score=100,
                sensors_score=100,
                status_label="EXCELLENT"
            ))
            db.commit()
            
        metrics = db.query(CommunicationMetrics).filter(CommunicationMetrics.device_id == "receiver-01").first()
        if not metrics:
            db.add(CommunicationMetrics(
                device_id="receiver-01",
                packets_sent=0,
                packets_received=0,
                packets_lost=0,
                packet_loss_percentage=0.0,
                wifi_reconnects=0,
                backend_failures=0
            ))
            db.commit()
            
    except Exception as e:
        logger.error(f"Error seeding database: {e}")
    finally:
        db.close()

seed_database()


# ----------------------------------------
# WebSocket Connection Manager
# ----------------------------------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket client connected. Active: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket client disconnected. Active: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        if not self.active_connections:
            return
        
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
                
        for conn in disconnected:
            self.disconnect(conn)

manager = ConnectionManager()

# ----------------------------------------
# Background Task: Offline Device Checker
# ----------------------------------------
async def device_offline_checker_loop():
    logger.info("Device offline status checker started.")
    while True:
        db = None
        try:
            await asyncio.sleep(2)
            db = SessionLocal()
            now = datetime.now(timezone.utc)
            cutoff = now - timedelta(seconds=settings.OFFLINE_THRESHOLD_SECONDS)
            
            # Check devices marked ONLINE that haven't sent data within threshold
            online_devices = db.query(DeviceStatus).filter(
                DeviceStatus.status == "ONLINE"
            ).all()
            
            for dev_status in online_devices:
                last_seen = dev_status.last_seen
                if last_seen is not None:
                    if last_seen.tzinfo is None:
                        last_seen = last_seen.replace(tzinfo=timezone.utc)
                    
                    if last_seen < cutoff:
                        dev_status.status = "OFFLINE"
                        dev_status.wifi_status = "DISCONNECTED"
                        dev_status.nrf_status = "ERROR"
                        dev_status.updated_at = now
                        
                        # Degrading health metrics to reflect OFFLINE state
                        health_entry = db.query(DeviceHealth).filter(DeviceHealth.device_id == dev_status.device_id).first()
                        if health_entry:
                            health_entry.nrf_score = 0
                            health_entry.wifi_score = 0
                            health_entry.overall_score = 0
                            health_entry.status_label = "CRITICAL"
                            health_entry.updated_at = now
                        
                        db.commit()
                        
                        # Broadcast status update
                        last_seen_val = dev_status.last_seen
                        await manager.broadcast({
                            "type": "DEVICE_STATUS_UPDATED",
                            "data": {
                                "device_id": dev_status.device_id,
                                "status": "OFFLINE",
                                "last_seen": last_seen_val.isoformat() if last_seen_val else None,
                                "updated_at": now.isoformat(),
                                "receiver_status": "OFFLINE",
                                "wifi_status": "DISCONNECTED",
                                "nrf_status": "ERROR"
                            }
                        })
                        logger.info(f"Device '{dev_status.device_id}' marked OFFLINE due to inactivity.")
        except asyncio.CancelledError:
            logger.info("Offline checker task cancelled.")
            break
        except Exception as e:
            logger.error(f"Error in offline checker: {e}")
        finally:
            if db is not None:
                db.close()

# ----------------------------------------
# Lifespan Context Manager
# ----------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup tasks
    logger.info("App starting up. Launching background worker tasks...")
    blockchain_task = asyncio.create_task(blockchain_worker_loop())
    offline_task = asyncio.create_task(device_offline_checker_loop())
    yield
    # Shutdown tasks
    logger.info("App shutting down. Cancelling background tasks...")
    blockchain_task.cancel()
    offline_task.cancel()
    global simulator_task
    if simulator_task:
        simulator_task.cancel()
    await asyncio.gather(blockchain_task, offline_task, return_exceptions=True)

# Create FastAPI app
app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    try:
        body = await request.body()
        body_str = body.decode("utf-8", errors="ignore")
    except Exception:
        body_str = "unable to read body"
    logger.error(f"[REQUEST VALIDATION ERROR] URL: {request.url} | Body: {body_str} | Errors: {exc.errors()}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()}
    )

from starlette.exceptions import HTTPException as StarletteHTTPException

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, StarletteHTTPException):
        raise exc
    logger.exception(f"Unhandled exception during request {request.method} {request.url.path}: {exc}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": "sensor_data_processing_failed",
            "message": "Unable to process sensor data"
        }
    )

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOWED_ORIGINS,
    allow_credentials=True if "*" not in settings.CORS_ALLOWED_ORIGINS else False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------
# Custom Rate Limiter Middleware
# ----------------------------------------
import time
from collections import defaultdict

class InMemoryRateLimiter:
    def __init__(self, limit: int, window: int):
        self.limit = limit
        self.window = window
        self.requests = defaultdict(list)

    def check(self, ip: str):
        now = time.time()
        self.requests[ip] = [t for t in self.requests[ip] if now - t < self.window]
        if len(self.requests[ip]) >= self.limit:
            return False
        self.requests[ip].append(now)
        return True

rate_limiter = InMemoryRateLimiter(limit=100, window=60) # 100 requests/min per IP

@app.middleware("http")
async def rate_limiting_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.check(client_ip):
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Try again in a minute."
        )
    return await call_next(request)

# Request Size Limit Middleware (restrict payloads to max 1MB for protection)
@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    if request.method == "POST":
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > 1 * 1024 * 1024: # 1MB limit
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Payload size too large. Limit is 1MB."
            )
    return await call_next(request)

# Backend hardware simulator global state
simulator_task: Optional[asyncio.Task] = None
sim_packet_number = 1

async def run_backend_simulator_loop():
    global sim_packet_number
    logger.info("Backend simulator task started.")
    start_time = time.time()
    motion_active = False
    motion_duration = 0
    
    # Pre-seed DeviceStatus to ONLINE for receiver-01
    db_status = SessionLocal()
    try:
        status_entry = db_status.query(DeviceStatus).filter(DeviceStatus.device_id == "receiver-01").first()
        if status_entry:
            status_entry.status = "ONLINE"
            status_entry.wifi_status = "CONNECTED"
            status_entry.nrf_status = "ACTIVE"
            status_entry.last_seen = datetime.now(timezone.utc)
            db_status.commit()
    except Exception as e:
        logger.error(f"Error initializing device status for simulator: {e}")
    finally:
        db_status.close()

    while True:
        try:
            await asyncio.sleep(3.0)
            db = SessionLocal()
            try:
                elapsed = time.time() - start_time
                
                # Sinusoidal simulated measurements
                temp = 24.5 + 2.0 * math.sin(elapsed / 120.0) + random.uniform(-0.1, 0.1)
                hum = 55.0 + 5.0 * math.cos(elapsed / 180.0) + random.uniform(-0.2, 0.2)
                
                if motion_active:
                    motion_duration -= 1
                    if motion_duration <= 0:
                        motion_active = False
                else:
                    if random.random() < 0.15:
                        motion_active = True
                        motion_duration = random.randint(3, 6)

                reading_create = SensorReadingCreate(
                    device_id="receiver-01",
                    temperature=round(temp, 1),
                    humidity=round(hum, 1),
                    motion=motion_active,
                    packet_number=sim_packet_number
                )
                
                await process_and_save_sensor_data(reading_create, db)
                sim_packet_number += 1
            except Exception as ex:
                logger.error(f"Error in backend simulator iteration: {ex}")
            finally:
                db.close()
        except asyncio.CancelledError:
            logger.info("Backend simulator task cancelled.")
            break

# REST API Endpoints
# ----------------------------------------

@app.get("/health", status_code=200)
def root_health():
    """Simple root health check endpoint returning status ok."""
    return {"status": "ok"}

@app.get("/api/v1/health")
def health_check(db: Session = Depends(get_db)):
    """API health indicator, showing system statuses."""
    db_status = "healthy"
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_status = "unhealthy"

    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc),
        "database": db_status,
        "blockchain": "mock" if blockchain_client.is_mock else "connected",
        "contract_address": settings.BLOCKCHAIN_CONTRACT_ADDRESS or "not_configured"
    }

@app.get("/api/v1/debug-db")
def debug_db():
    url = settings.DATABASE_URL
    safe_url = url
    if "@" in url:
        parts = url.split("@")
        prefix = parts[0]
        if ":" in prefix:
            subparts = prefix.split(":")
            safe_url = f"{subparts[0]}:{subparts[1]}:***@{parts[1]}"
        else:
            safe_url = f"***@{parts[1]}"
    return {"database_url": safe_url}

async def update_metrics_and_health(
    device_id: str,
    db: Session,
    packet_number: Optional[int] = None,
    latency_ms: Optional[int] = None,
    is_buffered: bool = False,
    wifi_reconnects: Optional[int] = None,
    backend_failures: Optional[int] = None,
    buffer_count: Optional[int] = None,
    firmware_version: Optional[str] = None
):
    now = datetime.now(timezone.utc)
    
    # 1. Update firmware version on Device if sent
    if firmware_version:
        device = db.query(Device).filter(Device.id == device_id).first()
        if device:
            device.firmware_version = firmware_version
            db.commit()
            
    # 2. Get or create status
    status_entry = db.query(DeviceStatus).filter(DeviceStatus.device_id == device_id).first()
    if not status_entry:
        status_entry = DeviceStatus(device_id=device_id)
        db.add(status_entry)
        
    status_entry.status = "ONLINE"
    status_entry.last_seen = now
    status_entry.updated_at = now
    if buffer_count is not None:
        status_entry.buffer_count = buffer_count
        
    # Check if there is an active OTA update running
    active_ota = db.query(OtaUpdate).filter(
        OtaUpdate.device_id == device_id,
        OtaUpdate.status.in_(["DOWNLOADING", "VERIFYING", "INSTALLING"])
    ).first()
    if active_ota:
        status_entry.status = "UPDATING"

    # 3. Get or create metrics
    metrics_query = db.query(CommunicationMetrics).filter(CommunicationMetrics.device_id == device_id).first()
    metrics_record: Any
    if metrics_query is None:
        new_metrics = CommunicationMetrics(
            device_id=device_id,
            packets_sent=0,
            packets_received=0,
            packets_lost=0,
            wifi_reconnects=0,
            backend_failures=0,
            packet_loss_percentage=0.0
        )
        db.add(new_metrics)
        db.commit()
        metrics_record = cast(Any, new_metrics)
    else:
        metrics_record = cast(Any, metrics_query)
        
    if metrics_record.packets_sent is None: metrics_record.packets_sent = 0
    if metrics_record.packets_received is None: metrics_record.packets_received = 0
    if metrics_record.packets_lost is None: metrics_record.packets_lost = 0
    if metrics_record.wifi_reconnects is None: metrics_record.wifi_reconnects = 0
    if metrics_record.backend_failures is None: metrics_record.backend_failures = 0
    if metrics_record.packet_loss_percentage is None: metrics_record.packet_loss_percentage = 0.0

    if wifi_reconnects is not None:
        metrics_record.wifi_reconnects = wifi_reconnects
    if backend_failures is not None:
        metrics_record.backend_failures = backend_failures
        
    if packet_number is not None:
        # Detect packet loss
        last_packet = status_entry.last_packet_number
        if last_packet is not None and packet_number > last_packet:
            diff = packet_number - last_packet - 1
            if diff > 0:
                metrics_record.packets_lost += diff
                
        status_entry.last_packet_number = packet_number
        metrics_record.packets_received += 1
        metrics_record.packets_sent = metrics_record.packets_received + metrics_record.packets_lost
        if metrics_record.packets_sent > 0:
            metrics_record.packet_loss_percentage = (metrics_record.packets_lost / metrics_record.packets_sent) * 100
            
    # Calculate Latency stats from database readings
    if latency_ms is not None and latency_ms >= 0:
        # Recalculate average, min, max
        readings_with_latency = db.query(SensorReading).filter(
            SensorReading.device_id == device_id,
            SensorReading.latency_ms.isnot(None)
        ).order_by(desc(SensorReading.received_at)).limit(100).all()
        
        if readings_with_latency:
            latencies = [r.latency_ms for r in readings_with_latency if r.latency_ms is not None]
            if latencies:
                metrics_record.average_latency = sum(latencies) / len(latencies)
                metrics_record.min_latency = min(latencies)
                metrics_record.max_latency = max(latencies)

    metrics_record.calculated_at = now
    db.commit()

    # 4. Get or create health
    health_query = db.query(DeviceHealth).filter(DeviceHealth.device_id == device_id).first()
    health_record: Any
    if health_query is None:
        new_health = DeviceHealth(
            device_id=device_id,
            overall_score=100,
            nrf_score=100,
            wifi_score=100,
            packet_score=100,
            backend_score=100,
            sensors_score=100,
            status_label="EXCELLENT"
        )
        db.add(new_health)
        db.commit()
        health_record = new_health
    else:
        health_record = health_query
        
    # Calculate components (each max 100%)
    # NRF24 score: 100 if ACTIVE status else 0
    nrf_pct = 100 if status_entry.nrf_status == "ACTIVE" else 0
    health_record.nrf_score = nrf_pct
    
    # Wi-Fi score: deduct based on reconnects
    wifi_reconnect_cnt = metrics_record.wifi_reconnects
    wifi_pct = max(0, 100 - wifi_reconnect_cnt * 5) if status_entry.wifi_status == "CONNECTED" else 0
    health_record.wifi_score = wifi_pct
    
    # Packet loss score: 100 - loss percentage
    packet_pct = max(0.0, 100.0 - metrics_record.packet_loss_percentage)
    health_record.packet_score = int(packet_pct)
    
    # Backend score: success rate based on backend_failures
    total_attempts = metrics_record.packets_received + metrics_record.backend_failures
    backend_pct = 100.0
    if total_attempts > 0:
        backend_pct = (metrics_record.packets_received / total_attempts) * 100.0
    health_record.backend_score = int(backend_pct)
    
    # Sensors score: 100% if the last received reading values are valid
    sensors_pct = 100
    if status_entry.last_temperature is not None and status_entry.last_humidity is not None:
        temp = status_entry.last_temperature
        hum = status_entry.last_humidity
        if temp < -40.0 or temp > 80.0 or hum < 0.0 or hum > 100.0:
            sensors_pct = 0
    health_record.sensors_score = sensors_pct
    
    # Overall score: weighted average of 5 components (each 20 points)
    health_record.overall_score = int(
        (health_record.nrf_score * 0.2) +
        (health_record.wifi_score * 0.2) +
        (health_record.packet_score * 0.2) +
        (health_record.backend_score * 0.2) +
        (health_record.sensors_score * 0.2)
    )
    
    # Status label
    if health_record.overall_score >= 90:
        health_record.status_label = "EXCELLENT"
    elif health_record.overall_score >= 75:
        health_record.status_label = "GOOD"
    elif health_record.overall_score >= 50:
        health_record.status_label = "WARNING"
    else:
        health_record.status_label = "CRITICAL"
        
    health_record.updated_at = now
    db.commit()

    # 5. Broadcast all updates to WebSockets
    await manager.broadcast({
        "type": "DEVICE_STATUS_UPDATED",
        "data": {
            "device_id": status_entry.device_id,
            "status": status_entry.status,
            "last_seen": status_entry.last_seen.isoformat() if status_entry.last_seen else None,
            "last_packet_number": status_entry.last_packet_number,
            "last_temperature": status_entry.last_temperature,
            "last_humidity": status_entry.last_humidity,
            "last_motion": status_entry.last_motion,
            "wifi_status": status_entry.wifi_status,
            "nrf_status": status_entry.nrf_status,
            "buffer_count": status_entry.buffer_count,
            "updated_at": status_entry.updated_at.isoformat(),
            "receiver_status": status_entry.status
        }
    })
    
    await manager.broadcast({
        "type": "DEVICE_HEALTH_UPDATED",
        "data": {
            "device_id": health_record.device_id,
            "overall_score": health_record.overall_score,
            "nrf_score": health_record.nrf_score,
            "wifi_score": health_record.wifi_score,
            "packet_score": health_record.packet_score,
            "backend_score": health_record.backend_score,
            "sensors_score": health_record.sensors_score,
            "status_label": health_record.status_label,
            "updated_at": health_record.updated_at.isoformat()
        }
    })
    
    await manager.broadcast({
        "type": "COMMUNICATION_METRICS_UPDATED",
        "data": {
            "device_id": metrics_record.device_id,
            "packets_sent": metrics_record.packets_sent,
            "packets_received": metrics_record.packets_received,
            "packets_lost": metrics_record.packets_lost,
            "packet_loss_percentage": metrics_record.packet_loss_percentage,
            "average_latency": metrics_record.average_latency,
            "min_latency": metrics_record.min_latency,
            "max_latency": metrics_record.max_latency,
            "wifi_reconnects": metrics_record.wifi_reconnects,
            "backend_failures": metrics_record.backend_failures,
            "calculated_at": metrics_record.calculated_at.isoformat()
        }
    })

async def process_and_save_sensor_data(
    reading: SensorReadingCreate,
    db: Session,
    background_tasks: Optional[BackgroundTasks] = None
) -> IngestionResponse:
    now = datetime.now(timezone.utc)
    
    # Calculate latency
    latency_ms = None
    if reading.received_at_ms and reading.received_at_ms > 0:
        latency_ms = int(time.time() * 1000) - reading.received_at_ms
        if latency_ms < 0 or latency_ms > 10000:  # Filter clock drift anomalies
            latency_ms = None

    # Handle buffered vs live received timestamp
    received_at = reading.captured_at if (reading.is_buffered and reading.captured_at) else now
    # Ensure timezone info
    if received_at.tzinfo is None:
        received_at = received_at.replace(tzinfo=timezone.utc)

    logger.info(
        f"[RECEIVER DATA]\n"
        f"device={reading.device_id}\n"
        f"packet={reading.packet_number}\n"
        f"temperature={reading.temperature:.2f}\n"
        f"humidity={reading.humidity:.2f}\n"
        f"motion={str(reading.motion).lower()}\n"
        f"is_buffered={reading.is_buffered}\n"
        f"latency_ms={latency_ms}"
    )
    
    # 1. Check for duplicate packets (device_id + packet_number)
    existing_reading = db.query(SensorReading).filter(
        SensorReading.device_id == reading.device_id,
        SensorReading.packet_number == reading.packet_number
    ).first()
    
    if existing_reading:
        msg = f"Duplicate packet: Packet number {reading.packet_number} already ingested."
        logger.error(f"[RECEIVER DATA ERROR] device={reading.device_id} packet={reading.packet_number} reason={msg}")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=msg
        )

    # 2. Process Motion Event State Machine
    latest_reading = db.query(SensorReading).filter(
        SensorReading.device_id == reading.device_id
    ).order_by(desc(SensorReading.received_at)).first()

    prev_motion = latest_reading.motion if latest_reading else False
    current_motion = reading.motion

    if not prev_motion and current_motion:
        # State transition: Motion started
        new_event = MotionEvent(
            device_id=reading.device_id,
            event_type="MOTION",
            detected_at=received_at,
            cleared_at=None
        )
        db.add(new_event)
        db.commit()
        await manager.broadcast({
            "type": "MOTION_EVENT_STARTED",
            "data": {
                "device_id": reading.device_id,
                "detected_at": received_at.isoformat()
            }
        })
        
    elif prev_motion and not current_motion:
        # State transition: Motion cleared
        active_event = db.query(MotionEvent).filter(
            MotionEvent.device_id == reading.device_id,
            MotionEvent.cleared_at == None
        ).order_by(desc(MotionEvent.detected_at)).first()

        if active_event:
            active_event.cleared_at = received_at
            db.commit()
            await manager.broadcast({
                "type": "MOTION_EVENT_CLEARED",
                "data": {
                    "id": active_event.id,
                    "device_id": reading.device_id,
                    "detected_at": active_event.detected_at.isoformat(),
                    "cleared_at": received_at.isoformat()
                }
            })

    # 3. Save Sensor Reading
    import uuid
    db_reading = SensorReading(
        device_id=reading.device_id,
        temperature=reading.temperature,
        humidity=reading.humidity,
        motion=reading.motion,
        packet_number=reading.packet_number,
        latency_ms=latency_ms,
        is_buffered=reading.is_buffered,
        captured_at=reading.captured_at,
        received_at=received_at,
        public_id=str(uuid.uuid4())
    )
    db.add(db_reading)
    db.commit()
    db.refresh(db_reading)

    # Log Offline Buffer Records if it's buffered
    if reading.is_buffered:
        buf_rec = OfflineBufferRecord(
            device_id=reading.device_id,
            packet_number=reading.packet_number,
            temperature=reading.temperature,
            humidity=reading.humidity,
            motion=reading.motion,
            captured_at=reading.captured_at or received_at
        )
        db.add(buf_rec)
        db.commit()

    # 4. Update Device Status, Metrics and Health
    status_entry = db.query(DeviceStatus).filter(DeviceStatus.device_id == reading.device_id).first()
    if not status_entry:
        status_entry = DeviceStatus(device_id=reading.device_id)
        db.add(status_entry)
        
    status_entry.last_temperature = reading.temperature
    status_entry.last_humidity = reading.humidity
    status_entry.last_motion = reading.motion
    status_entry.wifi_status = "CONNECTED"
    status_entry.nrf_status = "ACTIVE"
    db.commit()

    # Recalculate metrics and health (includes broadcasting via WebSockets)
    await update_metrics_and_health(
        device_id=reading.device_id,
        db=db,
        packet_number=reading.packet_number,
        latency_ms=latency_ms,
        is_buffered=bool(reading.is_buffered),
        wifi_reconnects=reading.wifi_reconnects,
        backend_failures=reading.backend_failures,
        buffer_count=reading.buffer_count,
        firmware_version=reading.firmware_version
    )

    # 5. Generate Deterministic Cryptographic Hash
    blockchain_status = "PENDING"
    try:
        data_hash = compute_sensor_hash(
            device_id=db_reading.device_id,
            temperature=db_reading.temperature,
            humidity=db_reading.humidity,
            motion=db_reading.motion,
            packet_number=db_reading.packet_number,
            received_at=db_reading.received_at
        )

        # 6. Create Blockchain Record
        bc_record = BlockchainRecord(
            sensor_record_id=db_reading.id,
            device_id=db_reading.device_id,
            data_hash=data_hash,
            transaction_hash=None,
            block_number=None,
            network="hardhat" if blockchain_client.is_mock else "polygon",
            contract_address=settings.BLOCKCHAIN_CONTRACT_ADDRESS or "mock_address",
            recorded_at=None,
            verification_status="PENDING"
        )
        db.add(bc_record)
        db.commit()
        db.refresh(bc_record)

        # 7. Queue for Asynchronous Blockchain submission
        if background_tasks is not None:
            background_tasks.add_task(process_blockchain_record, bc_record.id)
        else:
            await enqueue_blockchain_record(bc_record.id)
    except Exception as bc_err:
        logger.error(f"Error enqueuing blockchain registration for reading {db_reading.id}: {bc_err}")
        db.rollback()
        blockchain_status = "FAILED"

    # 8. Broadcast Sensor Reading to WebSocket UI Clients
    await manager.broadcast({
        "type": "SENSOR_READING_RECEIVED",
        "data": {
            "id": db_reading.id,
            "device_id": db_reading.device_id,
            "temperature": db_reading.temperature,
            "humidity": db_reading.humidity,
            "motion": db_reading.motion,
            "packet_number": db_reading.packet_number,
            "latency_ms": db_reading.latency_ms,
            "is_buffered": db_reading.is_buffered,
            "captured_at": db_reading.captured_at.isoformat() if db_reading.captured_at else None,
            "received_at": db_reading.received_at.isoformat(),
            "blockchain_status": blockchain_status
        }
    })

    return IngestionResponse(success=True)

@app.post("/api/v1/sensor-data", response_model=IngestionResponse, status_code=201)
async def ingest_sensor_data(
    reading: SensorReadingCreate,
    background_tasks: BackgroundTasks,
    device: Device = Depends(verify_device_credentials),
    db: Session = Depends(get_db)
):
    """
    Ingest environment and motion data from ESP32 receivers.
    Verifies authentication header, checks duplicates, updates status,
    evaluates motion changes, writes sensor records, and schedules blockchain registry.
    """
    return await process_and_save_sensor_data(reading, db, background_tasks)

@app.get("/api/v1/sensor-data/latest", response_model=Optional[SensorReadingResponse])
def get_latest_sensor_data(
    device_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Retrieve the latest valid sensor reading."""
    query = db.query(SensorReading)
    if device_id:
        query = query.filter(SensorReading.device_id == device_id)
    
    latest = query.order_by(desc(SensorReading.received_at)).first()
    return latest

@app.get("/api/v1/sensor-data/history", response_model=List[SensorReadingResponse])
def get_sensor_data_history(
    device_id: Optional[str] = None,
    duration: Optional[str] = Query("1h", description="Duration: 1h, 6h, 24h, 7d, 30d"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    """Retrieve historical sensor readings with pagination and duration filters."""
    query = db.query(SensorReading)
    if device_id:
        query = query.filter(SensorReading.device_id == device_id)

    # Time Duration Filter
    now = datetime.now(timezone.utc)
    if duration == "1h":
        query = query.filter(SensorReading.received_at >= now - timedelta(hours=1))
    elif duration == "6h":
        query = query.filter(SensorReading.received_at >= now - timedelta(hours=6))
    elif duration == "24h":
        query = query.filter(SensorReading.received_at >= now - timedelta(days=1))
    elif duration == "7d":
        query = query.filter(SensorReading.received_at >= now - timedelta(days=7))
    elif duration == "30d":
        query = query.filter(SensorReading.received_at >= now - timedelta(days=30))

    readings = query.order_by(desc(SensorReading.received_at)).offset(offset).limit(limit).all()
    return readings

@app.get("/api/v1/sensor-data/{record_id}", response_model=PublicSensorReadingResponse)
async def get_public_sensor_data(
    record_id: str,
    db: Session = Depends(get_db)
):
    """
    Retrieve public sensor reading by its public secure record ID (UUID).
    Checks database integrity and queries Polygon smart contract for confirmation.
    """
    # 1. Fetch reading by public_id
    reading = db.query(SensorReading).filter(SensorReading.public_id == record_id).first()
    if not reading:
        raise HTTPException(status_code=404, detail="Sensor reading record not found")

    # 2. Fetch associated device firmware
    device = db.query(Device).filter(Device.id == reading.device_id).first()
    firmware_version = f"v{device.firmware_version}" if device else "v1.0.0"

    # 3. Fetch device health
    health = db.query(DeviceHealth).filter(DeviceHealth.device_id == reading.device_id).first()
    device_health = health.overall_score if health else 100

    # 4. Fetch device statuses
    status_entry = db.query(DeviceStatus).filter(DeviceStatus.device_id == reading.device_id).first()
    nrf_status = status_entry.nrf_status if status_entry else "ERROR"
    wifi_status = status_entry.wifi_status if status_entry else "DISCONNECTED"

    # Translate NRF status "ACTIVE" to "CONNECTED"
    nrf_label = "CONNECTED" if nrf_status == "ACTIVE" else "DISCONNECTED"
    wifi_label = "CONNECTED" if wifi_status == "CONNECTED" else "DISCONNECTED"

    # 5. Fetch metrics for packet loss
    metrics = db.query(CommunicationMetrics).filter(CommunicationMetrics.device_id == reading.device_id).first()
    packet_loss_percentage = metrics.packet_loss_percentage if metrics else 0.0

    # 6. Fetch blockchain record and verify integrity
    bc_record = db.query(BlockchainRecord).filter(BlockchainRecord.sensor_record_id == reading.id).first()
    
    blockchain_status = "UNAVAILABLE"
    data_hash = None
    if bc_record:
        # Calculate local hash to check database tampering
        local_hash = compute_sensor_hash(
            device_id=reading.device_id,
            temperature=reading.temperature,
            humidity=reading.humidity,
            motion=reading.motion,
            packet_number=reading.packet_number,
            received_at=reading.received_at
        )
        
        if bc_record.data_hash != local_hash:
            blockchain_status = "INTEGRITY_FAILURE"
        else:
            # Query blockchain verification state
            try:
                status_state, chain_hash, block_num = await blockchain_client.verify_hash_on_chain(
                    device_id=reading.device_id,
                    packet_number=reading.packet_number,
                    computed_hash=local_hash
                )
                blockchain_status = status_state
            except Exception:
                blockchain_status = "PENDING"
        data_hash = bc_record.data_hash

    return PublicSensorReadingResponse(
        record_id=reading.public_id or "",
        device_id=reading.device_id,
        packet_number=reading.packet_number,
        temperature=reading.temperature,
        humidity=reading.humidity,
        motion=reading.motion,
        timestamp=reading.received_at,
        latency_ms=reading.latency_ms,
        is_buffered=reading.is_buffered,
        firmware_version=firmware_version,
        device_health=device_health,
        nrf_status=nrf_label,
        wifi_status=wifi_label,
        packet_loss_percentage=packet_loss_percentage,
        blockchain_status=blockchain_status,
        hash=data_hash
    )

@app.get("/api/v1/devices", response_model=List[DeviceResponse])
def list_devices(db: Session = Depends(get_db)):
    """List all registered devices."""
    return db.query(Device).all()

@app.get("/api/v1/devices/{device_id}", response_model=DeviceResponse)
def get_device(device_id: str, db: Session = Depends(get_db)):
    """Get details of a specific device."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail=f"Device '{device_id}' not found")
    return device

@app.get("/api/v1/devices/{device_id}/status", response_model=DeviceStatusResponse)
def get_device_status(device_id: str, db: Session = Depends(get_db)):
    """Retrieve real-time online/offline status and metric cache for a device."""
    dev_status = db.query(DeviceStatus).filter(DeviceStatus.device_id == device_id).first()
    if not dev_status:
        raise HTTPException(status_code=404, detail=f"Status cache for device '{device_id}' not found")
    
    # Dynamically check offline threshold (crucial for serverless environments where checker loop is frozen)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=settings.OFFLINE_THRESHOLD_SECONDS)
    last_seen = dev_status.last_seen
    if last_seen is not None:
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        if last_seen < cutoff:
            is_updated = False
            if dev_status.status != "OFFLINE":
                dev_status.status = "OFFLINE"
                dev_status.wifi_status = "DISCONNECTED"
                dev_status.nrf_status = "ERROR"
                dev_status.updated_at = now
                is_updated = True
                
            health_entry = db.query(DeviceHealth).filter(DeviceHealth.device_id == device_id).first()
            if health_entry and health_entry.overall_score != 0:
                health_entry.nrf_score = 0
                health_entry.wifi_score = 0
                health_entry.overall_score = 0
                health_entry.status_label = "CRITICAL"
                health_entry.updated_at = now
                is_updated = True
                
            if is_updated:
                db.commit()
                db.refresh(dev_status)
                
    return dev_status

@app.get("/api/v1/motion-events", response_model=List[MotionEventResponse])
def get_motion_events(
    device_id: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    """Retrieve motion events list, paginated."""
    query = db.query(MotionEvent)
    if device_id:
        query = query.filter(MotionEvent.device_id == device_id)
    return query.order_by(desc(MotionEvent.detected_at)).offset(offset).limit(limit).all()

@app.get("/api/v1/blockchain/verify/{record_id}", response_model=VerificationResponse)
async def verify_sensor_integrity(
    record_id: int,
    db: Session = Depends(get_db)
):
    """
    Validates physical sensor record integrity.
    Re-calculates the local SHA-256 hash and queries the Polygon contract
    to confirm if the hashes match. Flags database tampering instantly.
    """
    reading = db.query(SensorReading).filter(SensorReading.id == record_id).first()
    if not reading:
        raise HTTPException(status_code=404, detail="Sensor reading record not found")

    bc_record = db.query(BlockchainRecord).filter(BlockchainRecord.sensor_record_id == record_id).first()
    if not bc_record:
        raise HTTPException(status_code=404, detail="Blockchain registration metadata not found for this reading")

    # 1. Recalculate local hash
    local_hash = compute_sensor_hash(
        device_id=reading.device_id,
        temperature=reading.temperature,
        humidity=reading.humidity,
        motion=reading.motion,
        packet_number=reading.packet_number,
        received_at=reading.received_at
    )

    # 2. Query blockchain
    status_state, chain_hash, block_num = await blockchain_client.verify_hash_on_chain(
        device_id=reading.device_id,
        packet_number=reading.packet_number,
        computed_hash=local_hash
    )

    # Compare local hash to database record (has database itself been edited/tampered?)
    if bc_record.data_hash != local_hash:
        status_state = "INTEGRITY_FAILURE"
        msg = "INTEGRITY FAILURE: Database values have been tampered! The computed reading hash does not match the database-stored hash."
    elif status_state == "VERIFIED":
        msg = "VERIFIED: Cryptographic proof confirmed. Recalculated hash matches contract-stored hash on-chain."
    elif status_state == "NOT_REGISTERED":
        msg = "NOT REGISTERED: No hash record exists on-chain for this packet number."
    elif status_state == "PENDING":
        msg = "PENDING: Registry transaction is currently in queue or awaiting blockchain block mining confirmation."
    else:
        msg = f"INTEGRITY FAILURE: Local hash does not match the value retrieved from the smart contract ({chain_hash})."
        status_state = "INTEGRITY_FAILURE"

    # Update verification status in DB if needed
    if bc_record.verification_status != status_state:
        bc_record.verification_status = status_state
        if block_num:
            bc_record.block_number = block_num
        db.commit()

    return VerificationResponse(
        record_id=record_id,
        device_id=reading.device_id,
        packet_number=reading.packet_number,
        computed_hash="0x" + local_hash,
        blockchain_hash=chain_hash,
        transaction_hash=bc_record.transaction_hash,
        block_number=block_num or bc_record.block_number,
        network=bc_record.network,
        verification_status=status_state,
        message=msg,
        timestamp=datetime.now(timezone.utc)
    )

@app.post("/api/v1/devices/heartbeat", status_code=200)
async def device_heartbeat(
    heartbeat: DeviceHeartbeat,
    device: Device = Depends(verify_device_credentials),
    db: Session = Depends(get_db)
):
    """
    Heartbeat endpoint for the receiver to update network/link status.
    Updates the DeviceStatus table cache, recalculates metrics and health, and broadcasts.
    """
    now = datetime.now(timezone.utc)
    status_entry = db.query(DeviceStatus).filter(DeviceStatus.device_id == heartbeat.device_id).first()
    if not status_entry:
        status_entry = DeviceStatus(device_id=heartbeat.device_id)
        db.add(status_entry)
        
    status_entry.status = "ONLINE"
    status_entry.last_seen = now
    status_entry.wifi_status = heartbeat.wifi_status
    status_entry.nrf_status = heartbeat.nrf_status
    status_entry.updated_at = now
    db.commit()
    
    # Recalculate metrics and health
    await update_metrics_and_health(
        device_id=heartbeat.device_id,
        db=db,
        wifi_reconnects=heartbeat.wifi_reconnects,
        backend_failures=heartbeat.backend_failures,
        buffer_count=heartbeat.buffer_count,
        firmware_version=heartbeat.firmware_version
    )
    return {"success": True}

@app.get("/api/v1/devices/{device_id}/health", response_model=DeviceHealthResponse)
def get_device_health(device_id: str, db: Session = Depends(get_db)):
    """Retrieve the dynamic health score of a device."""
    dev_status = db.query(DeviceStatus).filter(DeviceStatus.device_id == device_id).first()
    if dev_status:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=settings.OFFLINE_THRESHOLD_SECONDS)
        last_seen = dev_status.last_seen
        if last_seen is not None:
            if last_seen.tzinfo is None:
                last_seen = last_seen.replace(tzinfo=timezone.utc)
            if last_seen < cutoff:
                is_updated = False
                if dev_status.status != "OFFLINE":
                    dev_status.status = "OFFLINE"
                    dev_status.wifi_status = "DISCONNECTED"
                    dev_status.nrf_status = "ERROR"
                    dev_status.updated_at = now
                    is_updated = True
                
                health_entry = db.query(DeviceHealth).filter(DeviceHealth.device_id == device_id).first()
                if health_entry and health_entry.overall_score != 0:
                    health_entry.nrf_score = 0
                    health_entry.wifi_score = 0
                    health_entry.overall_score = 0
                    health_entry.status_label = "CRITICAL"
                    health_entry.updated_at = now
                    is_updated = True
                    
                if is_updated:
                    db.commit()

    health = db.query(DeviceHealth).filter(DeviceHealth.device_id == device_id).first()
    if not health:
        raise HTTPException(status_code=404, detail=f"Health metrics for device '{device_id}' not found")
    return health

@app.get("/api/v1/devices/{device_id}/metrics", response_model=CommunicationMetricsResponse)
def get_device_communication_metrics(device_id: str, db: Session = Depends(get_db)):
    """Retrieve the communication metrics and statistics for a device."""
    metrics = db.query(CommunicationMetrics).filter(CommunicationMetrics.device_id == device_id).first()
    if not metrics:
        raise HTTPException(status_code=404, detail=f"Communication metrics for device '{device_id}' not found")
    return metrics

@app.get("/api/v1/devices/{device_id}/ota/check", response_model=OtaCheckResponse)
def check_device_ota(device_id: str, request: Request, db: Session = Depends(get_db)):
    """Checks if there is a pending firmware update triggered for the device."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
        
    # Find a pending update for this device
    pending_update = db.query(OtaUpdate).filter(
        OtaUpdate.device_id == device_id,
        OtaUpdate.status == "PENDING"
    ).order_by(desc(OtaUpdate.started_at)).first()
    
    if not pending_update:
        return OtaCheckResponse(ota_pending=False)
        
    # Get firmware details
    fw = db.query(FirmwareVersion).filter(
        FirmwareVersion.version == pending_update.to_version,
        FirmwareVersion.is_active == True
    ).first()
    
    if not fw:
        return OtaCheckResponse(ota_pending=False)
        
    # Build absolute file url
    base = str(request.base_url)
    relative_url = fw.file_url
    if relative_url.startswith("/"):
        relative_url = relative_url[1:]
    abs_url = f"{base}{relative_url}"
    
    return OtaCheckResponse(
        ota_pending=True,
        ota_url=abs_url,
        ota_version=fw.version,
        ota_sha256=fw.sha256,
        update_id=pending_update.id
    )

@app.post("/api/v1/devices/{device_id}/ota/trigger", response_model=OtaTriggerResponse)
def trigger_device_ota(device_id: str, db: Session = Depends(get_db)):
    """Triggers an OTA update for the device to the latest active firmware version."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
        
    # Find latest active firmware version
    latest_fw = db.query(FirmwareVersion).filter(FirmwareVersion.is_active == True).order_by(desc(FirmwareVersion.created_at)).first()
    if not latest_fw:
        raise HTTPException(status_code=404, detail="No active firmware versions registered")
        
    if latest_fw.version == device.firmware_version:
        raise HTTPException(status_code=400, detail=f"Device is already on the latest version {latest_fw.version}")
        
    # Check if there is an update already active/pending
    existing = db.query(OtaUpdate).filter(
        OtaUpdate.device_id == device_id,
        OtaUpdate.status.in_(["PENDING", "DOWNLOADING", "VERIFYING", "INSTALLING"])
    ).first()
    
    if existing:
        return OtaTriggerResponse(
            success=True,
            update_id=existing.id,
            message=f"OTA update to v{existing.to_version} is already in state: {existing.status}"
        )
        
    # Create new OTA Update record
    new_update = OtaUpdate(
        device_id=device_id,
        from_version=device.firmware_version,
        to_version=latest_fw.version,
        status="PENDING",
        progress=0
    )
    db.add(new_update)
    db.commit()
    db.refresh(new_update)
    
    # Broadcast to frontend
    asyncio.create_task(manager.broadcast({
        "type": "OTA_STATUS_UPDATED",
        "data": {
            "device_id": device_id,
            "status": "PENDING",
            "progress": 0,
            "from_version": new_update.from_version,
            "to_version": new_update.to_version,
            "update_id": new_update.id
        }
    }))
    
    return OtaTriggerResponse(
        success=True,
        update_id=new_update.id,
        message=f"OTA update to v{latest_fw.version} triggered successfully."
    )

@app.post("/api/v1/devices/{device_id}/ota/status", response_model=IngestionResponse)
async def update_device_ota_status(
    device_id: str,
    status_update: OtaStatusUpdate,
    db: Session = Depends(get_db)
):
    """Updates the status and progress of an active OTA update."""
    update_id = status_update.update_id
    query = db.query(OtaUpdate).filter(OtaUpdate.device_id == device_id)
    if update_id:
        query = query.filter(OtaUpdate.id == update_id)
    else:
        query = query.filter(OtaUpdate.status.in_(["PENDING", "DOWNLOADING", "VERIFYING", "INSTALLING"]))
        
    active_update = query.order_by(desc(OtaUpdate.started_at)).first()
    if not active_update:
        raise HTTPException(status_code=404, detail="No active OTA update found for this device")
        
    active_update.status = status_update.status
    active_update.progress = status_update.progress
    if status_update.error_message:
        active_update.error_message = status_update.error_message
        
    if status_update.status in ["SUCCESS", "FAILED"]:
        active_update.completed_at = datetime.now(timezone.utc)
        
    db.commit()
    
    # If successful, update the device's firmware version
    if status_update.status == "SUCCESS":
        device = db.query(Device).filter(Device.id == device_id).first()
        if device:
            device.firmware_version = active_update.to_version
            db.commit()
            
    # Update device status twin label
    status_entry = db.query(DeviceStatus).filter(DeviceStatus.device_id == device_id).first()
    if status_entry:
        if status_update.status in ["DOWNLOADING", "VERIFYING", "INSTALLING"]:
            status_entry.status = "UPDATING"
        elif status_update.status == "SUCCESS":
            status_entry.status = "ONLINE"
        else:
            status_entry.status = "ONLINE" # default back on failure
        db.commit()
        
    # Broadcast to frontend
    await manager.broadcast({
        "type": "OTA_STATUS_UPDATED",
        "data": {
            "device_id": device_id,
            "status": active_update.status,
            "progress": active_update.progress,
            "from_version": active_update.from_version,
            "to_version": active_update.to_version,
            "update_id": active_update.id,
            "error_message": active_update.error_message
        }
    })
    
    return IngestionResponse(success=True)

@app.get("/api/v1/devices/{device_id}/ota/status")
def get_device_ota_status(device_id: str, db: Session = Depends(get_db)):
    """Retrieve the status and progress of the latest OTA update for the device."""
    latest_update = db.query(OtaUpdate).filter(OtaUpdate.device_id == device_id).order_by(desc(OtaUpdate.started_at)).first()
    if not latest_update:
        return {
            "device_id": device_id,
            "status": "IDLE",
            "progress": 0,
            "from_version": "",
            "to_version": "",
            "error_message": None
        }
    return {
        "device_id": device_id,
        "status": latest_update.status,
        "progress": latest_update.progress,
        "from_version": latest_update.from_version,
        "to_version": latest_update.to_version,
        "update_id": latest_update.id,
        "error_message": latest_update.error_message
    }

@app.post("/api/v1/firmware/release", response_model=FirmwareVersionResponse)
def release_firmware_version(
    fw_create: FirmwareVersionCreate,
    db: Session = Depends(get_db)
):
    """Registers a new firmware version release in the system."""
    existing = db.query(FirmwareVersion).filter(FirmwareVersion.version == fw_create.version).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Firmware version {fw_create.version} already registered")
        
    new_fw = FirmwareVersion(
        version=fw_create.version,
        file_url=fw_create.file_url,
        sha256=fw_create.sha256,
        release_notes=fw_create.release_notes,
        is_active=fw_create.is_active
    )
    db.add(new_fw)
    db.commit()
    db.refresh(new_fw)
    return new_fw

@app.get("/api/v1/firmware/latest", response_model=FirmwareVersionResponse)
def get_latest_firmware(db: Session = Depends(get_db)):
    """Retrieve the latest registered firmware version."""
    latest = db.query(FirmwareVersion).filter(FirmwareVersion.is_active == True).order_by(desc(FirmwareVersion.created_at)).first()
    if not latest:
        raise HTTPException(status_code=404, detail="No active firmware versions found")
    return latest

@app.get("/api/v1/firmware/{version}", response_model=FirmwareVersionResponse)
def get_firmware_by_version(version: str, db: Session = Depends(get_db)):
    """Retrieve a specific registered firmware version details."""
    fw = db.query(FirmwareVersion).filter(FirmwareVersion.version == version).first()
    if not fw:
        raise HTTPException(status_code=404, detail=f"Firmware version {version} not found")
    return fw

@app.post("/api/v1/devices/{device_id}/ota", response_model=OtaTriggerResponse)
def trigger_device_ota_legacy(device_id: str, db: Session = Depends(get_db)):
    """Wrapper endpoint for triggering an OTA update to the latest active version."""
    return trigger_device_ota(device_id=device_id, db=db)

@app.get("/static/firmware/{filename}")
def serve_firmware_file(filename: str):
    """Serves the firmware binary file securely via FileResponse."""
    static_dir = "backend/static/firmware"
    file_path = os.path.join(static_dir, filename)
    if not os.path.exists(file_path):
        os.makedirs(static_dir, exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(b"THIS IS DUMMY FIRMWARE VERSION BINARY FOR TESTING OTA UPDATE PIPELINE SUCCESS AND ROLLBACK FUNCTIONALITY")
    return FileResponse(file_path, media_type="application/octet-stream", filename=filename)

@app.post("/api/v1/blockchain/tamper/{record_id}", status_code=200)
async def tamper_sensor_reading(record_id: int, db: Session = Depends(get_db)):
    """
    Manually tampers with a database record's temperature to 99.9°C.
    Used for demonstrating blockchain integrity failure verification.
    """
    reading = db.query(SensorReading).filter(SensorReading.id == record_id).first()
    if not reading:
        raise HTTPException(status_code=404, detail="Sensor reading record not found")
        
    reading.temperature = 99.9
    db.commit()
    db.refresh(reading)
    
    # Broadcast to WS clients to update graphs and dashboard state
    await manager.broadcast({
        "type": "SENSOR_READING_RECEIVED",  # Treat as a new/updated reading to update the dashboard instantly
        "data": {
            "id": reading.id,
            "device_id": reading.device_id,
            "temperature": reading.temperature,
            "humidity": reading.humidity,
            "motion": reading.motion,
            "packet_number": reading.packet_number,
            "received_at": reading.received_at.isoformat(),
            "blockchain_status": "INTEGRITY_FAILURE"
        }
    })
    
    return {"success": True, "message": f"Database record #{record_id} tampered successfully. Temperature set to 99.9°C."}

@app.post("/api/v1/simulator/start", status_code=200)
async def start_simulator():
    """Starts the backend simulated hardware data stream."""
    global simulator_task
    if simulator_task and not simulator_task.done():
        return {"success": True, "status": "running", "message": "Simulator is already running."}
        
    simulator_task = asyncio.create_task(run_backend_simulator_loop())
    return {"success": True, "status": "started", "message": "Simulator started."}

@app.post("/api/v1/simulator/stop", status_code=200)
async def stop_simulator():
    """Stops the backend simulated hardware data stream."""
    global simulator_task
    if not simulator_task or simulator_task.done():
        return {"success": True, "status": "stopped", "message": "Simulator is not running."}
        
    simulator_task.cancel()
    simulator_task = None
    
    # Re-mark device as OFFLINE
    db = SessionLocal()
    try:
        status_entry = db.query(DeviceStatus).filter(DeviceStatus.device_id == "receiver-01").first()
        if status_entry:
            status_entry.status = "OFFLINE"
            status_entry.wifi_status = "DISCONNECTED"
            status_entry.nrf_status = "ERROR"
            status_entry.updated_at = datetime.now(timezone.utc)
            db.commit()
            
            last_seen_val = status_entry.last_seen
            await manager.broadcast({
                "type": "DEVICE_STATUS_UPDATED",
                "data": {
                    "device_id": "receiver-01",
                    "status": "OFFLINE",
                    "last_seen": last_seen_val.isoformat() if last_seen_val else None,
                    "updated_at": status_entry.updated_at.isoformat(),
                    "receiver_status": "OFFLINE",
                    "wifi_status": "DISCONNECTED",
                    "nrf_status": "ERROR"
                }
            })
    except Exception as e:
        logger.error(f"Error resetting status on simulator stop: {e}")
    finally:
        db.close()
        
    return {"success": True, "status": "stopped", "message": "Simulator stopped."}

@app.get("/api/v1/simulator/status", status_code=200)
def get_simulator_status():
    """Gets current status of backend simulator."""
    global simulator_task
    is_running = simulator_task is not None and not simulator_task.done()
    return {"running": is_running}

# ----------------------------------------
# WebSockets Endpoint
# ----------------------------------------
@app.websocket("/ws")
@app.websocket("/ws/sensor-data")
async def websocket_endpoint(websocket: WebSocket):
    """Establishes real-time connection to broadcast IoT events to React Dashboard."""
    await manager.connect(websocket)
    try:
        # Keep connection alive, listen for any client messages
        while True:
            # We just wait for incoming text, ignore it, keeping connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket connection error: {e}")
        manager.disconnect(websocket)
