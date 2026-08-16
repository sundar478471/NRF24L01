# Public Cloud Deployment Manual

This guide describes how to deploy the FastAPI backend service, PostgreSQL database, EVM smart contract, and React frontend dashboard to public cloud networks so the ESP32 Edge Gateway can operate in standalone mode globally.

---

## 1. Backend API Deployment

The Python backend uses FastAPI and Uvicorn. You can host it on platforms like **Render**, **Railway**, or **Fly.io**.

### A. Deploy Database
1. Provision a managed **PostgreSQL Database** on Render or Railway.
2. Copy the connection string (e.g. `postgresql://user:password@hostname:5432/dbname`).

### B. Deploy FastAPI Service
1. Link your GitHub repository to Render/Railway.
2. Select the Environment as **Python**.
3. Set the **Build Command**:
   ```bash
   pip install -r backend/requirements.txt
   ```
4. Set the **Start Command**:
   ```bash
   uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT
   ```
5. Configure the following **Environment Variables**:
   - `DATABASE_URL`: Set to your PostgreSQL connection string.
   - `API_SECRET`: A secure custom token (e.g. `your-api-secret-key-12345`).
   - `CORS_ORIGINS`: Set to your public frontend URL (e.g. `https://dashboard.yourdomain.com`).
   - `BLOCKCHAIN_RPC_URL`: Set to your Polygon RPC endpoint (e.g. Alchemy or Infura HTTPS URL).
   - `BLOCKCHAIN_PRIVATE_KEY`: Your authority wallet's private key (must be funded with MATIC/POL to record hashes).
   - `BLOCKCHAIN_CONTRACT_ADDRESS`: The deployed Solidity contract address.
   - `BLOCKCHAIN_CHAIN_ID`: `137` for Polygon Mainnet or `80002` for Amoy Testnet.

---

## 2. Smart Contract Deployment (Polygon/EVM)

To deploy the Solidity contract `SensorDataRegistry.sol` to a public EVM chain (such as Polygon Amoy Testnet or Polygon Mainnet):

1. Navigate to the `blockchain/` directory.
2. Update `hardhat.config.ts` to include the target network (Amoy/Polygon) with your RPC URL and deployer private key.
3. Compile the contracts:
   ```bash
   npx hardhat compile
   ```
4. Run the deployment script:
   ```bash
   npx hardhat run scripts/deploy.ts --network <network_name>
   ```
5. Copy the printed contract address, verify it on Polygonscan, and add it to your backend's environment variables.

---

## 3. Frontend Dashboard Deployment

The frontend React dashboard can be compiled to static HTML/JS and hosted for free on **Vercel**, **Netlify**, or **GitHub Pages**.

1. Navigate to the `frontend/` directory.
2. Open [`frontend/src/App.tsx`](file:///d:/NRF24L01/frontend/src/App.tsx) and ensure the endpoints point to your deployed public API:
   ```typescript
   const API_BASE_URL = "https://your-api-domain.com/api/v1";
   const WS_URL = "wss://your-api-domain.com/ws";
   ```
3. Run the compilation build:
   ```bash
   npm run build
   ```
4. Upload the resulting `dist/` directory to Vercel/Netlify.

---

## 4. ESP32 Receiver Configuration

Once your backend is running under HTTPS (e.g. `https://api.yourdomain.com`), configure your physical receiver node to upload telemetry directly to it:

1. Open your Arduino IDE.
2. Load [`esp32/receiver/receiver.ino`](file:///d:/NRF24L01/esp32/receiver/receiver.ino).
3. Find the **Wi-Fi & API Configuration** lines and update them:
   ```cpp
   const char *WIFI_SSID = "YOUR_PHYSICAL_SSID";
   const char *WIFI_PASSWORD = "YOUR_PHYSICAL_PASSWORD";
   const char *API_URL = "https://your-api-domain.com/api/v1/sensor-data";
   const char *DEVICE_ID = "receiver-01";
   const char *DEVICE_API_KEY = "receiver-key-super-secret-12345";
   ```
   > [!IMPORTANT]
   > Make sure the API_URL starts with `https://` to secure credentials in transit over the internet.
4. Select the target ESP32 board and Port in your IDE.
5. Click **Upload** to write the firmware to the receiver.
6. Verify the ESP32 is working by checking the raw output via the browser's built-in **Serial Monitor** tab on your public dashboard!
