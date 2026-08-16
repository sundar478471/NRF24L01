import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.main import app, get_db
from backend.app.database import Base
from backend.app.models import Device, DeviceStatus, SensorReading, MotionEvent, BlockchainRecord
from backend.app.security import hash_api_key, generate_api_key
from backend.app.blockchain import blockchain_client

# Force mock mode for unit tests to ensure isolation
blockchain_client.is_mock = True

# ----------------------------------------
# Test Database Setup
# ----------------------------------------
from sqlalchemy.pool import StaticPool

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Dependency override
def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

# Helper setup
TEST_DEVICE_ID = "test-receiver-01"
TEST_API_KEY = "test-secret-api-key-12345678"

@pytest.fixture(autouse=True)
def setup_db():
    # Create tables
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    
    # Seed test device
    hashed_key = hash_api_key(TEST_API_KEY)
    dev = Device(id=TEST_DEVICE_ID, name="Test Receiver Device", api_key_hash=hashed_key)
    db.add(dev)
    
    dev_status = DeviceStatus(device_id=TEST_DEVICE_ID, status="OFFLINE")
    db.add(dev_status)
    
    db.commit()
    yield
    # Drop tables
    Base.metadata.drop_all(bind=engine)

# ----------------------------------------
# API Test Cases
# ----------------------------------------

def test_health_check():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["database"] == "healthy"

def test_unauthorized_sensor_ingestion():
    # Ingest without API key header
    payload = {
        "device_id": TEST_DEVICE_ID,
        "temperature": 25.0,
        "humidity": 50.0,
        "motion": False,
        "packet_number": 1
    }
    response = client.post("/api/v1/sensor-data", json=payload)
    assert response.status_code == 401
    assert "X-Device-API-Key" in response.json()["detail"]

    # Ingest with wrong API key
    headers = {"X-Device-API-Key": "wrong-key-value"}
    response = client.post("/api/v1/sensor-data", json=payload, headers=headers)
    assert response.status_code == 403
    assert "Invalid device credentials" in response.json()["detail"]

def test_invalid_sensor_data_ranges():
    headers = {"X-Device-API-Key": TEST_API_KEY}
    
    # 1. Invalid temperature high (DHT22 max is 80)
    payload = {
        "device_id": TEST_DEVICE_ID,
        "temperature": 85.0,
        "humidity": 50.0,
        "motion": False,
        "packet_number": 1
    }
    response = client.post("/api/v1/sensor-data", json=payload, headers=headers)
    assert response.status_code == 422 # Pydantic validation error

    # 2. Invalid humidity (negative)
    payload["temperature"] = 20.0
    payload["humidity"] = -5.0
    response = client.post("/api/v1/sensor-data", json=payload, headers=headers)
    assert response.status_code == 422

    # 3. Invalid packet number (negative)
    payload["humidity"] = 60.0
    payload["packet_number"] = -1
    response = client.post("/api/v1/sensor-data", json=payload, headers=headers)
    assert response.status_code == 422

def test_successful_sensor_ingestion_and_blockchain_pending():
    headers = {"X-Device-API-Key": TEST_API_KEY}
    payload = {
        "device_id": TEST_DEVICE_ID,
        "temperature": 26.5,
        "humidity": 55.2,
        "motion": True,
        "packet_number": 100
    }
    
    response = client.post("/api/v1/sensor-data", json=payload, headers=headers)
    assert response.status_code == 201
    data = response.json()
    assert data["success"] is True

    # Verify device status cache became ONLINE
    db = TestingSessionLocal()
    status_entry = db.query(DeviceStatus).filter(DeviceStatus.device_id == TEST_DEVICE_ID).first()
    assert status_entry is not None
    assert status_entry.status == "ONLINE"
    assert status_entry.last_temperature == 26.5
    assert status_entry.last_motion is True
    
    # Verify blockchain_records entry is created as PENDING
    bc_record = db.query(BlockchainRecord).filter(BlockchainRecord.device_id == TEST_DEVICE_ID).first()
    assert bc_record is not None
    assert bc_record.verification_status == "PENDING"
    assert len(bc_record.data_hash) == 64 # SHA-256 length

def test_duplicate_packet_rejection():
    headers = {"X-Device-API-Key": TEST_API_KEY}
    payload = {
        "device_id": TEST_DEVICE_ID,
        "temperature": 22.0,
        "humidity": 45.0,
        "motion": False,
        "packet_number": 15
    }
    
    # First request
    response = client.post("/api/v1/sensor-data", json=payload, headers=headers)
    assert response.status_code == 201

    # Second duplicate request (same device, same packet number)
    response = client.post("/api/v1/sensor-data", json=payload, headers=headers)
    assert response.status_code == 409
    assert "Duplicate packet" in response.json()["detail"]

def test_motion_event_state_transitions():
    headers = {"X-Device-API-Key": TEST_API_KEY}
    
    # Phase 1: No Motion (Base state)
    payload_no_motion = {
        "device_id": TEST_DEVICE_ID,
        "temperature": 21.0,
        "humidity": 50.0,
        "motion": False,
        "packet_number": 1
    }
    response = client.post("/api/v1/sensor-data", json=payload_no_motion, headers=headers)
    assert response.status_code == 201
    
    db = TestingSessionLocal()
    events = db.query(MotionEvent).all()
    assert len(events) == 0 # No transition yet (base state was False, current is False)

    # Phase 2: NO MOTION -> MOTION (Transition Start)
    payload_motion = payload_no_motion.copy()
    payload_motion["motion"] = True
    payload_motion["packet_number"] = 2
    response = client.post("/api/v1/sensor-data", json=payload_motion, headers=headers)
    assert response.status_code == 201

    db = TestingSessionLocal()
    events = db.query(MotionEvent).all()
    assert len(events) == 1
    assert events[0].event_type == "MOTION"
    assert events[0].cleared_at is None # Remains open

    # Phase 3: MOTION -> MOTION (Remains High, shouldn't create new event)
    payload_motion_again = payload_motion.copy()
    payload_motion_again["packet_number"] = 3
    payload_motion_again["temperature"] = 21.5
    response = client.post("/api/v1/sensor-data", json=payload_motion_again, headers=headers)
    assert response.status_code == 201

    db = TestingSessionLocal()
    events = db.query(MotionEvent).all()
    assert len(events) == 1 # Still just 1 event

    # Phase 4: MOTION -> NO MOTION (Transition End / Close Event)
    payload_clear = payload_no_motion.copy()
    payload_clear["packet_number"] = 4
    response = client.post("/api/v1/sensor-data", json=payload_clear, headers=headers)
    assert response.status_code == 201

    db = TestingSessionLocal()
    events = db.query(MotionEvent).all()
    assert len(events) == 1
    assert events[0].cleared_at is not None # Closed!

def test_blockchain_verification_tamper_detection():
    headers = {"X-Device-API-Key": TEST_API_KEY}
    payload = {
        "device_id": TEST_DEVICE_ID,
        "temperature": 25.0,
        "humidity": 50.0,
        "motion": False,
        "packet_number": 5
    }
    
    response = client.post("/api/v1/sensor-data", json=payload, headers=headers)
    assert response.status_code == 201
    assert response.json()["success"] is True

    # Query database for the latest inserted SensorReading ID
    db_query = TestingSessionLocal()
    reading = db_query.query(SensorReading).filter(
        SensorReading.device_id == TEST_DEVICE_ID,
        SensorReading.packet_number == 5
    ).first()
    assert reading is not None
    reading_id = reading.id

    # At ingestion, verification_status is PENDING in the DB record
    verify_response = client.get(f"/api/v1/blockchain/verify/{reading_id}")
    assert verify_response.status_code == 200
    assert verify_response.json()["verification_status"] in ["PENDING", "VERIFIED"] # Mock can process immediately in testing

    # Simulate marking record as VERIFIED in DB
    db = TestingSessionLocal()
    bc_rec = db.query(BlockchainRecord).filter(BlockchainRecord.sensor_record_id == reading_id).first()
    assert bc_rec is not None
    bc_rec.verification_status = "VERIFIED"
    bc_rec.transaction_hash = "0xmocktxhash12345"
    db.commit()

    # Now verify again - should report VERIFIED since DB and reconstructed hash match
    verify_response = client.get(f"/api/v1/blockchain/verify/{reading_id}")
    assert verify_response.status_code == 200
    assert verify_response.json()["verification_status"] == "VERIFIED"
    assert "Recalculated hash matches" in verify_response.json()["message"]

    # TAMPER WITH DATABASE: Change temperature from 25.0 to 99.9!
    db = TestingSessionLocal()
    db_reading = db.query(SensorReading).filter(SensorReading.id == reading_id).first()
    assert db_reading is not None
    db_reading.temperature = 99.9
    db.commit()

    # Query verify endpoint: Should instantly flag INTEGRITY_FAILURE
    verify_response = client.get(f"/api/v1/blockchain/verify/{reading_id}")
    assert verify_response.status_code == 200
    assert verify_response.json()["verification_status"] == "INTEGRITY_FAILURE"
    assert "Database values have been tampered!" in verify_response.json()["message"]

def test_public_sensor_data_endpoint():
    headers = {"X-Device-API-Key": TEST_API_KEY}
    payload = {
        "device_id": TEST_DEVICE_ID,
        "temperature": 27.5,
        "humidity": 60.5,
        "motion": True,
        "packet_number": 20
    }
    
    # 1. Ingest record
    response = client.post("/api/v1/sensor-data", json=payload, headers=headers)
    assert response.status_code == 201

    # 2. Get history log to find public_id
    history_response = client.get(f"/api/v1/sensor-data/history?device_id={TEST_DEVICE_ID}")
    assert history_response.status_code == 200
    readings = history_response.json()
    assert len(readings) > 0
    
    # Match the correct packet
    target = next((r for r in readings if r["packet_number"] == 20), None)
    assert target is not None
    public_uuid = target.get("public_id")
    assert public_uuid is not None

    # 3. Retrieve through the public API endpoint
    public_response = client.get(f"/api/v1/sensor-data/{public_uuid}")
    assert public_response.status_code == 200
    public_data = public_response.json()
    assert public_data["record_id"] == public_uuid
    assert public_data["device_id"] == TEST_DEVICE_ID
    assert public_data["packet_number"] == 20
    assert public_data["temperature"] == 27.5
    assert public_data["humidity"] == 60.5
    assert public_data["motion"] is True
    assert public_data["firmware_version"] == "v1.0.0"
    assert "blockchain_status" in public_data
    assert "hash" in public_data

    # Ensure no internal keys/passwords/db ids are leaked
    assert "id" not in public_data  # Internal primary key is not included
    assert "db_id" not in public_data
    assert "api_key" not in public_data

    # 4. Attempt to fetch non-existent record
    bad_response = client.get("/api/v1/sensor-data/00000000-0000-0000-0000-000000000000")
    assert bad_response.status_code == 404

