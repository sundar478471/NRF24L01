# Secure IoT Environmental and Motion Monitoring System with Blockchain Verification

A production-ready, full-stack Internet of Things (IoT) monitoring system with real-time data ingestion, secure device authentication, relational history tracking, motion event logging, and **blockchain-backed data integrity verification**.

---

## Technical Stack & Architecture

- **Edge Hardware**: ESP32 Transmitter (DHT22 sensor, PIR sensor) sending payload via 2.4GHz RF using **NRF24L01+**.
- **Edge Gateway**: ESP32 Receiver (RGB status LED, push button, buzzer alarm) receiving RF payload and forwarding to the cloud via Wi-Fi (HTTPS).
- **Backend Services**: **Python / FastAPI** REST API, **Uvicorn** ASGI server, **SQLAlchemy ORM** (configured for PostgreSQL / SQLite), **WebSockets** for real-time updates.
- **Blockchain Registry**: **Solidity Smart Contract** deployed on Polygon EVM (tested via Hardhat Node) using **Web3.py** for server-side asynchronous anchors.
- **Frontend Dashboard**: **React / Vite / TypeScript / Tailwind CSS** dashboard with real-time chart updating (Recharts) and interactive smart contract verification checkers.

---

## Project Structure

```
d:/NRF24L01/
├── backend/                  # FastAPI Backend API
│   ├── app/
│   │   ├── config.py         # Pydantic Settings
│   │   ├── database.py       # SQLAlchemy engine/session yields
│   │   ├── models.py         # DB Tables (Sensor readings, status, blockchain records)
│   │   ├── schemas.py        # Pydantic Request/Response validation
│   │   ├── security.py       # API Key hashing & device validation
│   │   ├── blockchain.py     # Web3 Async client & background task queue
│   │   ├── simulator.py      # Standalone Python hardware gateway simulator
│   │   └── main.py           # REST endpoints, WebSockets, Rate limiting, Lifespan tasks
│   └── tests/
│       └── test_api.py       # Automated endpoint integration tests
├── frontend/                 # React Web Dashboard
│   ├── src/
│   │   ├── App.tsx           # Dashboard layout and WebSocket bindings
│   │   ├── index.css         # Tailwind directives and custom CSS glassmorphism rules
│   │   └── main.tsx          # React client mounting
│   ├── package.json
│   └── tailwind.config.js
├── blockchain/               # Smart Contracts Environment
│   ├── contracts/
│   │   └── SensorDataRegistry.sol   # Solidity integrity contract
│   ├── scripts/
│   │   └── deploy.ts         # Hardhat deployment script & node seeding
│   ├── test/
│   │   └── SensorDataRegistry.test.ts  # Contract unit tests
│   ├── hardhat.config.ts
│   └── tsconfig.json
├── esp32/                    # Physical Arduino Hardware Firmware
│   ├── transmitter/
│   │   └── transmitter.ino   # Reads DHT22/PIR, packs, transmits over RF
│   └── receiver/
│       └── receiver.ino      # Receives RF, triggers alarm, posts HTTPS JSON payload
├── docs/                     # Detailed guides
│   ├── API.md                # Ingestion & query endpoints documentation
│   ├── BLOCKCHAIN.md         # Cryptographic hash details & verification flows
│   └── ESP32_SETUP.md        # Hardware wiring pinouts and IDE libraries
├── .env                      # Local environment secrets
├── .env.example              # Env variables template
└── README.md                 # Main overview guide
```

---

## 🛠️ Step-by-Step Local Deployment Setup

Ensure you have **Python 3.10+** and **Node.js 18+** installed.

### 1. Smart Contract Compiler & Local Blockchain Node
Start a local EVM network node to record sensor hashes:
```bash
# Navigate to blockchain directory
cd blockchain

# Install package dependencies
npm install

# Start local EVM blockchain network
npx hardhat node
```
*Leave this terminal window open running the node.*

Open a new terminal window to compile and deploy the smart contract to the local node:
```bash
cd blockchain

# Run compilation and type compilation
npm run compile

# Run smart contract unit tests
npm run test

# Deploy smart contract to the running local network
npx hardhat run scripts/deploy.ts --network localhost
```
*Note the deployed `SensorDataRegistry deployed to: 0x...` address. It is automatically registered in your `.env` file.*

---

### 2. FastAPI Ingestion & Query Backend
Set up your python virtual environment and run the backend API server:
```bash
# Navigate back to root and then backend directory
cd backend

# Install python dependencies
pip install -r requirements.txt

# Run backend automated tests (with SQLite in-memory database)
python -m pytest tests/

# Launch FastAPI server on http://localhost:8000
uvicorn app.main:app --reload --port 8000
```
*Leave the server running. On startup, it automatically creates `sensor_data.db` and seeds the default device credentials.*

---

### 3. React Web Dashboard
Compile and run the frontend web panel:
```bash
# Navigate to frontend directory
cd frontend

# Install client packages
npm install --legacy-peer-deps

# Verify production build compiles without errors
npm run build

# Start development client server on http://localhost:5173
npm run dev
```
Open your browser and navigate to **`http://localhost:5173`**.

---

## 🚀 Verifying the Ingestion Pipeline & Tamper Detection

If you do not have physical ESP32 boards wired up, you can run the gateway simulator:

### Step 1: Start Ingestion Stream
On the web dashboard, click **"Start Simulator"** (or run `python backend/app/simulator.py` in your terminal). 
This launches real-time HTTP POSTs to the API. You will immediately see new cards, historical graphs, and incident tables updating every 3 seconds via WebSockets.

### Step 2: Blockchain Transaction Mining
Watch the blockchain hardhat node console. As each packet is ingested, a `recordSensorHash` transaction is signed and broadcasted to the contract. The web panel's blockchain status for the reading will automatically transition from `PENDING` to `VERIFIED`.

### Step 3: Run Integrity Audits
Scroll down to the "Full Ingestion History Log", locate a record, and click **"Verify"**.
The verification engine:
1. Re-fetches the database record.
2. Re-calculates the local SHA-256 hash.
3. Queries the smart contract for the stored hash.
4. Compares them and prints a verified success report.

### Step 4: Test Tamper Detection
To simulate a database database injection or hack:
1. Locate a packet in the table and click **"Tamper Data"**.
2. The backend will manually overwrite that database row (altering the temperature value to `99.9`°C).
3. Now, click **"Verify"** on that same record.
4. The verification report instantly flags a **`INTEGRITY FAILURE`** alert, showing a mismatch between the database values and the immutable smart contract registry.
5. This proves that any unauthorized database alteration is caught instantly by the blockchain trust anchor.
