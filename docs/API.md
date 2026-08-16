# API Documentation

This document describes the REST API and WebSocket interfaces for the **Secure IoT Environmental and Motion Monitoring System**.

All endpoints are prefixed with the base path `/api/v1`.

---

## Security & Authentication

Physical receivers must authenticate using an API key sent in the HTTP request headers.

- **Header Name**: `X-Device-API-Key`
- **Value**: Hashed SHA-256 equivalent on the backend (e.g. `receiver-key-super-secret-12345` for development).
- **Scope**: Required only for ingestion (`POST /api/v1/sensor-data`). General query endpoints do not require authentication.

### Rate Limiting & Protection
To prevent Denial of Service (DoS) and abuse, the backend implements global protections:
- **Rate Limit**: Maximum of **100 requests per minute** per client IP. Exceeding this limit returns HTTP `429 Too Many Requests`.
- **Payload Constraints**: Maximum request size is strictly limited to **1MB**. Exceeding this size returns HTTP `413 Request Entity Too Large`.

---

## REST Endpoints

### 1. Ingest Sensor Data
Ingests a physical data packet transmitted from the receiver gateway.

- **Method**: `POST`
- **Endpoint**: `/api/v1/sensor-data`
- **Headers**:
  - `X-Device-API-Key`: `[API_KEY_HERE]`
  - `Content-Type`: `application/json`
- **Request Body**:
  ```json
  {
    "device_id": "receiver-01",
    "temperature": 26.4,
    "humidity": 55.8,
    "motion": true,
    "packet_number": 42
  }
  ```
- **Responses**:
  - **201 Created**: Ingestion successful.
    ```json
    {
      "id": 18,
      "device_id": "receiver-01",
      "temperature": 26.4,
      "humidity": 55.8,
      "motion": true,
      "packet_number": 42,
      "received_at": "2026-08-16T12:05:30.123456",
      "created_at": "2026-08-16T12:05:30.123456"
    }
    ```
  - **401 Unauthorized**: Missing API Key header.
  - **403 Forbidden**: Invalid API Key.
  - **409 Conflict**: Duplicate packet sequence detected (`device_id` + `packet_number` unique constraint violation).
  - **422 Unprocessable Entity**: Invalid input range (e.g., Temperature > 80°C, Humidity < 0%, negative packet numbers).

---

### 2. Get Latest Sensor Data
Retrieves the latest ingested sensor reading.

- **Method**: `GET`
- **Endpoint**: `/api/v1/sensor-data/latest`
- **Query Parameters**:
  - `device_id` (string, optional): Filter by a specific device.
- **Response (200 OK)**:
  ```json
  {
    "id": 18,
    "device_id": "receiver-01",
    "temperature": 26.4,
    "humidity": 55.8,
    "motion": true,
    "packet_number": 42,
    "received_at": "2026-08-16T12:05:30.123456",
    "created_at": "2026-08-16T12:05:30.123456"
  }
  ```

---

### 3. Get Sensor Data History
Retrieves historical sensor readings.

- **Method**: `GET`
- **Endpoint**: `/api/v1/sensor-data/history`
- **Query Parameters**:
  - `device_id` (string, optional): Filter by device.
  - `duration` (string, optional): Duration threshold. Options: `1h`, `6h`, `24h`, `7d`, `30d` (default `1h`).
  - `limit` (integer, optional): Pagination limit (max 100, default 50).
  - `offset` (integer, optional): Pagination offset (default 0).
- **Response (200 OK)**:
  ```json
  [
    {
      "id": 18,
      "device_id": "receiver-01",
      "temperature": 26.4,
      "humidity": 55.8,
      "motion": true,
      "packet_number": 42,
      "received_at": "2026-08-16T12:05:30.123456",
      "created_at": "2026-08-16T12:05:30.123456"
    }
  ]
  ```

---

### 4. Verify Sensor Integrity
Performs a cryptographic comparison between the database reading and the on-chain smart contract log. Detects database tampering.

- **Method**: `GET`
- **Endpoint**: `/api/v1/blockchain/verify/{record_id}`
- **Response (200 OK - Successful Verification)**:
  ```json
  {
    "record_id": 18,
    "device_id": "receiver-01",
    "packet_number": 42,
    "computed_hash": "0x4f6479f64a51e60f0c05df1a48c48a73b22ad4f71a06283b7ff15e47a062a4b8",
    "blockchain_hash": "0x4f6479f64a51e60f0c05df1a48c48a73b22ad4f71a06283b7ff15e47a062a4b8",
    "transaction_hash": "0x53a9...5b38",
    "block_number": 123456,
    "network": "hardhat",
    "verification_status": "VERIFIED",
    "message": "VERIFIED: Cryptographic proof confirmed. Recalculated hash matches contract-stored hash on-chain.",
    "timestamp": "2026-08-16T12:06:05.992211"
  }
  ```
- **Response (200 OK - Tamper/Hash Mismatch)**:
  ```json
  {
    "record_id": 18,
    "device_id": "receiver-01",
    "packet_number": 42,
    "computed_hash": "0x98f6...a2c1",
    "blockchain_hash": "0x4f6479f64a51e60f0c05df1a48c48a73b22ad4f71a06283b7ff15e47a062a4b8",
    "transaction_hash": "0x53a9...5b38",
    "block_number": 123456,
    "network": "hardhat",
    "verification_status": "INTEGRITY_FAILURE",
    "message": "INTEGRITY FAILURE: Database values have been tampered! The computed reading hash does not match the database-stored hash.",
    "timestamp": "2026-08-16T12:06:07.455211"
  }
  ```

---

### 5. Get Device Statuses
Retrieves the online status cache and cached metrics of all devices.

- **Method**: `GET`
- **Endpoint**: `/api/v1/devices/{device_id}/status`
- **Response (200 OK)**:
  ```json
  {
    "device_id": "receiver-01",
    "status": "ONLINE",
    "last_seen": "2026-08-16T12:05:30.123456",
    "last_packet_number": 42,
    "last_temperature": 26.4,
    "last_humidity": 55.8,
    "last_motion": true,
    "updated_at": "2026-08-16T12:05:30.123456"
  }
  ```

---

### 6. Get Motion Events List
Retrieves a paginated list of motion detection incidents.

- **Method**: `GET`
- **Endpoint**: `/api/v1/motion-events`
- **Query Parameters**:
  - `device_id` (string, optional): Filter by device.
  - `limit` (integer, optional): Max 100, default 20.
  - `offset` (integer, optional): Default 0.
- **Response (200 OK)**:
  ```json
  [
    {
      "id": 5,
      "device_id": "receiver-01",
      "event_type": "MOTION",
      "detected_at": "2026-08-16T12:05:10.000000",
      "cleared_at": "2026-08-16T12:05:30.000000",
      "created_at": "2026-08-16T12:05:10.005000"
    }
  ]
  ```

---

### 7. Health Check
Retrieves health states of backend integrations.

- **Method**: `GET`
- **Endpoint**: `/api/v1/health`
- **Response (200 OK)**:
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-08-16T12:07:00.112233",
    "database": "healthy",
    "blockchain": "connected",
    "contract_address": "0x5FbDB2315678afecb367f032d93F642f64180aa3"
  }
  ```

---

## WebSocket Interface

Clients (React dashboard) connect to the server over WebSockets to receive real-time streams of events.

- **URL**: `/ws`
- **Format**: JSON Messages

### Events Broadcasted

#### 1. Sensor Reading Ingested (`SENSOR_READING_RECEIVED`)
Broadcasted immediately when a packet is ingested.
```json
{
  "type": "SENSOR_READING_RECEIVED",
  "data": {
    "id": 18,
    "device_id": "receiver-01",
    "temperature": 26.4,
    "humidity": 55.8,
    "motion": true,
    "packet_number": 42,
    "received_at": "2026-08-16T12:05:30.123456",
    "blockchain_status": "PENDING"
  }
}
```

#### 2. Blockchain Transaction Confirmed (`BLOCKCHAIN_RECORD_UPDATED`)
Broadcasted after the EVM worker records the hash on-chain.
```json
{
  "type": "BLOCKCHAIN_RECORD_UPDATED",
  "data": {
    "id": 12,
    "sensor_record_id": 18,
    "device_id": "receiver-01",
    "packet_number": 42,
    "transaction_hash": "0x53a9e38e1a129d20c0c05df1a48c48a73b22ad4f71a06283b7ff15e47a0625b38",
    "block_number": 123456,
    "verification_status": "VERIFIED"
  }
}
```

#### 3. Device Inactivity status (`DEVICE_STATUS_UPDATED`)
Broadcasted when a device is marked offline after 10s of silence.
```json
{
  "type": "DEVICE_STATUS_UPDATED",
  "data": {
    "device_id": "receiver-01",
    "status": "OFFLINE",
    "last_seen": "2026-08-16T12:05:30.123456",
    "updated_at": "2026-08-16T12:05:40.123456"
  }
}
```
