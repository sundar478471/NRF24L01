# System Architecture & Topology

This document details the hardware topology, pin configurations, database models, WebSocket payloads, and blockchain anchoring workflows of the Standalone ESP32 IoT + Blockchain Verification System.

---

## 1. System Topology & Data Flow

The telemetry data starts at the edge sensors, travels across local RF link to the gateway node, and gets uploaded via secure HTTPS to a public cloud backend. The backend stores the record, updates dashboard clients over WebSockets, and anchors the cryptographic hash to the Polygon smart contract asynchronously.

```
+--------------------+
|  DHT22 + PIR       |
+--------------------+
          │ GPIO 17 / 27
          ▼
+--------------------+
| ESP32 Transmitter  |
+--------------------+
          │ SPI
          ▼
+--------------------+
| NRF24L01 Tx Module |
+--------------------+
          │ 2.4 GHz wireless (Channel 108)
          ▼
+--------------------+
| NRF24L01 Rx Module |
+--------------------+
          │ SPI
          ▼
+--------------------+
| ESP32 Edge Gateway | <── [Buzzer + Button + RGB Status LED]
+--------------------+
          │ Wi-Fi client (Secure HTTPS)
          ▼
+--------------------+
| Public HTTPS API   |
+--------------------+
     │          │
     │ 1. Save  │ 2. Enqueue
     ▼          ▼
+--------+  +---------------+  3. Sign Tx  +-------------------+
| SQL DB |  | Async Queue   | ───────────> | Polygon Blockchain|
+--------+  +---------------+              +-------------------+
     │
     │ 4. WebSocket Broadcast
     ▼
+--------------------+
| React Frontend UI  |
+--------------------+
```

---

## 2. SPI Pin Configurations

Both transmitter and receiver nodes use standard VSPI hardware controllers on the ESP32.

| Pin Function | NRF24L01 Pin | ESP32 GPIO | Description |
| :--- | :--- | :--- | :--- |
| **VCC** | Pin 2 | 3.3V | Strictly 3.3V (never connect to 5V/VIN) |
| **GND** | Pin 1 | GND | Common ground |
| **CE** | Pin 3 | GPIO4 | Chip Enable Activates RX or TX mode |
| **CSN** | Pin 4 | GPIO5 | SPI Chip Select |
| **SCK** | Pin 5 | GPIO18 | SPI Clock (VSPI Default) |
| **MOSI** | Pin 6 | GPIO23 | SPI MOSI (VSPI Default) |
| **MISO** | Pin 7 | GPIO19 | SPI MISO (VSPI Default) |
| **IRQ** | Pin 8 | NC | Interrupt request (Not connected) |

---

## 3. Database Entity-Relationship (ER) Schema

The database tracks devices, readings, events, and smart contract anchoring receipts.

### Devices Table (`devices`)
- `id` (String, PK) - Unique key (e.g. `receiver-01`).
- `name` (String) - Readable device name.
- `api_key_hash` (String) - Hashed device secret API key.
- `created_at` (DateTime) - Device creation timestamp.

### Device Status Table (`device_status`)
- `device_id` (String, PK, FK -> `devices.id`)
- `status` (String) - `ONLINE` or `OFFLINE`.
- `last_seen` (DateTime) - Last received API request timestamp.
- `last_packet_number` (Integer)
- `last_temperature` (Float)
- `last_humidity` (Float)
- `last_motion` (Boolean)
- `updated_at` (DateTime)

### Sensor Readings Table (`sensor_readings`)
- `id` (Integer, PK, Autoincrement)
- `device_id` (String, FK -> `devices.id`)
- `temperature` (Float)
- `humidity` (Float)
- `motion` (Boolean)
- `packet_number` (Integer)
- `received_at` (DateTime)
- `created_at` (DateTime)
- *Constraint*: Unique index on `(device_id, packet_number)` to prevent duplicates.

### Motion Events Table (`motion_events`)
- `id` (Integer, PK)
- `device_id` (String, FK -> `devices.id`)
- `event_type` (String) - Default is `'MOTION'`.
- `detected_at` (DateTime) - Timestamp of transition from `NO MOTION` -> `MOTION`.
- `cleared_at` (DateTime, Nullable) - Timestamp of transition from `MOTION` -> `NO MOTION`.

### Blockchain Records Table (`blockchain_records`)
- `id` (Integer, PK)
- `sensor_record_id` (Integer, FK -> `sensor_readings.id`, Unique)
- `device_id` (String)
- `data_hash` (String) - Recalculated deterministic SHA-256 hash.
- `transaction_hash` (String, Nullable) - On-chain transaction ID.
- `block_number` (Integer, Nullable) - Block number of mined transaction.
- `network` (String) - EVM network (e.g. `polygon` or `hardhat`).
- `contract_address` (String) - Target contract address on-chain.
- `recorded_at` (DateTime, Nullable)
- `verification_status` (String) - `PENDING`, `VERIFIED`, or `FAILED`.

---

## 4. WebSocket Payload Protocols

The backend broadcasts events to frontend clients dynamically over `ws://<domain>/ws` to enable real-time UI card and graph updates without page refreshes.

### Payload A: Sensor Data Received
```json
{
  "type": "SENSOR_READING_RECEIVED",
  "data": {
    "id": 142,
    "device_id": "receiver-01",
    "temperature": 24.8,
    "humidity": 52.6,
    "motion": false,
    "packet_number": 204,
    "received_at": "2026-08-16T08:54:41.123Z",
    "blockchain_status": "PENDING"
  }
}
```

### Payload B: Blockchain Anchoring Complete
```json
{
  "type": "BLOCKCHAIN_RECORD_UPDATED",
  "data": {
    "id": 142,
    "sensor_record_id": 142,
    "device_id": "receiver-01",
    "packet_number": 204,
    "transaction_hash": "0x56a4b1de6d53ef0ab81163459cfa77d56e9c450...",
    "block_number": 12845612,
    "verification_status": "VERIFIED"
  }
}
```

### Payload C: Device Status State Change
```json
{
  "type": "DEVICE_STATUS_UPDATED",
  "data": {
    "device_id": "receiver-01",
    "status": "OFFLINE",
    "last_seen": "2026-08-16T08:54:41.123Z",
    "updated_at": "2026-08-16T08:55:01.000Z"
  }
}
```

---

## 5. Blockchain Asynchronous Anchoring Queue

To maintain low latency and guarantee that sensor readings are never blocked or lost due to high gas prices or network congestion, transaction anchoring is executed asynchronously:

1. **Ingest & Store**: Sensor reading is immediately verified and saved to the SQL database. HTTP response `201 Created` is returned to the ESP32.
2. **Deterministic Hash**: A deterministic SHA-256 hash is computed using:
   `device_id + temperature + humidity + motion + packet_number + received_at (ISO 8601 UTC Z)`
3. **Queue**: A database row is created in `blockchain_records` with status `PENDING`, and the ID is placed in a non-blocking asyncio background queue.
4. **Worker Loop**: The background queue handler dequeues the job, signs the `recordSensorHash` transaction using the backend's private key, and broadcasts it to the EVM RPC node.
5. **EVM Settlement**: Once the transaction receipt is mined, the database entry is updated to `VERIFIED` and a WebSocket event is broadcast to the frontend. If the blockchain RPC goes down, the worker retries the pending queue job later, ensuring zero data loss.
