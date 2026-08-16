/**
 * Blockchain-Enabled Secure IoT Monitoring System
 * RECEIVER & GATEWAY NODE FIRMWARE (UPGRADED)
 *
 * Hardware: NodeMCU ESP-32S / ESP32 30-pin
 * Actuators: RGB LED, Buzzer, Push Button
 * Wireless: NRF24L01 (2.4GHz Link), Wi-Fi (802.11 b/g/n)
 */

#include <HTTPClient.h>
#include "receiver_config.h"
#include <LittleFS.h>
#include <RF24.h>
#include <SPI.h>
#include <Update.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <algorithm>
#include <esp_ota_ops.h>
#include <mbedtls/sha256.h>
#include <time.h>
#include <vector>

// RGB LED Pins
#define RED_PIN 25
#define GREEN_PIN 26
#define BLUE_PIN 33

// Button & Buzzer Pins
#define BUTTON_PIN 32
#define BUZZER_PIN 13

// NRF24L01 Pins
#define CE_PIN 4
#define CSN_PIN 5

// System Configurations
const bool RGB_COMMON_CATHODE = true;         // Invert output logic if false
const uint64_t PIPE_ADDRESS = 0x4E4F444531LL; // "NODE1" address
const uint8_t RF_CHANNEL = 108;               // Channel 108
const rf24_pa_dbm_e PA_LEVEL = RF24_PA_LOW;
const rf24_datarate_e DATA_RATE = RF24_250KBPS;

// Wi-Fi & API Configuration
const char *WIFI_SSID = SECRET_SSID;
const char *WIFI_PASSWORD = SECRET_PASS;
// Replace 'PROJECT' with your actual Vercel project name after deployment
const char *BACKEND_URL =
    "https://nrf24l01-monitoring.vercel.app/api/v1/sensor-data";
const char *DEVICE_ID = "receiver-01";
const char *DEVICE_API_KEY = SECRET_API_KEY;
const char *FIRMWARE_VERSION = "1.0.0";

// Google Trust Services (GTS) Root R1 CA certificate for Vercel domains
const char *ROOT_CA =
    "-----BEGIN CERTIFICATE-----\n"
    "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\n"
    "bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c\n"
    "-----END CERTIFICATE-----\n";

// Packet Structure
struct SensorPacket {
  float temperature;
  float humidity;
  bool motion;
  uint32_t packet_number;
};

// Persistent Buffer Structure (stored in LittleFS)
struct BufferedPacket {
  uint32_t packet_number;
  float temperature;
  float humidity;
  bool motion;
  uint32_t timestamp; // naive epoch timestamp
};

// Global Objects
RF24 radio(CE_PIN, CSN_PIN);
SensorPacket packet;

// Analytics & Metrics counts
uint32_t wifiReconnectCount = 0;
uint32_t backendFailureCount = 0;

// Timings and Status variables
unsigned long lastPacketTime = 0;
const unsigned long NRF_TIMEOUT_MS = 10000; // 10s timeout for comm link loss
unsigned long lastWiFiCheck = 0;
unsigned long lastUploadAttemptTime = 0;
const unsigned long UPLOAD_INTERVAL_MS =
    2000; // Upload rate limit of 2s when flushing buffer
bool alarmSilenced = false;
unsigned long lastHeartbeatTime = 0;

// ----------------------------------------
// RGB LED Control Helper
// ----------------------------------------
void setRGB(bool red, bool green, bool blue) {
  bool r_val = RGB_COMMON_CATHODE ? red : !red;
  bool g_val = RGB_COMMON_CATHODE ? green : !green;
  bool b_val = RGB_COMMON_CATHODE ? blue : !blue;

  digitalWrite(RED_PIN, r_val ? HIGH : LOW);
  digitalWrite(GREEN_PIN, g_val ? HIGH : LOW);
  digitalWrite(BLUE_PIN, b_val ? HIGH : LOW);
}

// ----------------------------------------
// Get NTP Synced Millisecond Time
// ----------------------------------------
int64_t getEpochTimeMs() {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  if (tv.tv_sec < 1000000000) {
    return 0; // NTP not synced yet
  }
  return (int64_t)tv.tv_sec * 1000 + (tv.tv_usec / 1000);
}

// ----------------------------------------
// Local persistent buffering using LittleFS
// ----------------------------------------
int getBufferCount() {
  if (!LittleFS.begin(true))
    return 0;
  int count = 0;
  File dir = LittleFS.open("/buf");
  if (!dir || !dir.isDirectory()) {
    LittleFS.mkdir("/buf");
    return 0;
  }
  File f = dir.openNextFile();
  while (f) {
    count++;
    f = dir.openNextFile();
  }
  return count;
}

void savePacketToBuffer(const SensorPacket &p, uint32_t timestamp) {
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS Error: Mount Failed.");
    return;
  }

  // Count files and find oldest packet to enforce max limit (500)
  int fileCount = 0;
  uint32_t oldestNum = 0xFFFFFFFF;
  File dir = LittleFS.open("/buf");
  if (dir && dir.isDirectory()) {
    File f = dir.openNextFile();
    while (f) {
      fileCount++;
      String name = f.name();
      int slashIdx = name.lastIndexOf('/');
      String numStr = (slashIdx >= 0) ? name.substring(slashIdx + 1) : name;
      uint32_t num = numStr.toInt();
      if (num < oldestNum) {
        oldestNum = num;
      }
      f = dir.openNextFile();
    }
  }

  // FIFO eviction if full
  if (fileCount >= 500 && oldestNum != 0xFFFFFFFF) {
    String oldestPath = "/buf/" + String(oldestNum);
    LittleFS.remove(oldestPath);
    Serial.println("[BUFFER] Max limit reached. Dropping oldest packet: " +
                   oldestPath);
  }

  // Write new file
  String path = "/buf/" + String(p.packet_number);
  File f = LittleFS.open(path, FILE_WRITE);
  if (f) {
    BufferedPacket bp = {p.packet_number, p.temperature, p.humidity, p.motion,
                         timestamp};
    f.write((uint8_t *)&bp, sizeof(bp));
    f.close();
    Serial.println("[BUFFER] Buffered packet saved to file: " + path);
  }
}

// ----------------------------------------
// Custom string parsing function for JSON values
// ----------------------------------------
String extractJsonValue(String json, String key) {
  int keyIndex = json.indexOf("\"" + key + "\":");
  if (keyIndex == -1)
    return "";

  int valStart = keyIndex + key.length() + 3; // move past key and quotes/colons
  if (valStart >= json.length())
    return "";

  // String check
  if (json.charAt(valStart) == '"') {
    valStart++;
    int valEnd = json.indexOf("\"", valStart);
    if (valEnd == -1)
      return "";
    return json.substring(valStart, valEnd);
  } else {
    // Number or bool
    int valEndComma = json.indexOf(",", valStart);
    int valEndBrace = json.indexOf("}", valStart);
    int valEnd = -1;
    if (valEndComma != -1 && valEndBrace != -1) {
      valEnd = std::min(valEndComma, valEndBrace);
    } else if (valEndComma != -1) {
      valEnd = valEndComma;
    } else {
      valEnd = valEndBrace;
    }
    if (valEnd == -1)
      return "";
    return json.substring(valStart, valEnd);
  }
}

// Forward declarations
void performOTA(String otaUrl, String expectedSha256, String toVersion);
bool postOtaStatus(String statusStr, int progress, String errMsg = "");

// ----------------------------------------
// Raw HTTPS POST socket helper using WiFiClientSecure
// ----------------------------------------
bool sendRawHttpsPost(const char* path, String jsonPayload, String &outResponseBody) {
  WiFiClientSecure client;
  client.setCACert(ROOT_CA);
  client.setHandshakeTimeout(10);
  
  const char* host = "nrf24l01-monitoring.vercel.app";
  const int port = 443;
  
  Serial.print("Connecting to ");
  Serial.print(host);
  Serial.print(":");
  Serial.println(port);
  
  if (!client.connect(host, port)) {
    Serial.println("Connection failed!");
    return false;
  }
  
  Serial.println("TLS CONNECTION SUCCESS");
  
  // Format and send HTTP/1.1 Request
  client.print(String("POST ") + path + " HTTP/1.1\r\n" +
               "Host: " + host + "\r\n" +
               "Content-Type: application/json\r\n" +
               "Accept: application/json\r\n" +
               "X-Device-API-Key: " + String(DEVICE_API_KEY) + "\r\n" +
               "Content-Length: " + String(jsonPayload.length()) + "\r\n" +
               "Connection: close\r\n\r\n" +
               jsonPayload);
  
  Serial.println("POST SENT");
  
  // Read response headers and body
  String responseHeader = "";
  outResponseBody = "";
  bool readingHeader = true;
  unsigned long timeout = millis();
  
  while (client.connected() || client.available()) {
    if (millis() - timeout > 10000) {
      Serial.println("Response timeout!");
      break;
    }
    
    if (client.available()) {
      String line = client.readStringUntil('\n');
      if (readingHeader) {
        responseHeader += line + "\n";
        if (line == "\r" || line == "") {
          readingHeader = false;
        }
      } else {
        outResponseBody += line + "\n";
      }
      timeout = millis(); // Reset timeout on incoming data
    } else {
      delay(10);
    }
  }
  
  client.stop();
  
  Serial.println("RESPONSE HEADERS:");
  Serial.println(responseHeader);
  Serial.println("SERVER RESPONSE:");
  Serial.println(outResponseBody);
  
  if (responseHeader.indexOf("HTTP/1.1 200") >= 0 || responseHeader.indexOf("HTTP/1.1 201") >= 0) {
    Serial.println("UPLOAD SUCCESS");
    return true;
  } else {
    Serial.println("UPLOAD FAILED");
    return false;
  }
}

// ----------------------------------------
// API Ingestion Dispatcher
// ----------------------------------------
bool postSensorData(float temp, float hum, bool motion, uint32_t packetNum,
                    uint32_t timestamp = 0) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("API Error: Wi-Fi disconnected. Cannot upload.");
    return false;
  }

  // Build JSON payload
  int bufferCount = getBufferCount();
  String jsonPayload = "{\"device_id\":\"" + String(DEVICE_ID) +
                       "\",\"temperature\":" + String(temp, 1) +
                       ",\"humidity\":" + String(hum, 1) +
                       ",\"motion\":" + String(motion ? "true" : "false") +
                       ",\"packet_number\":" + String(packetNum) +
                       ",\"wifi_reconnects\":" + String(wifiReconnectCount) +
                       ",\"backend_failures\":" + String(backendFailureCount) +
                       ",\"uptime\":" + String(millis() / 1000) +
                       ",\"buffer_count\":" + String(bufferCount) +
                       ",\"firmware_version\":\"" + String(FIRMWARE_VERSION) +
                       "\"";

  if (timestamp > 0) {
    // Format epoch seconds to ISO UTC
    time_t rawtime = timestamp;
    struct tm *timeinfo = gmtime(&rawtime);
    char buffer[30];
    strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", timeinfo);
    jsonPayload +=
        ",\"captured_at\":\"" + String(buffer) + "\",\"is_buffered\":true";
  } else {
    int64_t timeMs = getEpochTimeMs();
    if (timeMs > 0) {
      jsonPayload += ",\"received_at_ms\":" + String(timeMs);
    }
  }
  jsonPayload += "}";

  // Diagnostic output before POST
  Serial.println("\nWIFI STATUS");
  Serial.println(WiFi.status() == WL_CONNECTED ? "CONNECTED" : "OFFLINE");
  Serial.println("WIFI RSSI");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");
  Serial.println("FREE HEAP");
  Serial.print(ESP.getFreeHeap());
  Serial.println(" bytes");
  Serial.println("HOSTNAME");
  Serial.println("nrf24l01-monitoring.vercel.app");
  Serial.println("URL");
  Serial.println(BACKEND_URL);
  Serial.println();

  String responseBody = "";
  return sendRawHttpsPost("/api/v1/sensor-data", jsonPayload, responseBody);
}

bool postHeartbeat(String wifiStatus, String nrfStatus) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Heartbeat Error: Wi-Fi disconnected.");
    return false;
  }

  String jsonPayload =
      "{\"device_id\":\"" + String(DEVICE_ID) + "\",\"wifi_status\":\"" +
      wifiStatus + "\",\"nrf_status\":\"" + nrfStatus + "\"" +
      ",\"wifi_reconnects\":" + String(wifiReconnectCount) +
      ",\"backend_failures\":" + String(backendFailureCount) +
      ",\"uptime\":" + String(millis() / 1000) +
      ",\"buffer_count\":" + String(getBufferCount()) +
      ",\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"}";

  String responseBody = "";
  bool success = sendRawHttpsPost("/api/v1/devices/heartbeat", jsonPayload, responseBody);

  if (success) {
    // Check if OTA is pending in response
    if (responseBody.indexOf("\"ota_pending\":true") >= 0) {
      String otaUrl = extractJsonValue(responseBody, "ota_url");
      String otaVersion = extractJsonValue(responseBody, "ota_version");
      String otaSha256 = extractJsonValue(responseBody, "ota_sha256");

      if (otaUrl.length() > 0 && otaSha256.length() > 0) {
        Serial.println("\n[OTA] Pending update detected! Target version: v" +
                       otaVersion);
        performOTA(otaUrl, otaSha256, otaVersion);
      }
    }
  } else {
    backendFailureCount++;
  }

  return success;
}

// ----------------------------------------
// Flash Rollback verification Check
// ----------------------------------------
void checkRollback() {
  const esp_partition_t *running = esp_ota_get_running_partition();
  esp_ota_img_states_t img_state;
  if (esp_ota_get_state_partition(running, &img_state) == ESP_OK) {
    if (img_state == ESP_OTA_IMG_PENDING_VERIFY) {
      Serial.println("[OTA] Partition pending verification: Wi-Fi connected "
                     "and NTP synced. Cancelling Rollback.");
      esp_ota_mark_app_valid_cancel_rollback();
    }
  }
}

// ----------------------------------------
// Sync NTP time with servers
// ----------------------------------------
void syncNTP() {
  Serial.print("Waiting for Wi-Fi to sync NTP time...");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi Connected! Syncing time via NTP...");
    configTime(19800, 0, "pool.ntp.org",
               "time.nist.gov"); // IST timezone (UTC+5:30)

    time_t now = time(nullptr);
    int retry = 0;
    while (now < 8 * 3600 * 2 && retry < 20) {
      delay(500);
      Serial.print(".");
      now = time(nullptr);
      retry++;
    }

    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      Serial.print("\nTime successfully synchronized: ");
      Serial.println(asctime(&timeinfo));

      // Wi-Fi connected & NTP Synced: Verify active partition
      checkRollback();
    } else {
      Serial.println("\nTime synchronization failed.");
    }
  } else {
    Serial.println("\nWi-Fi connection timed out. Skipping initial NTP sync.");
  }
}

// ----------------------------------------
// LittleFS Buffer synchronization loop
// ----------------------------------------
void uploadBufferedPackets() {
  if (WiFi.status() != WL_CONNECTED)
    return;
  if (!LittleFS.begin(true))
    return;

  File root = LittleFS.open("/buf");
  if (!root || !root.isDirectory())
    return;

  // Read all buffered packet numbers
  std::vector<uint32_t> packetNums;
  File f = root.openNextFile();
  while (f) {
    String name = f.name();
    int slashIdx = name.lastIndexOf('/');
    String numStr = (slashIdx >= 0) ? name.substring(slashIdx + 1) : name;
    packetNums.push_back(numStr.toInt());
    f = root.openNextFile();
  }
  root.close();

  if (packetNums.empty())
    return;

  // Sort ascending chronologically
  std::sort(packetNums.begin(), packetNums.end());

  Serial.println("[SYNC] Restored connection. Syncing " +
                 String(packetNums.size()) + " packets...");

  for (uint32_t num : packetNums) {
    String path = "/buf/" + String(num);
    File file = LittleFS.open(path, FILE_READ);
    if (file) {
      BufferedPacket bp;
      if (file.read((uint8_t *)&bp, sizeof(bp)) == sizeof(bp)) {
        file.close();

        // Try uploading
        bool success = postSensorData(bp.temperature, bp.humidity, bp.motion,
                                      bp.packet_number, bp.timestamp);
        if (success) {
          LittleFS.remove(path);
          Serial.println("[SYNC] Synced & removed packet: " + path);
          delay(100);
        } else {
          Serial.println(
              "[SYNC] Connection failure. Postponing buffer synchronization.");
          break;
        }
      } else {
        file.close();
        LittleFS.remove(path); // Evict corrupted packet
      }
    }
  }
  Serial.println("[SYNC] Buffer synchronization complete. Pending: " +
                 String(getBufferCount()) + " packets");
}

// ----------------------------------------
// Setup Entry Point
// ----------------------------------------
void setup() {
  Serial.begin(115200);

  // Initialize LittleFS Buffer
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS Mount Failed. Formatting filesystem...");
  } else {
    Serial.println("LittleFS mounted successfully.");
  }

  // GPIO Pin Settings
  pinMode(RED_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BLUE_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Status Check: BLUE indicates connecting/startup state
  setRGB(false, false, true);

  // Initialize NRF24L01
  if (!radio.begin()) {
    Serial.println("CRITICAL: NRF24L01 hardware failure!");
    while (1) {
      delay(1000);
    }
  }

  radio.setChannel(RF_CHANNEL);
  radio.setDataRate(DATA_RATE);
  radio.setPALevel(PA_LEVEL);
  radio.openReadingPipe(1, PIPE_ADDRESS);
  radio.startListening(); // Set as Receiver

  Serial.println("NRF24L01 Radio listening...");

  // Start Wi-Fi Connection
  Serial.print("Connecting to Wi-Fi SSID: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  syncNTP();
}

// ----------------------------------------
// Loop Loop Loop
// ----------------------------------------
void loop() {
  unsigned long currentMillis = millis();

  // 1. Asynchronous Wi-Fi Auto-Reconnection Handler (Every 10s)
  if (WiFi.status() != WL_CONNECTED) {
    if (currentMillis - lastWiFiCheck > 10000) {
      lastWiFiCheck = currentMillis;
      Serial.println("WiFi offline. Reconnection request sent...");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      wifiReconnectCount++;
    }
  }

  // 2. Handle push button to silence buzzer locally
  if (digitalRead(BUTTON_PIN) == LOW) {
    if (packet.motion && !alarmSilenced) {
      alarmSilenced = true;
      digitalWrite(BUZZER_PIN, LOW); // Silence buzzer immediately
      Serial.println("Local Button Pressed: Alarm Silenced manually.");
    }
  }

  // 3. Read NRF24L01 packet if available
  if (radio.available()) {
    radio.read(&packet, sizeof(packet));
    lastPacketTime = currentMillis; // Refresh timeout timer

    Serial.println("\n=== Received NRF24L01 Packet ===");
    Serial.print("Temp: ");
    Serial.print(packet.temperature);
    Serial.println(" C");
    Serial.print("Hum:  ");
    Serial.print(packet.humidity);
    Serial.println(" %");
    Serial.print("Motion: ");
    Serial.println(packet.motion ? "Active" : "Quiet");
    Serial.print("Packet: ");
    Serial.println(packet.packet_number);

    // State machine logic for local actuators
    if (packet.motion) {
      setRGB(true, false, false); // RED LED
      if (!alarmSilenced) {
        digitalWrite(BUZZER_PIN, HIGH); // Alarm buzzer ON
      }
    } else {
      setRGB(false, true, false);    // GREEN LED
      digitalWrite(BUZZER_PIN, LOW); // Buzzer OFF
      alarmSilenced = false;         // Reset mute latch for next motion cycle
    }

    // Buffer the packet locally if Wi-Fi is offline or if direct POST fails
    if (WiFi.status() != WL_CONNECTED) {
      time_t t_now = time(nullptr);
      savePacketToBuffer(packet, t_now);
    } else {
      bool success = postSensorData(packet.temperature, packet.humidity,
                                    packet.motion, packet.packet_number);
      if (!success) {
        time_t t_now = time(nullptr);
        savePacketToBuffer(packet, t_now);
      }
    }
  }

  // 4. Local NRF Link Timeout Check (Older than 10 seconds)
  if (currentMillis - lastPacketTime > NRF_TIMEOUT_MS) {
    setRGB(false, false, true);    // BLUE indicates communication link lost
    digitalWrite(BUZZER_PIN, LOW); // Silence buzzer during timeout
  }

  // 5. Asynchronous Buffer Processing (Every 2s when connected to Wi-Fi)
  if (WiFi.status() == WL_CONNECTED && getBufferCount() > 0) {
    if (currentMillis - lastUploadAttemptTime >= UPLOAD_INTERVAL_MS) {
      lastUploadAttemptTime = currentMillis;
      uploadBufferedPackets();
    }
  }

  // 6. Heartbeat transmission (Every 5 seconds)
  if (WiFi.status() == WL_CONNECTED) {
    if (currentMillis - lastHeartbeatTime >= 5000) {
      lastHeartbeatTime = currentMillis;
      String nrfStatus = "ACTIVE";
      if (currentMillis - lastPacketTime > NRF_TIMEOUT_MS) {
        nrfStatus = "ERROR";
      }
      postHeartbeat("CONNECTED", nrfStatus);
    }
  }

  delay(20); // Small cycle delay to avoid CPU starvation
}

// ----------------------------------------
// HTTPS Secure OTA Implementation
// ----------------------------------------
bool postOtaStatus(String statusStr, int progress, String errMsg) {
  if (WiFi.status() != WL_CONNECTED)
    return false;

  String path = "/api/v1/devices/" + String(DEVICE_ID) + "/ota/status";

  String jsonPayload =
      "{\"status\":\"" + statusStr + "\",\"progress\":" + String(progress);
  if (errMsg.length() > 0) {
    jsonPayload += ",\"error_message\":\"" + errMsg + "\"";
  }
  jsonPayload += "}";

  String responseBody = "";
  return sendRawHttpsPost(path.c_str(), jsonPayload, responseBody);
}

void performOTA(String otaUrl, String expectedSha256, String toVersion) {
  Serial.print("[OTA] Starting OTA upgrade to version: v");
  Serial.println(toVersion);

  postOtaStatus("DOWNLOADING", 0);

  WiFiClientSecure client;
  client.setCACert(ROOT_CA);

  HTTPClient http;
  if (!http.begin(client, otaUrl)) {
    Serial.println("[OTA] HTTP connection initiation failed.");
    postOtaStatus("FAILED", 0, "HTTP begin failed");
    return;
  }

  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    Serial.print("[OTA] HTTP download failed, code: ");
    Serial.println(httpCode);
    postOtaStatus("FAILED", 0, "HTTP GET failed with code " + String(httpCode));
    http.end();
    return;
  }

  int contentLength = http.getSize();
  if (contentLength <= 0) {
    Serial.println("[OTA] Invalid content size.");
    postOtaStatus("FAILED", 0, "Invalid content length");
    http.end();
    return;
  }

  bool canUpdate = Update.begin(contentLength);
  if (!canUpdate) {
    Serial.println("[OTA] Not enough flash space on inactive partition.");
    postOtaStatus("FAILED", 0, "Not enough space");
    http.end();
    return;
  }

  WiFiClient *stream = http.getStreamPtr();
  size_t written = 0;
  uint8_t buff[1024];

  mbedtls_sha256_context sha256_ctx;
  mbedtls_sha256_init(&sha256_ctx);
  mbedtls_sha256_starts_ret(&sha256_ctx, 0); // 0 for SHA-256

  Serial.println("[OTA] Downloading and writing firmware partition...");
  unsigned long lastProgressTime = 0;

  while (http.connected() && written < contentLength) {
    size_t available = stream->available();
    if (available > 0) {
      int len = stream->readBytes(buff, std::min(available, sizeof(buff)));
      if (len > 0) {
        Update.write(buff, len);
        mbedtls_sha256_update_ret(&sha256_ctx, buff, len);
        written += len;

        unsigned long currentMillis = millis();
        if (currentMillis - lastProgressTime > 1000 ||
            written == contentLength) {
          lastProgressTime = currentMillis;
          int progress = (written * 100) / contentLength;
          Serial.print("[OTA] Downloading: ");
          Serial.print(progress);
          Serial.println("%");
          postOtaStatus("DOWNLOADING", progress);
        }
      }
    }
    delay(5); // prevent CPU watchdogs
  }

  unsigned char sha256_result[32];
  mbedtls_sha256_finish_ret(&sha256_ctx, sha256_result);
  mbedtls_sha256_free(&sha256_ctx);

  // Render calculated hash
  String calculatedHash = "";
  for (int i = 0; i < 32; i++) {
    if (sha256_result[i] < 16)
      calculatedHash += "0";
    calculatedHash += String(sha256_result[i], HEX);
  }

  Serial.print("[OTA] Calculated SHA-256: ");
  Serial.println(calculatedHash);
  Serial.print("[OTA] Expected SHA-256:   ");
  Serial.println(expectedSha256);

  if (calculatedHash != expectedSha256) {
    Serial.println(
        "[OTA] CRITICAL: SHA-256 verification failed! Rejecting update.");
    postOtaStatus("FAILED", 0, "SHA-256 verification failed");
    Update.abort();
    http.end();
    return;
  }

  postOtaStatus("VERIFYING", 100);
  postOtaStatus("INSTALLING", 100);

  if (Update.end()) {
    Serial.println("[OTA] Firmware flashed successfully! Rebooting ESP32...");
    postOtaStatus("SUCCESS", 100);
    delay(2000);
    ESP.restart();
  } else {
    Serial.print("[OTA] Flashing write-end failed, error: ");
    Serial.println(Update.getError());
    postOtaStatus("FAILED", 0,
                  "Update.end failed: " + String(Update.getError()));
  }

  http.end();
}
