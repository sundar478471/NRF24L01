import { useState, useEffect, useRef } from "react";
import {
  Thermometer,
  Droplets,
  Activity,
  Wifi,
  WifiOff,
  Database,
  Shield,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  History,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Clock,
  Layers,
  Fingerprint,
  Terminal,
  Cpu,
  ArrowRight,
  UploadCloud,
  Check,
  Eye,
  Share2,
  Copy,
  Download
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from "recharts";

// Configuration constants
// Derive API and WebSocket URLs dynamically using environment configurations with hostname fallbacks.
const getApiUrls = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.trim() !== "") {
    const cleanUrl = envUrl.replace(/\/+$/, ""); // Remove trailing slashes
    const apiBase = cleanUrl.endsWith("/api/v1") ? cleanUrl : `${cleanUrl}/api/v1`;
    const isSecure = cleanUrl.startsWith("https");
    const wsProto = isSecure ? "wss" : "ws";
    const hostWithPort = cleanUrl.replace(/^(http|https):\/\//, "").split("/")[0];
    return {
      api: apiBase,
      ws: `${wsProto}://${hostWithPort}/ws/sensor-data`
    };
  }
  const isVercel = window.location.hostname.endsWith("vercel.app");
  if (isVercel) {
    const isSecure = window.location.protocol === "https:";
    const wsProto = isSecure ? "wss" : "ws";
    return {
      api: `${window.location.origin}/api/v1`,
      ws: `${wsProto}://${window.location.host}/ws/sensor-data`
    };
  }
  return {
    api: `http://${window.location.hostname}:8000/api/v1`,
    ws: `ws://${window.location.hostname}:8000/ws/sensor-data`
  };
};

const urls = getApiUrls();
const API_BASE_URL = urls.api;
const WS_URL = urls.ws;
const DEVICE_ID = "receiver-01";

interface SensorReading {
  id: number;
  device_id: string;
  temperature: number;
  humidity: number;
  motion: boolean;
  packet_number: number;
  received_at: string;
  blockchain_status?: string;
  transaction_hash?: string;
  block_number?: number;
  data_hash?: string;
}

interface NormalizedSensorData {
  id: number;
  deviceId: string;
  temperature: number;
  humidity: number;
  motion: boolean;
  packetNumber: number;
  receivedAt: string;
  blockchainStatus?: string;
  transactionHash?: string;
  blockNumber?: number;
  dataHash?: string;
  latency_ms?: number | null;
  is_buffered?: boolean;
  publicId?: string;
}

const normalizeSensorData = (data: any): NormalizedSensorData | null => {
  if (!data) return null;
  return {
    id: data.id,
    deviceId: data.device_id || data.deviceId || "",
    temperature: data.temperature !== undefined ? data.temperature : (data.temp !== undefined ? data.temp : 0),
    humidity: data.humidity !== undefined ? data.humidity : (data.humidity_percent !== undefined ? data.humidity_percent : 0),
    motion: data.motion !== undefined ? (typeof data.motion === "string" ? data.motion === "true" : !!data.motion) : (data.pir !== undefined ? (typeof data.pir === "string" ? data.pir === "true" : !!data.pir) : false),
    packetNumber: data.packet_number !== undefined ? data.packet_number : (data.packetNumber !== undefined ? data.packetNumber : 0),
    receivedAt: data.received_at || data.receivedAt || new Date().toISOString(),
    blockchainStatus: data.blockchain_status || data.blockchainStatus || "PENDING",
    transactionHash: data.transaction_hash || data.transactionHash || null,
    blockNumber: data.block_number || data.blockNumber || null,
    dataHash: data.data_hash || data.dataHash || null,
    latency_ms: data.latency_ms !== undefined ? data.latency_ms : null,
    is_buffered: !!data.is_buffered,
    publicId: data.public_id || data.publicId || "",
  };
};

interface DeviceStatus {
  device_id: string;
  status: string;
  last_seen: string | null;
  last_packet_number: number | null;
  last_temperature: number | null;
  last_humidity: number | null;
  last_motion: boolean | null;
  updated_at: string;
  wifi_status?: string;
  nrf_status?: string;
  buffer_count?: number;
  firmware_version?: string;
}

interface MotionEvent {
  id: number;
  device_id: string;
  event_type: string;
  detected_at: string;
  cleared_at: string | null;
}

interface VerificationResult {
  record_id: number;
  computed_hash: string;
  blockchain_hash: string | null;
  transaction_hash: string | null;
  block_number: number | null;
  verification_status: string;
  message: string;
}

// ----------------------------------------
// Timezone-Aware Live India Clock Formatters (Asia/Kolkata)
// ----------------------------------------
const timeFormatterDesktop = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true
});

const dateFormatterDesktop = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric"
});

const timeFormatterTabletMobile = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true
});

export default function App() {
  // Application State
  const [sensorData, setSensorData] = useState<NormalizedSensorData | null>(null);
  const [history, setHistory] = useState<NormalizedSensorData[]>([]);
  const [motionEvents, setMotionEventList] = useState<MotionEvent[]>([]);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [duration, setDuration] = useState<string>("1h");
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  
  // Upgraded Feature States
  const [deviceHealth, setDeviceHealth] = useState<any>(null);
  const [commMetrics, setCommMetrics] = useState<any>(null);
  const [otaState, setOtaState] = useState<any>({ status: "IDLE", progress: 0, from_version: "", to_version: "", error_message: "" });
  const [latestFirmware, setLatestFirmware] = useState<any>(null);
  const [otaTriggering, setOtaTriggering] = useState<boolean>(false);

  // Hardware Serial states
  const [serialPort, setSerialPort] = useState<any>(null);
  const [serialLogs, setSerialLogs] = useState<string[]>([]);
  const [serialConnected, setSerialConnected] = useState<boolean>(false);
  const [activeRightTab, setActiveRightTab] = useState<"motion" | "serial">("motion");
  const [isSerialSupported, setIsSerialSupported] = useState<boolean>(false);

  const serialPortRef = useRef<any>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  
  // Verification states
  const [verificationLoading, setVerificationLoading] = useState<number | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [contractAddress, setContractAddress] = useState<string>("0x5FbDB2315678afecb367f032d93F642f64180aa3");



  // Path-based routing state for QR Scan
  const [qrRecordId, setQrRecordId] = useState<string | null>(() => {
    const match = window.location.pathname.match(/^\/data\/([^/]+)/);
    return match ? match[1] : null;
  });
  
  // Public Scan Page Data State
  const [publicRecord, setPublicRecord] = useState<any | null>(null);
  const [loadingPublicRecord, setLoadingPublicRecord] = useState<boolean>(false);
  const [publicRecordError, setPublicRecordError] = useState<string | null>(null);

  // Eye details view modal states
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [selectedRecordDetails, setSelectedRecordDetails] = useState<any | null>(null);
  const [loadingDetails, setLoadingDetails] = useState<boolean>(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Threshold configuration states
  const [lossThresholdWarning, setLossThresholdWarning] = useState<number>(1.0);
  const [lossThresholdPoor, setLossThresholdPoor] = useState<number>(3.0);

  // IST Live Clock state & interval
  const [istTime, setIstTime] = useState<Date>(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setIstTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Load dashboard data on mount
  useEffect(() => {
    refreshAllData();
  }, []);

  const getOtaStatusText = () => {
    if (otaState.status === "PENDING" || otaState.status === "PREPARING") {
      return "Preparing...";
    }
    if (otaState.status === "DOWNLOADING") {
      return "Downloading...";
    }
    if (otaState.status === "VERIFYING") {
      return "Verifying...";
    }
    if (otaState.status === "INSTALLING") {
      return "Installing...";
    }
    if (otaState.status === "SUCCESS") {
      const updated = deviceStatus?.status === "ONLINE" && deviceStatus?.firmware_version === otaState.to_version;
      if (updated) {
        return "ONLINE ✓";
      }
      if (deviceStatus?.status === "OFFLINE") {
        return "Restarting...";
      }
      return "Reconnecting...";
    }
    if (otaState.status === "FAILED") {
      return "FAILED";
    }
    if (otaState.status === "ROLLED_BACK") {
      return "ROLLED_BACK";
    }
    return otaState.status;
  };

  // Fetch public sensor record details when on the QR Scan Page
  useEffect(() => {
    if (!qrRecordId) return;
    const fetchPublicRecord = async () => {
      setLoadingPublicRecord(true);
      setPublicRecordError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/sensor-data/${qrRecordId}`);
        if (res.ok) {
          const data = await res.json();
          setPublicRecord(data);
        } else if (res.status === 404) {
          setPublicRecordError("Sensor record not found. It may have been deleted or the identifier is invalid.");
        } else {
          setPublicRecordError("A backend connection or validation error occurred.");
        }
      } catch (err) {
        console.error("Error fetching public record:", err);
        setPublicRecordError("Network connection error. Please check your internet connection.");
      } finally {
        setLoadingPublicRecord(false);
      }
    };
    fetchPublicRecord();
  }, [qrRecordId]);

  // Fetch specific record details when eye icon is clicked
  useEffect(() => {
    if (!selectedRecordId) {
      setSelectedRecordDetails(null);
      return;
    }
    const fetchDetails = async () => {
      setLoadingDetails(true);
      setDetailsError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/sensor-data/${selectedRecordId}`);
        if (res.ok) {
          const data = await res.json();
          setSelectedRecordDetails(data);
        } else {
          setDetailsError("Failed to fetch record details.");
        }
      } catch (err) {
        console.error("Error fetching record details:", err);
        setDetailsError("Network error. Please try again.");
      } finally {
        setLoadingDetails(false);
      }
    };
    fetchDetails();
  }, [selectedRecordId]);

  // Download QR code helper
  const downloadQRCode = async (publicId: string, packetNum: number) => {
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(
      `${window.location.origin}/data/${publicId}`
    )}`;
    try {
      const res = await fetch(qrCodeUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sensor_record_${packetNum}_qr.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error downloading QR:", err);
      alert("Failed to download QR code. Please try again.");
    }
  };

  // Copy link helper
  const copyRecordLink = (publicId: string) => {
    const link = `${window.location.origin}/data/${publicId}`;
    navigator.clipboard.writeText(link)
      .then(() => alert("Public sensor record link copied to clipboard!"))
      .catch((err) => console.error("Error copying link:", err));
  };

  // Native share helper
  const shareRecord = async (publicId: string, packetNum: number) => {
    const link = `${window.location.origin}/data/${publicId}`;
    const title = `Sensor Record #${packetNum} Details`;
    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text: `Verify the secure blockchain IoT data for Sensor Record #${packetNum}.`,
          url: link
        });
      } catch (err) {
        console.log("Share cancelled or failed:", err);
      }
    } else {
      copyRecordLink(publicId);
    }
  };

  const formattedTimeDesktop = timeFormatterDesktop.format(istTime).toUpperCase();
  const formattedDateDesktop = dateFormatterDesktop.format(istTime).replace(/-/g, " ");
  const formattedTimeTabletMobile = timeFormatterTabletMobile.format(istTime).toUpperCase();
  
  const isLive = deviceStatus?.status === "ONLINE" || deviceStatus?.status === "UPDATING";

  // ----------------------------------------
  // API Fetch Functions
  // ----------------------------------------
  const fetchLatest = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/sensor-data/latest?device_id=${DEVICE_ID}`);
      if (res.ok) {
        const data = await res.json();
        setSensorData(normalizeSensorData(data));
      }
    } catch (err) {
      console.error("Error fetching latest reading:", err);
    }
  };

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API_BASE_URL}/sensor-data/history?device_id=${DEVICE_ID}&duration=${duration}&limit=30`);
      if (res.ok) {
        const data = await res.json();
        // Sort ascending for chart rendering
        const sorted = [...data].reverse().map(normalizeSensorData).filter(Boolean) as NormalizedSensorData[];
        setHistory(sorted);
        if (sorted.length > 0 && !sensorData) {
          setSensorData(sorted[sorted.length - 1]);
        }
      }
    } catch (err) {
      console.error("Error fetching history:", err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const fetchDeviceStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/devices/${DEVICE_ID}/status`);
      if (res.ok) {
        const data = await res.json();
        setDeviceStatus(data);
      }
    } catch (err) {
      console.error("Error fetching device status:", err);
    }
  };

  const fetchDeviceHealth = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/devices/${DEVICE_ID}/health`);
      if (res.ok) {
        const data = await res.json();
        setDeviceHealth(data);
      }
    } catch (err) {
      console.error("Error fetching device health:", err);
    }
  };

  const fetchCommunicationMetrics = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/devices/${DEVICE_ID}/metrics`);
      if (res.ok) {
        const data = await res.json();
        setCommMetrics(data);
      }
    } catch (err) {
      console.error("Error fetching comm metrics:", err);
    }
  };

  const fetchLatestFirmware = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/firmware/latest`);
      if (res.ok) {
        const data = await res.json();
        setLatestFirmware(data);
      }
    } catch (err) {
      console.error("Error fetching latest firmware:", err);
    }
  };

  const fetchOtaCheck = async () => {
    try {
      const statusRes = await fetch(`${API_BASE_URL}/devices/${DEVICE_ID}/ota/status`);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.status !== "IDLE") {
          setOtaState(statusData);
          return;
        }
      }

      const checkRes = await fetch(`${API_BASE_URL}/devices/${DEVICE_ID}/ota/check`);
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.ota_pending) {
          setOtaState((prev: any) => ({
            ...prev,
            status: "PENDING",
            to_version: checkData.ota_version,
            progress: 0
          }));
        } else {
          setOtaState((prev: any) => ({
            ...prev,
            status: "IDLE",
            progress: 0
          }));
        }
      }
    } catch (err) {
      console.error("Error checking OTA:", err);
    }
  };

  const fetchMotionEvents = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/motion-events?device_id=${DEVICE_ID}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setMotionEventList(data);
      }
    } catch (err) {
      console.error("Error fetching motion events:", err);
    }
  };

  const fetchContractAddress = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      if (res.ok) {
        const data = await res.json();
        if (data.contract_address && data.contract_address !== "not_configured" && data.contract_address !== "mock_address") {
          setContractAddress(data.contract_address);
        }
      }
    } catch (err) {
      console.error("Error fetching contract address:", err);
    }
  };

  const refreshAllData = () => {
    fetchLatest();
    fetchHistory();
    fetchDeviceStatus();
    fetchDeviceHealth();
    fetchCommunicationMetrics();
    fetchLatestFirmware();
    fetchOtaCheck();
    fetchMotionEvents();
    fetchContractAddress();
  };


  // ----------------------------------------
  // WebSocket Manager (With Exponential Backoff)
  // ----------------------------------------
  useEffect(() => {
    const isProductionVercel = window.location.hostname.endsWith("vercel.app");
    if (isProductionVercel) {
      console.log("[WEBSOCKET] Disabled on Vercel serverless. Falling back to HTTP polling.");
      setWsConnected(false);
      refreshAllData();
      return;
    }

    let ws: WebSocket;
    let reconnectTimeout: any;
    let reconnectDelay = 1000;
    let isDestroyed = false;

    const connect = () => {
      if (isDestroyed) return;
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        if (isDestroyed) {
          ws.close();
          return;
        }
        setWsConnected(true);
        reconnectDelay = 1000; // Reset backoff on successful connection
        console.log("[WEBSOCKET] Connected");
      };

      ws.onmessage = (event) => {
        if (isDestroyed) return;
        try {
          const msg = JSON.parse(event.data);
          
          if (msg.type === "SENSOR_READING_RECEIVED") {
            const readingRaw: SensorReading = msg.data;
            const reading = normalizeSensorData(readingRaw)!;

            console.log("[WEBSOCKET] Sensor data received", readingRaw);
            console.log(`[DATA] Temperature: ${reading.temperature}`);
            console.log(`[DATA] Humidity: ${reading.humidity}`);
            console.log(`[DATA] Motion: ${reading.motion}`);
            console.log(`[DATA] Packet: ${reading.packetNumber}`);

            setSensorData(reading);
            setHistory((prev) => {
              const exists = prev.some((item) => item.id === reading.id);
              if (exists) {
                return prev.map((item) => item.id === reading.id ? reading : item);
              }
              const updated = [...prev, reading];
              if (updated.length > 30) updated.shift();
              return updated;
            });
            setDeviceStatus((prev) => {
              const base = prev || {
                device_id: DEVICE_ID,
                status: "ONLINE",
                last_seen: reading.receivedAt,
                last_packet_number: reading.packetNumber,
                last_temperature: reading.temperature,
                last_humidity: reading.humidity,
                last_motion: reading.motion,
                updated_at: new Date().toISOString(),
                receiver_status: "ONLINE",
                wifi_status: "CONNECTED"
              };
              return {
                ...base,
                status: "ONLINE",
                last_seen: reading.receivedAt,
                last_packet_number: reading.packetNumber,
                last_temperature: reading.temperature,
                last_humidity: reading.humidity,
                last_motion: reading.motion,
                updated_at: new Date().toISOString(),
                receiver_status: "ONLINE",
                wifi_status: "CONNECTED"
              };
            });
          } 
          
          else if (msg.type === "BLOCKCHAIN_RECORD_UPDATED") {
            const update = msg.data;
            setSensorData((prev) => {
              if (prev && prev.id === update.sensor_record_id) {
                return {
                  ...prev,
                  blockchainStatus: update.verification_status,
                  transactionHash: update.transaction_hash,
                  blockNumber: update.block_number
                };
              }
              return prev;
            });
            
            setHistory((prev) => prev.map((item) => {
              if (item.id === update.sensor_record_id) {
                return {
                  ...item,
                  blockchainStatus: update.verification_status,
                  transactionHash: update.transaction_hash,
                  blockNumber: update.block_number
                };
              }
              return item;
            }));

            setVerificationResult((prev) => {
              if (prev && prev.record_id === update.sensor_record_id) {
                return {
                  ...prev,
                  verification_status: update.verification_status,
                  transaction_hash: update.transaction_hash,
                  block_number: update.block_number,
                  message: "VERIFIED: Cryptographic proof confirmed. Recalculated hash matches contract-stored hash on-chain."
                };
              }
              return prev;
            });
          }
          
          else if (msg.type === "DEVICE_STATUS_UPDATED") {
            const statusUpdate = msg.data;
            if (statusUpdate.device_id === DEVICE_ID) {
              setDeviceStatus(statusUpdate);
            }
          }
          
          else if (msg.type === "DEVICE_HEALTH_UPDATED") {
            const healthUpdate = msg.data;
            if (healthUpdate.device_id === DEVICE_ID) {
              setDeviceHealth(healthUpdate);
            }
          }
          
          else if (msg.type === "COMMUNICATION_METRICS_UPDATED") {
            const metricsUpdate = msg.data;
            if (metricsUpdate.device_id === DEVICE_ID) {
              setCommMetrics(metricsUpdate);
            }
          }
          
          else if (msg.type === "OTA_STATUS_UPDATED") {
            const otaUpdate = msg.data;
            if (otaUpdate.device_id === DEVICE_ID) {
              setOtaState(otaUpdate);
              if (otaUpdate.status === "SUCCESS" || otaUpdate.status === "FAILED") {
                fetchDeviceStatus();
                fetchLatestFirmware();
              }
            }
          }

          else if (msg.type === "MOTION_EVENT_STARTED" || msg.type === "MOTION_EVENT_CLEARED") {
            fetchMotionEvents();
          }

        } catch (err) {
          console.error("Error parsing WebSocket message:", err);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (isDestroyed) return;
        console.log(`WebSocket disconnected. Retrying connection in ${reconnectDelay}ms...`);
        reconnectTimeout = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000); // Exponential backoff capped at 30 seconds
      };

      ws.onerror = (err) => {
        if (isDestroyed) return;
        console.error("WebSocket error:", err);
        ws.close();
      };
    };

    connect();

    // Initial API Fetch
    refreshAllData();

    // Check serial support
    setIsSerialSupported("serial" in navigator);

    return () => {
      isDestroyed = true;
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      clearTimeout(reconnectTimeout);
      
      if (serialPortRef.current) {
        try {
          if (serialPortRef.current.reader) {
            serialPortRef.current.reader.cancel().catch(() => {});
          }
          serialPortRef.current.close().catch(() => {});
        } catch (err) {
          console.error("Serial cleanup error:", err);
        }
      }
    };
  }, []);

  // Fetch history again when duration changes
  useEffect(() => {
    fetchHistory();
  }, [duration]);

  // Polling fallback when WebSocket is not connected (essential on Vercel serverless)
  useEffect(() => {
    if (wsConnected) return;
    const interval = setInterval(() => {
      refreshAllData();
    }, 3000);
    return () => clearInterval(interval);
  }, [wsConnected]);

  // Web Serial API Actions
  const connectSerial = async () => {
    if (!("serial" in navigator)) return;
    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      setSerialPort(port);
      serialPortRef.current = port;
      setSerialConnected(true);
      setSerialLogs((prev) => [...prev, "[System] Connected to Serial Port at 115200 baud."]);

      // Read loop
      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();

      port.reader = reader;
      port.streamClosed = readableStreamClosed;
      port.decoder = textDecoder;

      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            buffer += value;
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            
            if (lines.length > 0) {
              setSerialLogs((prev) => {
                const updated = [...prev, ...lines];
                if (updated.length > 150) {
                  return updated.slice(updated.length - 150);
                }
                return updated;
              });

              // Auto-refresh metrics on successful NRF transmission output
              for (const line of lines) {
                if (line.includes("Transmission: SUCCESSFUL") || line.includes("HTTP Response code: 200")) {
                  setTimeout(refreshAllData, 300);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("Serial read error:", err);
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      console.error("Serial connection failed:", err);
      setSerialLogs((prev) => [...prev, `[System Error] Connection failed: ${err instanceof Error ? err.message : String(err)}`]);
    }
  };

  const disconnectSerial = async () => {
    if (serialPort) {
      try {
        if (serialPort.reader) {
          await serialPort.reader.cancel().catch(() => {});
        }
        await serialPort.close().catch(() => {});
      } catch (err) {
        console.error("Error closing serial port:", err);
      }
      setSerialPort(null);
      serialPortRef.current = null;
      setSerialConnected(false);
      setSerialLogs((prev) => [...prev, "[System] Serial Port Disconnected."]);
    }
  };

  // Scroll terminal logs to bottom
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollTop = terminalEndRef.current.scrollHeight;
    }
  }, [serialLogs]);

  // ----------------------------------------
  // Data Verification and Tampering Actions
  // ----------------------------------------
  const verifyData = async (recordId: number) => {
    setVerificationLoading(recordId);
    setVerificationResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/blockchain/verify/${recordId}`);
      if (res.ok) {
        const data = await res.json();
        setVerificationResult(data);
      }
    } catch (err) {
      console.error("Verification error:", err);
    } finally {
      setVerificationLoading(null);
    }
  };


  const tamperData = async (recordId: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/blockchain/tamper/${recordId}`, {
        method: "POST"
      });
      if (res.ok) {
        refreshAllData();
      }
    } catch (err) {
      console.error("Error tampering data:", err);
    }
  };

  const triggerOta = async () => {
    setOtaTriggering(true);
    setOtaState({
      status: "PREPARING",
      progress: 0,
      from_version: deviceStatus?.firmware_version || "1.0.0",
      to_version: latestFirmware?.version || "1.1.0"
    });
    try {
      const res = await fetch(`${API_BASE_URL}/devices/${DEVICE_ID}/ota/trigger`, {
        method: "POST"
      });
      if (res.ok) {
        const data = await res.json();
        console.log("OTA Update triggered:", data);
      } else {
        const errData = await res.json();
        setOtaState({
          status: "FAILED",
          progress: 0,
          error_message: errData.detail || "Trigger failed"
        });
      }
    } catch (err) {
      console.error("Error triggering OTA:", err);
      setOtaState({
        status: "FAILED",
        progress: 0,
        error_message: "Network error triggering update"
      });
    } finally {
      setOtaTriggering(false);
    }
  };

  // ----------------------------------------
  // Helper Formatters (Asia/Kolkata IST)
  // ----------------------------------------
  const formatKolkataTime = (isoString: string | Date, includeSeconds = true): string => {
    if (!isoString) return "NO DATA";
    try {
      const date = typeof isoString === "string" ? new Date(isoString) : isoString;
      if (isNaN(date.getTime())) return "NO DATA";

      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: includeSeconds ? "2-digit" : undefined,
        hour12: true
      });

      const parts = formatter.formatToParts(date);
      const partMap: Record<string, string> = {};
      parts.forEach(p => {
        partMap[p.type] = p.value;
      });

      const day = partMap.day || "";
      const month = partMap.month || "";
      const year = partMap.year || "";
      const hour = partMap.hour || "";
      const minute = partMap.minute || "";
      const second = includeSeconds ? `:${partMap.second}` : "";
      const dayPeriod = partMap.dayPeriod ? ` ${partMap.dayPeriod.toUpperCase()}` : "";

      return `${day} ${month} ${year}, ${hour}:${minute}${second}${dayPeriod} IST`;
    } catch (err) {
      console.error("Error formatting Kolkata time:", err);
      return "NO DATA";
    }
  };

  const formatKolkataTimeOnly = (isoString: string | Date): string => {
    if (!isoString) return "NO DATA";
    try {
      const date = typeof isoString === "string" ? new Date(isoString) : isoString;
      if (isNaN(date.getTime())) return "NO DATA";

      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });

      const parts = formatter.formatToParts(date);
      const partMap: Record<string, string> = {};
      parts.forEach(p => {
        partMap[p.type] = p.value;
      });

      const hour = partMap.hour || "";
      const minute = partMap.minute || "";
      const dayPeriod = partMap.dayPeriod ? ` ${partMap.dayPeriod.toUpperCase()}` : "";

      return `${hour}:${minute}${dayPeriod} IST`;
    } catch (err) {
      console.error("Error formatting Kolkata time:", err);
      return "NO DATA";
    }
  };

  const getRelativeLastSeen = (isoString: string) => {
    if (!isoString) return "";
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 5) return "just now";
    if (diffSec < 60) return `${diffSec} seconds ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} minutes ago`;
    return "";
  };

  const getHeaderBadge = () => {
    if (deviceStatus && deviceStatus.status === "ONLINE") {
      return {
        text: "LIVE HARDWARE DATA",
        classes: "bg-emerald-50 border border-emerald-200 text-emerald-700",
        dotColor: "bg-emerald-400"
      };
    }
    return {
      text: "HARDWARE OFFLINE",
      classes: "bg-red-50 border border-red-200 text-red-700",
      dotColor: "bg-red-400"
    };
  };

  const renderPublicScanPage = () => {
    const handleBackToDashboard = () => {
      setQrRecordId(null);
      window.history.pushState(null, "", "/");
    };

    const handleRetry = async () => {
      setLoadingPublicRecord(true);
      setPublicRecordError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/sensor-data/${qrRecordId}`);
        if (res.ok) {
          const data = await res.json();
          setPublicRecord(data);
        } else if (res.status === 404) {
          setPublicRecordError("Sensor record not found. It may have been deleted or the identifier is invalid.");
        } else {
          setPublicRecordError("A backend connection or validation error occurred.");
        }
      } catch (err) {
        console.error("Error retrying fetch:", err);
        setPublicRecordError("Network connection error. Please check your internet connection.");
      } finally {
        setLoadingPublicRecord(false);
      }
    };

    if (loadingPublicRecord) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
          <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xl flex flex-col items-center max-w-sm w-full">
            <Loader2 className="w-10 h-10 animate-spin text-black mb-4" />
            <h2 className="text-base font-bold text-black mb-1">Loading Sensor Data...</h2>
            <p className="text-xs text-slate-500">Retrieving public cryptographic proof from Node & Blockchain.</p>
          </div>
        </div>
      );
    }

    if (publicRecordError || !publicRecord) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
          <div className="p-6 bg-white border border-red-100 rounded-2xl shadow-xl flex flex-col items-center max-w-sm w-full">
            <AlertTriangle className="w-12 h-12 text-red-600 mb-4 animate-bounce" />
            <h2 className="text-lg font-black text-black mb-2">Record Unavailable</h2>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
              {publicRecordError || "An unexpected error occurred while loading this sensor record."}
            </p>
            <div className="flex flex-col gap-2.5 w-full">
              <button
                onClick={handleRetry}
                className="w-full py-2.5 px-4 bg-black text-white hover:bg-slate-800 rounded-xl text-xs font-bold transition-all shadow"
              >
                Try Again
              </button>
              <button
                onClick={handleBackToDashboard}
                className="w-full py-2.5 px-4 bg-white border border-slate-200 text-slate-600 hover:text-black rounded-xl text-xs font-semibold transition-all hover:bg-slate-50"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    const recUrl = `${window.location.origin}/data/${publicRecord.record_id}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(recUrl)}`;

    return (
      <div className="min-h-screen bg-slate-50 text-black flex flex-col font-sans">
        {/* PUBLIC PAGE HEADER */}
        <header className="border-b border-slate-200 bg-white sticky top-0 z-40 px-4 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-black" />
            <span className="text-sm font-black tracking-tight text-black">SENSOR DATA</span>
          </div>
          <button
            onClick={handleBackToDashboard}
            className="text-xs font-bold text-slate-600 hover:text-black transition-colors"
          >
            Dashboard
          </button>
        </header>

        <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 space-y-6">
          
          {/* VERIFICATION STATE INDICATOR BAR */}
          <div className="w-full">
            {publicRecord.blockchain_status === "VERIFIED" && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-center gap-2 text-xs font-black shadow-sm uppercase tracking-wide">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>✓ DATA VERIFIED</span>
              </div>
            )}
            {publicRecord.blockchain_status === "INTEGRITY_FAILURE" && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl flex items-center justify-center gap-2 text-xs font-black shadow-sm uppercase tracking-wide animate-pulse">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>⚠ DATA INTEGRITY WARNING</span>
              </div>
            )}
            {publicRecord.blockchain_status === "UNAVAILABLE" && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl flex items-center justify-center gap-2 text-xs font-black shadow-sm uppercase tracking-wide">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                <span>— VERIFICATION UNAVAILABLE</span>
              </div>
            )}
            {publicRecord.blockchain_status === "PENDING" && (
              <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-xl flex items-center justify-center gap-2 text-xs font-black shadow-sm uppercase tracking-wide animate-pulse">
                <RefreshCw className="w-4 h-4 text-blue-600 shrink-0 animate-spin" />
                <span>BLOCKCHAIN REGISTRY PENDING</span>
              </div>
            )}
          </div>

          {/* LARGE VALUES BOX */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6 text-center">
            
            {/* Primary reading numbers */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 border border-slate-100 rounded-xl py-4 flex flex-col justify-center">
                <span className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Temperature</span>
                <span className="text-3xl font-black text-black tracking-tight">
                  {publicRecord.temperature.toFixed(2)}
                  <span className="text-sm font-semibold text-slate-500 ml-0.5">°C</span>
                </span>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-xl py-4 flex flex-col justify-center">
                <span className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Humidity</span>
                <span className="text-3xl font-black text-black tracking-tight">
                  {publicRecord.humidity.toFixed(2)}
                  <span className="text-sm font-semibold text-slate-500 ml-0.5">%</span>
                </span>
              </div>
            </div>

            {/* Motion status container */}
            <div className={`p-4 rounded-xl border flex flex-col items-center justify-center ${
              publicRecord.motion
                ? "bg-red-50 border-red-200 text-red-800"
                : "bg-slate-50 border-slate-150 text-slate-700"
            }`}>
              <span className="text-[10px] uppercase font-bold text-slate-400 mb-1">PIR Motion Link</span>
              <div className="flex items-center gap-2">
                <Activity className={`w-4 h-4 ${publicRecord.motion ? "text-red-700 animate-pulse" : "text-slate-400"}`} />
                <span className="text-sm font-extrabold uppercase tracking-wide">
                  {publicRecord.motion ? "MOTION DETECTED" : "QUIET (NO MOTION)"}
                </span>
              </div>
            </div>

            {/* Sub-packet info */}
            <div className="flex justify-between items-center text-xs text-slate-500 px-1 border-t border-slate-100 pt-4">
              <span>Packet ID: <strong className="text-black font-semibold">#{publicRecord.packet_number}</strong></span>
              <span>{formatKolkataTime(publicRecord.timestamp)}</span>
            </div>
          </div>

          {/* DETAILED INFO PANEL */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100 pb-2">Technical Metadata</h3>
            
            <div className="space-y-3.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Device Node:</span>
                <span className="font-semibold text-black">{publicRecord.device_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Firmware:</span>
                <span className="font-semibold text-black">{publicRecord.firmware_version}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Device Health:</span>
                <span className="font-semibold text-black">{publicRecord.device_health}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">NRF24 Link:</span>
                <span className={`font-bold ${publicRecord.nrf_status === "CONNECTED" ? "text-emerald-600" : "text-red-600"}`}>
                  {publicRecord.nrf_status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Wi-Fi Status:</span>
                <span className={`font-bold ${publicRecord.wifi_status === "CONNECTED" ? "text-emerald-600" : "text-red-600"}`}>
                  {publicRecord.wifi_status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Backend Connection:</span>
                <span className="font-bold text-emerald-600">CONNECTED</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-slate-500">Blockchain Proof:</span>
                <span className={`font-bold uppercase ${
                  publicRecord.blockchain_status === "VERIFIED" ? "text-emerald-600" :
                  publicRecord.blockchain_status === "INTEGRITY_FAILURE" ? "text-red-600 animate-pulse" : "text-amber-600"
                }`}>
                  {publicRecord.blockchain_status}
                </span>
              </div>

              {publicRecord.hash && (
                <div className="space-y-1 pt-1.5 border-t border-slate-100">
                  <span className="text-slate-500 block">SHA-256 Digest Hash:</span>
                  <code className="block bg-slate-50 p-2 rounded border border-slate-200 overflow-hidden text-ellipsis font-mono text-[10px] text-slate-800 select-all text-left">
                    {publicRecord.hash}
                  </code>
                </div>
              )}
            </div>
          </div>

          {/* DYNAMIC CENTERED QR CODE CARD */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col items-center text-center space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Public Record QR</h3>
            
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl inline-block shadow-inner select-none">
              <img
                src={qrCodeUrl}
                alt={`QR code for Sensor Record #${publicRecord.packet_number}`}
                className="w-44 h-44 rounded-xl border border-slate-100"
              />
            </div>
            
            <p className="text-xs text-slate-500 leading-normal max-w-[240px]">
              Scan QR code with another smartphone to verify this record or share it instantly.
            </p>
          </div>

          {/* ACTIONS ROW */}
          <div className="grid grid-cols-2 gap-3 pb-8">
            <button
              onClick={() => copyRecordLink(publicRecord.record_id)}
              className="py-2.5 px-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy URL
            </button>
            <button
              onClick={() => shareRecord(publicRecord.record_id, publicRecord.packet_number)}
              className="py-2.5 px-4 bg-black text-white hover:bg-slate-800 rounded-xl text-xs font-bold transition-all shadow flex items-center justify-center gap-1.5"
            >
              <Share2 className="w-3.5 h-3.5" />
              Share Link
            </button>
          </div>

        </main>
      </div>
    );
  };

  if (qrRecordId) {
    return renderPublicScanPage();
  }

  return (
    <div className="min-h-screen bg-white text-black flex flex-col font-sans">
      
      {/* TOP HEADER */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-black rounded-lg shadow-sm">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-black">
                Blockchain Secure IoT
              </h1>
              <p className="text-xs text-slate-500 font-medium">Environmental & Motion Monitor</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            
            {/* Live Hardware Status Badge */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold uppercase tracking-wider ${
              getHeaderBadge().classes
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${getHeaderBadge().dotColor} pulse-led`} />
              {getHeaderBadge().text}
            </div>

            {/* WebSocket Status */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${
              wsConnected
                ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                : "bg-red-50 border-red-200 text-red-700"
            }`}>
              {wsConnected ? <Wifi className="w-3.5 h-3.5 text-emerald-600" /> : <WifiOff className="w-3.5 h-3.5 text-red-600" />}
              {wsConnected ? "Connected" : "Reconnecting"}
            </div>

            {/* Live India Clock (Asia/Kolkata) */}
            <div className="bg-white border border-slate-200 text-black flex items-center gap-2 px-3 py-1.5 rounded-xl shadow-sm text-xs font-semibold">
              <Clock className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              
              {/* Desktop version (05:58:32 PM \n 16 Aug 2026 • IST) */}
              <div className="hidden lg:flex flex-col text-left leading-tight">
                <span className="font-mono tabular-nums">{formattedTimeDesktop}</span>
                <span className="text-[10px] text-slate-500 font-medium whitespace-nowrap">{formattedDateDesktop} • IST</span>
              </div>

              {/* Tablet version (05:58 PM IST) */}
              <div className="hidden sm:inline-block lg:hidden font-mono tabular-nums whitespace-nowrap">
                {formattedTimeTabletMobile} IST
              </div>

              {/* Mobile version (05:58 PM) */}
              <div className="inline-block sm:hidden font-mono tabular-nums whitespace-nowrap">
                {formattedTimeTabletMobile}
              </div>
            </div>

            {/* Device Selector (Static for single receiver-01) */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-800 px-3 py-1.5 rounded-xl shadow-sm text-xs font-bold select-none">
              <Cpu className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
              <span>Node: receiver-01</span>
            </div>

            {/* Manual Refresh */}
            <button
              onClick={refreshAllData}
              className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-black hover:border-slate-300 transition-colors shadow-sm"
              title="Refresh API Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
        
        {/* Warning Banner for Stale/Offline Data */}
        {!isLive && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl flex items-center gap-2.5 text-xs font-semibold shadow-sm animate-pulse">
            <AlertTriangle className="w-4.5 h-4.5 text-red-600 shrink-0" />
            <span>🔴 HARDWARE OFFLINE | Last Seen: {deviceStatus?.last_seen ? formatKolkataTime(deviceStatus.last_seen) : "Unknown"} | Buffered: {deviceStatus?.buffer_count ?? 0} packets</span>
          </div>
        )}

        {/* TOP ROW: LIVE SENSORS SUMMARY */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Temperature Card */}
          <div className="glass-card flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-500">Live Temperature</span>
              <div className="p-2 bg-slate-100 rounded-xl">
                <Thermometer className="w-5 h-5 text-black" />
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black tracking-tight text-black">
                  {isLive && sensorData ? `${sensorData.temperature.toFixed(1)}` : "--"}
                </span>
                <span className="text-xl font-bold text-slate-500">°C</span>
              </div>
              <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Updated: {isLive && sensorData ? formatKolkataTime(sensorData.receivedAt) : "NO DATA"}
              </p>
            </div>
          </div>

          {/* Humidity Card */}
          <div className="glass-card flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-500">Live Humidity</span>
              <div className="p-2 bg-slate-100 rounded-xl">
                <Droplets className="w-5 h-5 text-black" />
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black tracking-tight text-black">
                  {isLive && sensorData ? `${sensorData.humidity.toFixed(1)}` : "--"}
                </span>
                <span className="text-xl font-bold text-slate-500">%</span>
              </div>
              <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Updated: {isLive && sensorData ? formatKolkataTime(sensorData.receivedAt) : "NO DATA"}
              </p>
            </div>
          </div>

          {/* Motion Card */}
          <div className={`transition-all duration-200 flex flex-col justify-between ${
            isLive && sensorData?.motion 
              ? "bg-red-50 border border-red-200 shadow-sm rounded-lg p-6"
              : "glass-card"
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-500">PIR Motion Link</span>
              <div className={`p-2 rounded-xl ${isLive && sensorData?.motion ? "bg-red-100" : "bg-slate-100"}`}>
                <Activity className={`w-5 h-5 ${isLive && sensorData?.motion ? "text-red-700 animate-pulse" : "text-slate-400"}`} />
              </div>
            </div>
            <div className="mt-4">
              <span className={`text-2xl font-extrabold tracking-tight uppercase ${
                isLive && sensorData ? (sensorData.motion ? "text-red-700" : "text-slate-800") : "text-slate-400"
              }`}>
                {isLive && sensorData ? (sensorData.motion ? "MOTION DETECTED" : "NO MOTION") : "NO DATA"}
              </span>
              <p className="text-xs text-slate-500 mt-3.5 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Last Event: {isLive && sensorData && motionEvents.length > 0 ? formatKolkataTime(motionEvents[0].detected_at) : "NO DATA"}
              </p>
            </div>
          </div>
        </section>

        {/* SECTION 1: DIGITAL TWIN & DEVICE HEALTH */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* DIGITAL TWIN CARD */}
          <div className="glass-card lg:col-span-2 flex flex-col justify-between">
            <div className="border-b border-slate-200 pb-3 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-black" />
                <h2 className="text-lg font-bold text-black">Digital Twin</h2>
              </div>
              <span className="text-xs text-slate-500 font-semibold">DEVICE #001</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Device ID:</span>
                  <span className="font-semibold text-black">{DEVICE_ID}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Status:</span>
                  <span className={`font-bold flex items-center gap-1.5 uppercase ${
                    deviceStatus?.status === "ONLINE" ? "text-emerald-600" :
                    deviceStatus?.status === "UPDATING" ? "text-blue-600" : "text-red-600"
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${
                      deviceStatus?.status === "ONLINE" ? "bg-emerald-500" :
                      deviceStatus?.status === "UPDATING" ? "bg-blue-500" : "bg-red-500"
                    } pulse-led`} />
                    {deviceStatus?.status || "OFFLINE"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Temperature:</span>
                  <span className="font-bold text-black">
                    {isLive && deviceStatus?.last_temperature !== null ? `${deviceStatus?.last_temperature?.toFixed(1)} °C` : "--"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Humidity:</span>
                  <span className="font-bold text-black">
                    {isLive && deviceStatus?.last_humidity !== null ? `${deviceStatus?.last_humidity?.toFixed(1)} %` : "--"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Motion:</span>
                  <span className={`font-bold uppercase ${isLive && deviceStatus?.last_motion ? "text-red-600 animate-pulse" : "text-slate-700"}`}>
                    {isLive && deviceStatus ? (deviceStatus.last_motion ? "DETECTED" : "QUIET") : "NO DATA"}
                  </span>
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Last Packet Received:</span>
                  <span className="font-semibold text-black">
                    {isLive && deviceStatus?.last_packet_number !== null ? `#${deviceStatus.last_packet_number}` : "--"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Last Seen Timestamp:</span>
                  <span className="font-semibold text-slate-800 text-xs">
                    {deviceStatus?.last_seen ? `${formatKolkataTime(deviceStatus.last_seen)} (${getRelativeLastSeen(deviceStatus.last_seen)})` : "Unknown"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Wi-Fi Connection:</span>
                  <span className={`font-semibold ${deviceStatus?.wifi_status === "CONNECTED" ? "text-emerald-600" : "text-red-600"}`}>
                    {deviceStatus?.wifi_status || "DISCONNECTED"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">NRF24 Link:</span>
                  <span className={`font-semibold ${deviceStatus?.nrf_status === "ACTIVE" ? "text-emerald-600" : "text-red-600"}`}>
                    {deviceStatus?.nrf_status === "ACTIVE" ? "CONNECTED" : "DISCONNECTED"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Backend Connection:</span>
                  <span className={`font-semibold ${wsConnected ? "text-emerald-600" : "text-red-600 animate-pulse"}`}>
                    {wsConnected ? "CONNECTED" : "DISCONNECTED / POLLING"}
                  </span>
                </div>
              </div>
            </div>

            {/* Link Connection Flowchart Diagram */}
            <div className="border border-slate-100 rounded-xl p-4 bg-slate-50 flex flex-wrap items-center justify-between gap-4 mt-6">
              <div className="flex flex-col items-center">
                <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-sm flex items-center justify-center">
                  <Cpu className="w-5 h-5 text-slate-700" />
                </div>
                <span className="text-[10px] font-bold text-slate-500 mt-1">ESP32 TX</span>
                <span className="text-[9px] text-emerald-600 font-bold">🟢 ACTIVE</span>
              </div>
              
              <ArrowRight className="w-4 h-4 text-slate-400 hidden md:block" />

              <div className="flex flex-col items-center">
                <div className={`px-2 py-1 rounded text-[10px] font-bold border ${
                  deviceStatus?.nrf_status === "ACTIVE"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-red-50 border-red-200 text-red-700 animate-pulse"
                }`}>
                  NRF24 LINK {deviceStatus?.nrf_status === "ACTIVE" ? "🟢" : "🔴"}
                </div>
              </div>

              <ArrowRight className="w-4 h-4 text-slate-400 hidden md:block" />

              <div className="flex flex-col items-center">
                <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-sm flex items-center justify-center">
                  <Cpu className="w-5 h-5 text-slate-700" />
                </div>
                <span className="text-[10px] font-bold text-slate-500 mt-1">ESP32 RX</span>
                <span className={`text-[9px] font-bold ${isLive ? "text-emerald-600" : "text-red-600"}`}>
                  {isLive ? "🟢 ONLINE" : "🔴 OFFLINE"}
                </span>
              </div>

              <ArrowRight className="w-4 h-4 text-slate-400 hidden md:block" />

              <div className="flex flex-col items-center">
                <div className={`px-2 py-1 rounded text-[10px] font-bold border ${
                  deviceStatus?.wifi_status === "CONNECTED"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-red-50 border-red-200 text-red-700 animate-pulse"
                }`}>
                  Wi-Fi {deviceStatus?.wifi_status === "CONNECTED" ? "🟢" : "🔴"}
                </div>
              </div>

              <ArrowRight className="w-4 h-4 text-slate-400 hidden md:block" />

              <div className="flex flex-col items-center">
                <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-sm flex items-center justify-center">
                  <Database className="w-5 h-5 text-slate-700" />
                </div>
                <span className="text-[10px] font-bold text-slate-500 mt-1">Cloud</span>
                <span className={`text-[9px] font-bold ${wsConnected ? "text-emerald-600" : "text-red-600"}`}>
                  {wsConnected ? "🟢 CONNECTED" : "🔴 OFFLINE"}
                </span>
              </div>

              <ArrowRight className="w-4 h-4 text-slate-400 hidden md:block" />

              <div className="flex flex-col items-center">
                <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-sm flex items-center justify-center">
                  <Shield className="w-5 h-5 text-slate-700" />
                </div>
                <span className="text-[10px] font-bold text-slate-500 mt-1">Dashboard</span>
                <span className="text-[9px] text-emerald-600 font-bold">🟢 ACTIVE</span>
              </div>
            </div>
          </div>

          {/* DEVICE HEALTH CARD */}
          <div className="glass-card flex flex-col justify-between">
            <div className="border-b border-slate-200 pb-3">
              <h2 className="text-lg font-bold text-black">Device Health</h2>
            </div>

            <div className="flex flex-col items-center justify-center py-4">
              <div className="relative flex items-center justify-center">
                <div className="w-24 h-24 rounded-full border-4 border-slate-100 flex flex-col items-center justify-center">
                  <span className="text-3xl font-black text-black">{deviceHealth?.overall_score ?? 100}%</span>
                  <span className={`text-[10px] font-extrabold tracking-wider ${
                    (deviceHealth?.overall_score ?? 100) >= 90 ? "text-emerald-600" :
                    (deviceHealth?.overall_score ?? 100) >= 75 ? "text-blue-600" :
                    (deviceHealth?.overall_score ?? 100) >= 50 ? "text-amber-600" : "text-red-600"
                  }`}>
                    {deviceHealth?.status_label ?? "EXCELLENT"}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2.5 text-xs">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-500 font-semibold">NRF24 Link Reliability</span>
                  <span className="text-black font-bold">{deviceHealth?.nrf_score ?? 100}%</span>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-black h-full" style={{ width: `${deviceHealth?.nrf_score ?? 100}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-500 font-semibold">Wi-Fi Connection</span>
                  <span className="text-black font-bold">{deviceHealth?.wifi_score ?? 100}%</span>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-black h-full" style={{ width: `${deviceHealth?.wifi_score ?? 100}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-500 font-semibold">Sensors Validity</span>
                  <span className="text-black font-bold">{deviceHealth?.sensors_score ?? 100}%</span>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-black h-full" style={{ width: `${deviceHealth?.sensors_score ?? 100}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-500 font-semibold">Backend Availability</span>
                  <span className="text-black font-bold">{deviceHealth?.backend_score ?? 100}%</span>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-black h-full" style={{ width: `${deviceHealth?.backend_score ?? 100}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-500 font-semibold">Packet Reliability</span>
                  <span className="text-black font-bold">{deviceHealth?.packet_score ?? 100}%</span>
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-black h-full" style={{ width: `${deviceHealth?.packet_score ?? 100}%` }} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: COMMUNICATIONS & OTA & OFFLINE BUFFER */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* COMMUNICATION CARD */}
          <div className="glass-card flex flex-col justify-between">
            <div className="border-b border-slate-200 pb-2.5 flex justify-between items-center">
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-black text-sm">Wireless Analytics</h3>
                <div className="flex items-center gap-1 text-[9px] text-slate-400 font-semibold ml-2 select-none" onClick={(e) => e.stopPropagation()}>
                  <span>W:</span>
                  <input
                    type="number"
                    value={lossThresholdWarning}
                    onChange={(e) => setLossThresholdWarning(parseFloat(e.target.value) || 0)}
                    className="w-7 border border-slate-200 rounded text-black font-bold text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-slate-400"
                    step="0.1"
                    min="0"
                    max="100"
                    title="Warning Threshold (%)"
                  />
                  <span>P:</span>
                  <input
                    type="number"
                    value={lossThresholdPoor}
                    onChange={(e) => setLossThresholdPoor(parseFloat(e.target.value) || 0)}
                    className="w-7 border border-slate-200 rounded text-black font-bold text-center bg-transparent focus:outline-none focus:ring-1 focus:ring-slate-400"
                    step="0.1"
                    min="0"
                    max="100"
                    title="Poor Threshold (%)"
                  />
                </div>
              </div>
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded border uppercase ${
                (commMetrics?.packet_loss_percentage ?? 0.0) < lossThresholdWarning
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : (commMetrics?.packet_loss_percentage ?? 0.0) < lossThresholdPoor
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-red-50 border-red-200 text-red-700 animate-pulse"
              }`}>
                NRF24: { (commMetrics?.packet_loss_percentage ?? 0.0) < lossThresholdWarning ? "GOOD" : (commMetrics?.packet_loss_percentage ?? 0.0) < lossThresholdPoor ? "WARNING" : "POOR" }
              </span>
            </div>

            <div className="mt-4 space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Packets Sent:</span>
                <span className="font-bold text-black">{commMetrics?.packets_sent?.toLocaleString() ?? "0"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Packets Received:</span>
                <span className="font-bold text-black">{commMetrics?.packets_received?.toLocaleString() ?? "0"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Packets Lost:</span>
                <span className="font-bold text-red-600">{commMetrics?.packets_lost ?? "0"}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Packet Loss Rate:</span>
                <span className="font-bold text-black">{(commMetrics?.packet_loss_percentage ?? 0.0).toFixed(2)} %</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-slate-500">Average Latency:</span>
                <span className="font-semibold text-black">
                  {commMetrics?.average_latency != null ? `${Math.round(commMetrics.average_latency)} ms` : "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Min / Max Latency:</span>
                <span className="font-semibold text-slate-800">
                  {commMetrics?.min_latency != null && commMetrics?.max_latency != null
                    ? `${Math.round(commMetrics.min_latency)} ms / ${Math.round(commMetrics.max_latency)} ms`
                    : "N/A"
                  }
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Wi-Fi Reconnects:</span>
                <span className="font-bold text-black">{commMetrics?.wifi_reconnects ?? "0"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Backend Upload Failures:</span>
                <span className="font-bold text-red-600">{commMetrics?.backend_failures ?? "0"}</span>
              </div>
            </div>
          </div>

          {/* OFFLINE BUFFER CARD */}
          <div className="glass-card flex flex-col justify-between">
            <div className="border-b border-slate-200 pb-2.5">
              <h3 className="font-bold text-black text-sm">Offline Data Buffer</h3>
            </div>

            <div className="flex flex-col items-center justify-center py-3">
              <div className="p-3 bg-slate-50 rounded-full border border-slate-100 mb-2">
                <UploadCloud className={`w-8 h-8 ${deviceStatus?.buffer_count ? "text-blue-600 animate-bounce" : "text-slate-400"}`} />
              </div>
              <span className="text-2xl font-black text-black">{deviceStatus?.buffer_count ?? 0}</span>
              <span className="text-[10px] text-slate-500 font-bold uppercase mt-1">Packets in Buffer</span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <span className="text-slate-500 font-semibold">Sync Status:</span>
                <span className={`font-bold px-2 py-0.5 rounded text-[10px] border uppercase ${
                  (deviceStatus?.buffer_count ?? 0) === 0
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : isLive
                    ? "bg-blue-50 border-blue-200 text-blue-700 animate-pulse"
                    : "bg-amber-50 border-amber-200 text-amber-700"
                }`}>
                  {(deviceStatus?.buffer_count ?? 0) === 0 ? "SYNCED ✓" : isLive ? "SYNCING" : "PENDING SYNC"}
                </span>
              </div>
              
              <div className="text-[10px] text-slate-500 text-center leading-normal">
                {(deviceStatus?.buffer_count ?? 0) > 0
                  ? "Packets will automatically synchronize once Wi-Fi is restored and backend is available."
                  : "All data successfully synced with backend storage."}
              </div>
            </div>
          </div>

          {/* FIRMWARE / OTA CARD */}
          <div className="glass-card flex flex-col justify-between">
            <div className="border-b border-slate-200 pb-2.5 flex justify-between items-center">
              <h3 className="font-bold text-black text-sm">Firmware Update (OTA)</h3>
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded border uppercase ${
                otaState.status !== "IDLE" && otaState.status !== "SUCCESS" && otaState.status !== "FAILED"
                  ? "bg-blue-50 border-blue-200 text-blue-700 animate-pulse"
                  : (deviceStatus?.firmware_version !== latestFirmware?.version && latestFirmware?.version)
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : "bg-emerald-50 border-emerald-200 text-emerald-700"
              }`}>
                {otaState.status !== "IDLE" && otaState.status !== "SUCCESS" && otaState.status !== "FAILED" ? getOtaStatusText() :
                 (deviceStatus?.firmware_version !== latestFirmware?.version && latestFirmware?.version) ? "UPDATE AVAILABLE" : "UP TO DATE"}
              </span>
            </div>

            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Current Version:</span>
                <span className="font-bold text-black">v{deviceStatus?.firmware_version || "1.0.0"}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">Latest Available:</span>
                <span className="font-bold text-black">v{latestFirmware?.version || "1.1.0"}</span>
              </div>

              {/* OTA Progress visualizer */}
              {otaState.status !== "IDLE" && (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5 space-y-1.5">
                  <div className="flex justify-between font-bold text-[10px] uppercase items-center">
                    <span className="text-slate-600 flex items-center gap-1">
                      {otaState.status === "SUCCESS" && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                      {getOtaStatusText()}
                    </span>
                    <span className="text-black">{otaState.progress}%</span>
                  </div>
                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div className="bg-black h-full transition-all duration-300" style={{ width: `${otaState.progress}%` }} />
                  </div>
                  {otaState.error_message && (
                    <span className="text-[9px] text-red-600 block leading-tight">{otaState.error_message}</span>
                  )}
                </div>
              )}

              <button
                onClick={triggerOta}
                disabled={otaTriggering || (otaState.status !== "IDLE" && otaState.status !== "SUCCESS" && otaState.status !== "FAILED") || (deviceStatus?.firmware_version === latestFirmware?.version)}
                className="w-full py-2 bg-black hover:bg-slate-800 disabled:bg-slate-100 text-white disabled:text-slate-400 rounded-lg text-xs font-bold transition-all mt-2 uppercase tracking-wider"
              >
                {otaTriggering ? "Triggering..." : "Update Device"}
              </button>
            </div>
          </div>
        </section>

        {/* SECTION 3: LIVE DATA & HISTORICAL CHARTS */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* LIVE SENSORS GRAPH */}
          <div className="glass-card lg:col-span-2 flex flex-col justify-between gap-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-black" />
                <h3 className="text-sm font-bold text-black">Metrics Live Trend</h3>
              </div>

              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                {(["1h", "6h", "24h", "7d"] as string[]).map((time) => (
                  <button
                    key={time}
                    onClick={() => setDuration(time)}
                    className={`px-2.5 py-1 rounded-md transition-all text-xs font-semibold ${
                      duration === time 
                        ? "bg-black text-white shadow-sm"
                        : "text-slate-600 hover:text-black"
                    }`}
                  >
                    {time.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-64 mt-2">
              {loadingHistory ? (
                <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading historical dataset...
                </div>
              ) : history.length === 0 ? (
                <div className="w-full h-full flex items-center justify-center text-slate-500 text-xs">
                  No sensor history available.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorHum" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#059669" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#059669" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="receivedAt" 
                      tickFormatter={formatKolkataTimeOnly} 
                      stroke="#94a3b8" 
                      fontSize={10} 
                    />
                    <YAxis stroke="#94a3b8" fontSize={10} />
                    <Tooltip
                      contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", color: "#000000" }}
                      labelFormatter={(label) => formatKolkataTime(label)}
                      itemStyle={{ fontSize: "11px" }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="temperature" 
                      stroke="#2563eb" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorTemp)" 
                      name="Temp (°C)"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="humidity" 
                      stroke="#059669" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorHum)" 
                      name="Humidity (%)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          
          {/* TABBED BOX: MOTION ALERT LOG & HARDWARE SERIAL MONITOR */}
          <div className="glass-card flex flex-col justify-between gap-4">
            
            {/* Header Tabs */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveRightTab("motion")}
                  className={`flex items-center gap-1.5 pb-2 -mb-3.5 border-b-2 transition-all text-xs font-bold ${
                    activeRightTab === "motion"
                      ? "border-black text-black"
                      : "border-transparent text-slate-500 hover:text-black"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Motion Alerts</span>
                </button>
                
                <button
                  onClick={() => setActiveRightTab("serial")}
                  className={`flex items-center gap-1.5 pb-2 -mb-3.5 border-b-2 transition-all text-xs font-bold ${
                    activeRightTab === "serial"
                      ? "border-black text-black"
                      : "border-transparent text-slate-500 hover:text-black"
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Serial Monitor</span>
                </button>
              </div>

              {/* Action Buttons for Serial Monitor */}
              {activeRightTab === "serial" && (
                <div className="flex gap-1.5">
                  {serialConnected ? (
                    <button
                      onClick={disconnectSerial}
                      className="px-2 py-0.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded text-[10px] font-bold transition-all"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={connectSerial}
                      disabled={!isSerialSupported}
                      className="px-2 py-0.5 bg-black border border-black hover:bg-slate-800 text-white rounded text-[10px] font-bold transition-all"
                      title={isSerialSupported ? "Connect to local ESP32 USB COM Port" : "Web Serial not supported in this browser"}
                    >
                      Connect ESP32
                    </button>
                  )}
                  <button
                    onClick={() => setSerialLogs([])}
                    className="px-2 py-0.5 bg-white border border-slate-200 text-slate-500 hover:text-black hover:border-slate-300 rounded text-[10px] font-bold transition-all"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* Content Body */}
            {activeRightTab === "motion" ? (
              <div className="flex-1 overflow-y-auto max-h-60 pr-1 space-y-3 scrollbar-thin">
                {motionEvents.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 text-xs py-8">
                    <Activity className="w-8 h-8 mb-2 stroke-[1] text-slate-400" />
                    No motion incidents recorded.
                  </div>
                ) : (
                  motionEvents.map((evt) => (
                    <div key={evt.id} className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex justify-between gap-3 text-xs leading-normal">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-red-700 font-bold">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-600" />
                          <span>MOTION DETECTED</span>
                        </div>
                        <p className="text-slate-500 text-[10px] flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          Started: {formatKolkataTime(evt.detected_at)}
                        </p>
                      </div>
                      
                      <div className="text-right shrink-0 flex flex-col justify-between">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider ${
                          evt.cleared_at 
                            ? "bg-slate-100 border border-slate-200 text-slate-600" 
                            : "bg-red-50 border border-red-200 text-red-700 animate-pulse"
                        }`}>
                          {evt.cleared_at ? "CLEARED" : "ACTIVE"}
                        </span>
                        {evt.cleared_at && (
                          <span className="text-[9px] text-slate-600 block mt-1">
                            Dur: {Math.max(1, Math.round((new Date(evt.cleared_at).getTime() - new Date(evt.detected_at).getTime()) / 1000))}s
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              // Serial Monitor Console Body
              <div className="flex-1 flex flex-col justify-between gap-2.5">
                {!isSerialSupported ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 p-6">
                    <Terminal className="w-8 h-8 mb-2 stroke-[1]" />
                    <p className="text-xs max-w-[280px]">
                      Web Serial API is not supported in this browser. Please use Chrome, Edge, or Opera to connect directly to your ESP32's COM port.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col h-[230px] bg-slate-50 border border-slate-200 rounded-xl p-3 font-mono text-[10px] text-slate-800 select-text overflow-hidden">
                    <div 
                      className="flex-1 overflow-y-auto pr-1 space-y-0.5 scrollbar-thin scroll-smooth" 
                      ref={terminalEndRef}
                    >
                      {serialLogs.length === 0 ? (
                        <div className="text-slate-500 text-center py-14 font-sans">
                          {serialConnected ? (
                            <span>Serial port opened. Waiting for data...</span>
                          ) : (
                            <>
                              <span className="block font-semibold">ESP32 Serial Monitor</span>
                              <span className="block text-[10px] mt-1 text-slate-400">Click "Connect ESP32" above to view live debug logs.</span>
                            </>
                          )}
                        </div>
                      ) : (
                        serialLogs.map((log, idx) => (
                          <div key={idx} className="whitespace-pre-wrap break-all leading-normal">
                            {log}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </section>

        {/* SECTION 4: BLOCKCHAIN INTEGRITY & TRUST */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* BLOCKCHAIN CARD */}
          <div className="glass-card lg:col-span-2 flex flex-col justify-between gap-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-black" />
                <h2 className="text-lg font-bold text-black">Blockchain Integrity</h2>
              </div>
              <span className="text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1 rounded-md">
                EVM: Hardhat Node / Polygon
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Contract Address</label>
                  <code className="text-xs text-slate-800 bg-slate-50 px-2.5 py-1.5 rounded select-all block overflow-hidden text-ellipsis border border-slate-200 font-mono">
                    {contractAddress || "NO DATA"}
                  </code>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Latest Local Record ID</label>
                  <span className="text-black font-bold">
                    {sensorData ? `Record #${sensorData.id} (Packet #${sensorData.packetNumber})` : "NO DATA"}
                  </span>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Latest Sensor Data SHA-256 Hash</label>
                  <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded border border-slate-200 overflow-hidden">
                    <Fingerprint className="w-4 h-4 text-slate-500 shrink-0" />
                    <code className="text-xs text-slate-700 select-all overflow-hidden text-ellipsis block">
                      {sensorData?.id 
                        ? `0x${sensorData.id.toString(16).padStart(8, '0')}... (Verify below)` 
                        : "NO DATA"
                      }
                    </code>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">On-Chain Tx Receipt</label>
                  <span className="text-slate-800 text-xs break-all block bg-slate-50 p-2.5 rounded border border-slate-200 leading-normal font-mono">
                    {sensorData?.transactionHash 
                      ? sensorData.transactionHash 
                      : (sensorData ? "Pending queue mining..." : "NO DATA")
                    }
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 pt-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-0.5">Integrity Verification</label>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                      sensorData?.blockchainStatus === "VERIFIED" 
                        ? "bg-emerald-50 border border-emerald-100 text-emerald-700"
                        : sensorData?.blockchainStatus === "INTEGRITY_FAILURE"
                        ? "bg-red-50 border border-red-100 text-red-700"
                        : (sensorData ? "bg-amber-50 border border-amber-100 text-amber-700" : "bg-slate-50 border border-slate-200 text-slate-500")
                    }`}>
                      {sensorData?.blockchainStatus === "VERIFIED" && <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />}
                      {sensorData?.blockchainStatus === "INTEGRITY_FAILURE" && <ShieldAlert className="w-3.5 h-3.5 text-red-600" />}
                      {sensorData ? (sensorData.blockchainStatus || "PENDING") : "PENDING / NOT REGISTERED"}
                    </span>
                  </div>

                  {sensorData && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => verifyData(sensorData.id)}
                        disabled={verificationLoading === sensorData.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-black border border-black hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                      >
                        {verificationLoading === sensorData.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Shield className="w-3.5 h-3.5" />
                        )}
                        Verify Data
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* VERIFICATION REPORT PANEL */}
          <div className="glass-card flex flex-col justify-between gap-4">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
              <Shield className="w-4 h-4 text-black" />
              <h3 className="text-sm font-bold text-black">Verification Engine Report</h3>
            </div>

            {verificationResult ? (
              <div className="text-xs space-y-3 flex-1 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Record Checked:</span>
                    <span className="text-black font-semibold">#{verificationResult.record_id}</span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-500 block">Computed Local SHA-256 Hash:</span>
                    <code className="text-slate-800 block bg-slate-50 p-2 rounded border border-slate-200 overflow-hidden text-ellipsis select-all font-mono">
                      {verificationResult.computed_hash || "NO DATA"}
                    </code>
                  </div>

                  <div className="space-y-1">
                    <span className="text-slate-500 block">On-Chain Registered Hash:</span>
                    <code className="text-slate-800 block bg-slate-50 p-2 rounded border border-slate-200 overflow-hidden text-ellipsis select-all font-mono">
                      {verificationResult.blockchain_hash || "NO DATA"}
                    </code>
                  </div>

                  <div className={`p-2.5 rounded-lg border flex items-start gap-2 ${
                    verificationResult.verification_status === "VERIFIED"
                      ? "bg-emerald-50 border border-emerald-100 text-emerald-700"
                      : verificationResult.verification_status === "INTEGRITY_FAILURE"
                      ? "bg-red-50 border border-red-100 text-red-700"
                      : "bg-amber-50 border border-amber-100 text-amber-700"
                  }`}>
                    {verificationResult.verification_status === "VERIFIED" ? (
                      <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                    )}
                    <span className="leading-normal">{verificationResult.message}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-500 pt-2 border-t border-slate-200">
                  <span>Block: #{verificationResult.block_number || "NO DATA"}</span>
                  <span>Checked just now</span>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 px-4 py-8">
                <Shield className="w-10 h-10 mb-2 stroke-[1]" />
                <p className="text-xs">No verification has been run yet. Click "Verify Data" on any reading to pull smart-contract proofs and confirm record integrity.</p>
              </div>
            )}
          </div>

        </section>

        {/* FULL DATA HISTORY TABLE */}
        <section className="glass-card flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-black" />
              <h3 className="text-sm font-bold text-black">Full Ingestion History Log & Validation</h3>
            </div>
            <span className="text-xs text-slate-500">Showing last 20 ingested packets</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3">Record ID</th>
                  <th className="py-2.5 px-3">Packet #</th>
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3">Temp (°C)</th>
                  <th className="py-2.5 px-3">Humidity (%)</th>
                  <th className="py-2.5 px-3">PIR State</th>
                  <th className="py-2.5 px-3">Latency</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Blockchain Status</th>
                  <th className="py-2.5 px-3 text-center">View</th>
                  <th className="py-2.5 px-3 text-right">Integrity Validation Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-500">
                      No ingestion logs available. Please power on the physical ESP32 gateway node.
                    </td>
                  </tr>
                ) : (
                  [...history].reverse().slice(0, 20).map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 px-3 text-slate-500 font-medium">#{row.id}</td>
                      <td className="py-3 px-3 text-black">Packet {row.packetNumber}</td>
                      <td className="py-3 px-3 text-slate-600">{formatKolkataTime(row.receivedAt)}</td>
                      <td className="py-3 px-3 text-black font-semibold">{row.temperature.toFixed(1)}°C</td>
                      <td className="py-3 px-3 text-black font-semibold">{row.humidity.toFixed(1)}%</td>
                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center gap-1 font-semibold uppercase ${
                          row.motion ? "text-red-700" : "text-slate-500"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${row.motion ? "bg-red-500" : "bg-slate-300"}`} />
                          {row.motion ? "Active" : "Quiet"}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-600">
                        {row.latency_ms !== null && row.latency_ms !== undefined ? `${row.latency_ms} ms` : "N/A"}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          row.is_buffered
                            ? "bg-blue-50 text-blue-700 border border-blue-200"
                            : "bg-slate-50 text-slate-700 border border-slate-200"
                        }`}>
                          {row.is_buffered ? "Buffered" : "Live"}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-bold ${
                          row.blockchainStatus === "VERIFIED"
                            ? "bg-emerald-50 border border-emerald-100 text-emerald-700"
                            : row.blockchainStatus === "INTEGRITY_FAILURE"
                            ? "bg-red-50 border border-red-100 text-red-700"
                            : "bg-amber-50 border border-amber-100 text-amber-700"
                        }`}>
                          {row.blockchainStatus || "PENDING"}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => setSelectedRecordId(row.publicId || null)}
                          className="inline-flex items-center justify-center p-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-black border border-slate-200 hover:border-slate-300 rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
                          aria-label="View sensor data details"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => tamperData(row.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 border border-red-200 hover:bg-red-100 text-red-700 rounded transition-colors"
                            title="Simulate database injection tampering by changing temperature to 99.9°C"
                          >
                            <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                            Tamper
                          </button>

                          <button
                            onClick={() => verifyData(row.id)}
                            disabled={verificationLoading === row.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded transition-colors disabled:opacity-50"
                          >
                            {verificationLoading === row.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Shield className="w-3.5 h-3.5 text-black" />
                            )}
                            Verify
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer className="mt-auto border-t border-slate-200 bg-slate-50 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 Secure IoT Monitoring Platform. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-slate-500" /> PostgreSQL/SQLite
            </span>
            <span className="flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-slate-500" /> Polygon Layer 2 EVM
            </span>
          </div>
        </div>
      </footer>

      {/* SENSOR DATA DETAILS MODAL */}
      {selectedRecordId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col transition-all max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-black" />
                <h2 className="text-sm font-black uppercase tracking-wider text-black">Sensor Data Details</h2>
              </div>
              <button
                onClick={() => setSelectedRecordId(null)}
                className="text-slate-400 hover:text-black font-semibold text-lg focus:outline-none p-1"
                aria-label="Close details modal"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs text-left">
              {loadingDetails ? (
                <div className="flex flex-col items-center justify-center py-12 space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin text-black" />
                  <p className="text-slate-500">Loading complete details...</p>
                </div>
              ) : detailsError || !selectedRecordDetails ? (
                <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-center">
                  <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-2" />
                  <p className="font-semibold">{detailsError || "Failed to load record details."}</p>
                  <button
                    onClick={() => {
                      const current = selectedRecordId;
                      setSelectedRecordId(null);
                      setTimeout(() => setSelectedRecordId(current), 50);
                    }}
                    className="mt-3 px-3 py-1.5 bg-white border border-red-200 text-red-700 hover:bg-red-50 rounded-lg font-bold"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {/* Values grid */}
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-slate-50 border border-slate-150 rounded-xl py-3 flex flex-col justify-center">
                      <span className="text-[9px] uppercase font-bold text-slate-400 mb-0.5">Packet Number</span>
                      <span className="text-base font-black text-black">#{selectedRecordDetails.packet_number}</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-150 rounded-xl py-3 flex flex-col justify-center">
                      <span className="text-[9px] uppercase font-bold text-slate-400 mb-0.5">Temperature</span>
                      <span className="text-base font-black text-black">
                        {selectedRecordDetails.temperature !== null ? `${selectedRecordDetails.temperature.toFixed(2)} °C` : "--"}
                      </span>
                    </div>
                    <div className="bg-slate-50 border border-slate-150 rounded-xl py-3 flex flex-col justify-center">
                      <span className="text-[9px] uppercase font-bold text-slate-400 mb-0.5">Humidity</span>
                      <span className="text-base font-black text-black">
                        {selectedRecordDetails.humidity !== null ? `${selectedRecordDetails.humidity.toFixed(2)} %` : "--"}
                      </span>
                    </div>
                  </div>

                  {/* Motion and Health */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className={`p-3 rounded-xl border flex items-center gap-2 ${
                      selectedRecordDetails.motion
                        ? "bg-red-50 border-red-100 text-red-800"
                        : "bg-slate-50 border-slate-150 text-slate-700"
                    }`}>
                      <Activity className={`w-4 h-4 ${selectedRecordDetails.motion ? "text-red-600 animate-pulse" : "text-slate-400"}`} />
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-400 block leading-none mb-0.5">Motion State</span>
                        <span className="font-extrabold uppercase text-xs">
                          {selectedRecordDetails.motion !== null ? (selectedRecordDetails.motion ? "DETECTED" : "QUIET") : "N/A"}
                        </span>
                      </div>
                    </div>
                    <div className="p-3 bg-slate-50 border border-slate-150 rounded-xl flex items-center gap-2 text-slate-700">
                      <Cpu className="w-4 h-4 text-slate-500" />
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-400 block leading-none mb-0.5">Device Health</span>
                        <span className="font-extrabold text-xs">
                          {selectedRecordDetails.device_health !== null ? `${selectedRecordDetails.device_health}%` : "N/A"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Details List */}
                  <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3">
                    <div className="flex justify-between py-0.5 border-b border-slate-100">
                      <span className="text-slate-500 font-medium">Device ID:</span>
                      <span className="font-semibold text-slate-800">{selectedRecordDetails.device_id || "N/A"}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-slate-100">
                      <span className="text-slate-500 font-medium">Receiver:</span>
                      <span className="font-semibold text-slate-800">{selectedRecordDetails.device_id || "N/A"}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-slate-100">
                      <span className="text-slate-500 font-medium">Timestamp:</span>
                      <span className="font-semibold text-slate-800">{formatKolkataTime(selectedRecordDetails.timestamp)}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-slate-100">
                      <span className="text-slate-500 font-medium">Firmware:</span>
                      <span className="font-semibold text-slate-800">{selectedRecordDetails.firmware_version || "N/A"}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-slate-100">
                      <span className="text-slate-500 font-medium">NRF24:</span>
                      <span className={`font-bold ${selectedRecordDetails.nrf_status === "CONNECTED" ? "text-emerald-600" : "text-red-600"}`}>
                        {selectedRecordDetails.nrf_status || "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-slate-100">
                      <span className="text-slate-500 font-medium">Wi-Fi:</span>
                      <span className={`font-bold ${selectedRecordDetails.wifi_status === "CONNECTED" ? "text-emerald-600" : "text-red-600"}`}>
                        {selectedRecordDetails.wifi_status || "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-slate-100">
                      <span className="text-slate-500 font-medium">Packet Status:</span>
                      <span className="font-bold text-emerald-600">RECEIVED</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-slate-100">
                      <span className="text-slate-500 font-medium">Packet Loss:</span>
                      <span className="font-semibold text-slate-800">
                        {selectedRecordDetails.packet_loss_percentage !== null ? `${selectedRecordDetails.packet_loss_percentage.toFixed(2)}%` : "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-slate-100">
                      <span className="text-slate-500 font-medium">Latency:</span>
                      <span className="font-semibold text-slate-800">
                        {selectedRecordDetails.latency_ms !== null && selectedRecordDetails.latency_ms !== undefined 
                          ? `${selectedRecordDetails.latency_ms} ms` 
                          : "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-slate-100">
                      <span className="text-slate-500 font-medium">Blockchain:</span>
                      <span className={`font-bold uppercase ${
                        selectedRecordDetails.blockchain_status === "VERIFIED" ? "text-emerald-600" :
                        selectedRecordDetails.blockchain_status === "INTEGRITY_FAILURE" ? "text-red-600 animate-pulse" : "text-amber-600"
                      }`}>
                        {selectedRecordDetails.blockchain_status || "N/A"}
                      </span>
                    </div>
                    
                    {selectedRecordDetails.hash && (
                      <div className="space-y-1 pt-1.5">
                        <span className="text-slate-500 font-medium block text-left">SHA-256 Hash Digest:</span>
                        <code className="block bg-white p-2 rounded border border-slate-200 overflow-hidden text-ellipsis font-mono text-[10px] text-slate-800 select-all leading-normal text-left">
                          {selectedRecordDetails.hash}
                        </code>
                      </div>
                    )}
                  </div>

                  {/* QR code and Action buttons */}
                  <div className="flex flex-col items-center justify-center p-4 border border-slate-150 rounded-xl bg-slate-50/50 space-y-4">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Scan QR Code Link</span>
                    <div className="p-2.5 bg-white border border-slate-200 rounded-xl shadow-sm">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(
                          `${window.location.origin}/data/${selectedRecordDetails.record_id}`
                        )}`}
                        alt="Record public QR link"
                        className="w-32 h-32 rounded border border-slate-100"
                      />
                    </div>
                    <p className="text-[10px] text-slate-500">Scan QR to view this record on mobile</p>

                    <div className="flex flex-wrap gap-2 w-full pt-2">
                      <button
                        onClick={() => downloadQRCode(selectedRecordDetails.record_id, selectedRecordDetails.packet_number)}
                        className="flex-1 py-2 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-[10px] font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
                      >
                        <Download className="w-3 h-3" />
                        Download QR
                      </button>
                      <button
                        onClick={() => copyRecordLink(selectedRecordDetails.record_id)}
                        className="flex-1 py-2 px-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-[10px] font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy Link
                      </button>
                      <button
                        onClick={() => shareRecord(selectedRecordDetails.record_id, selectedRecordDetails.packet_number)}
                        className="flex-1 py-2 px-3 bg-black text-white hover:bg-slate-800 rounded-xl text-[10px] font-bold transition-all shadow flex items-center justify-center gap-1.5"
                      >
                        <Share2 className="w-3 h-3" />
                        Share
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end bg-slate-50 gap-2">
              <button
                onClick={() => setSelectedRecordId(null)}
                className="py-1.5 px-4 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold transition-all"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
