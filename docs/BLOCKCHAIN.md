# Blockchain Integration & Verification Model

This document explains the technical implementation of the blockchain-backed integrity layer for the **Secure IoT Environmental and Motion Monitoring System**.

---

## 1. Why Blockchain is Used

In standard IoT setups, database records can be altered, deleted, or injected by attackers who gain access to the database server, leading to silent data manipulation (e.g. tampering with historical temperature averages to hide failures or disabling alarm records).

By using the **Polygon L2 Blockchain** as a tamper-evident registry, we create cryptographic proof of state:
- Every valid sensor reading is hashed deterministically at ingestion.
- The hash is anchored permanently to a smart contract.
- Any subsequent attempt to edit the database (e.g. changing temperature from 24°C to 99°C) will produce a hash mismatch when recalculated, instantly triggering an `INTEGRITY FAILURE` flag.
- Historical audit logs are completely verifiable against contract events.

---

## 2. On-Chain vs. Off-Chain Data Partitioning

High-frequency sensor data is **never** stored directly on the blockchain due to block size limits and transaction fee (gas) constraints.

| Data Type | Location | Rationale |
| :--- | :--- | :--- |
| **Raw Sensors** (Temperature, Humidity, Motion) | Relational Database (PostgreSQL/SQLite) | High-speed, flexible indexing, queries, and charting. |
| **Server Timestamps** (`received_at`, `created_at`) | Relational Database (PostgreSQL/SQLite) | Quick timeline indexing. |
| **Cryptographic Hash** (SHA-256) | Blockchain (Solidity Contract) | Unalterable state anchor. |
| **Device Registration** (Authority Address) | Blockchain (Solidity Contract) | Decentralized access control for registering nodes. |

---

## 3. Cryptographic Hash Generation

To ensure verification is deterministic, the backend formats sensor reading properties into an exact string representation before computing the SHA-256 hash.

### Formula
```
Payload = "{device_id}:{temperature:.1f}:{humidity:.1f}:{motion}:{packet_number}:{received_at_iso}"
Hash = SHA-256(Payload)
```

- **Floats**: Formatted to exactly `1 decimal place` to prevent float encoding mismatches (e.g. `24.5000000001` vs `24.5`) across different programming languages and chiparchitectures.
- **Motion**: Represented as a lowercase string (`true` or `false`).
- **Timestamp**: Formatted as an ISO-8601 string in UTC, postfixed with `Z` (e.g., `2026-08-16T12:05:30.123456Z`).

### Example
For a packet with:
- `device_id`: `receiver-01`
- `temperature`: `26.4`
- `humidity`: `55.8`
- `motion`: `true`
- `packet_number`: `42`
- `received_at`: `2026-08-16T12:05:30.123456Z`

The payload string is:
`receiver-01:26.4:55.8:true:42:2026-08-16T12:05:30.123456Z`

The resulting SHA-256 hash sent to the smart contract:
`0x4f6479f64a51e60f0c05df1a48c48a73b22ad4f71a06283b7ff15e47a062a4b8`

---

## 4. Smart Contract Mechanics: `SensorDataRegistry.sol`

The registry contract is deployed to Polygon (or local Hardhat). It exposes:
- **`registerDevice(string deviceId, address authority)`**: Restricts writing authority to registered devices or the owner.
- **`recordSensorHash(string deviceId, uint256 packetNumber, bytes32 dataHash)`**: Records the cryptographic hash. Ensures that once a hash is written for a specific `(deviceId, packetNumber)`, it **cannot** be overwritten.
- **`verifySensorHash(string deviceId, uint256 packetNumber, bytes32 dataHash)`**: Checks if the parameter matches the stored hash.
- **`getSensorHash(string deviceId, uint256 packetNumber)`**: Reads the registered hash.

---

## 5. End-to-End Ingestion & Transaction Flow

```
Sensor Data -> FastAPI API -> 1. Store in Database
                           -> 2. Generate SHA-256 Hash
                           -> 3. Enqueue to In-Memory Queue
                           -> 4. WebSockets broadcast (Status: PENDING)
                                          |
                              [Background Worker Daemon]
                                          |
                           -> 5. Sign transaction using private key
                           -> 6. Send transaction to Polygon (gas fee paid)
                           -> 7. Transaction mined
                           -> 8. WebSockets broadcast (Status: VERIFIED)
```

### Failure Handling & Resilience
- **Database Priority**: Sensor data is written to the database first. The API response returns immediately. The blockchain processing happens fully asynchronously.
- **Network Outage Resilience**: If Polygon is offline or gas spikes, the record remains in the database marked as `PENDING`.
- **Automatic Retry**: The backend worker keeps retrying transactions in the queue. No data is lost due to blockchain downtime.

---

## 6. Verification & Tamper Detection Process

When a client clicks `VERIFY DATA` in the web panel:

```
[UI Trigger] -> API: GET /blockchain/verify/{id}
                    |
              1. Fetch DB Row (temp, hum, motion, packet, received_at)
              2. Recompile Payload String & Compute SHA-256
              3. Call Contract: getSensorHash(device_id, packet_number)
              4. Compare:
                 - If DB Hash != Recomputed Local Hash:
                   -> Returns STATUS: INTEGRITY_FAILURE (Local database tampered!)
                 - If Chain Hash == 0x0000...:
                   -> Returns STATUS: PENDING / NOT REGISTERED (Not yet on-chain)
                 - If Chain Hash == Recomputed Hash:
                   -> Returns STATUS: VERIFIED (Data matches immutable proof!)
```

This dual-hash check (local record vs recomputed hash, and local hash vs chain hash) ensures we catch both **database-only hacks** and **unauthorized transaction attempts**.
