/*
  Blockchain-Enabled Secure IoT Monitoring System
  RECEIVER ESP32

  Hardware:
  - ESP32 NodeMCU ESP-32S 30-pin
  - NRF24L01
  - RGB LED
  - Push Button
  - Buzzer

  Data flow:

  NRF24L01
       ↓
  ESP32 Receiver
       ↓
  Wi-Fi
       ↓
  HTTPS API
       ↓
  Website Backend
       ↓
  Database / Blockchain
       ↓
  Website Dashboard
*/

#include "receiver_config.h"

#include <HTTPClient.h>
#include <RF24.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

// =====================================================
// USER CONFIGURATION
// =====================================================

const char *WIFI_SSID = SECRET_SSID;
const char *WIFI_PASSWORD = SECRET_PASS;

/*
  IMPORTANT:
  ESP32 MUST NOT use:
    localhost
    127.0.0.1

  The ESP32 uses the public backend URL below.
*/
const char *API_URL =
    "https://nrf24l01-monitoring.vercel.app/api/v1/sensor-data";

const char *HEARTBEAT_URL =
    "https://nrf24l01-monitoring.vercel.app/api/v1/devices/heartbeat";

const char *DEVICE_ID = "receiver-01";

// API key comes from receiver_config.h
const char *DEVICE_API_KEY = SECRET_API_KEY;

const char *FIRMWARE_VERSION = "1.0.0";

// =====================================================
// NRF24 PINS
// =====================================================

#define NRF_CE 4
#define NRF_CSN 5

// =====================================================
// OUTPUT PINS
// =====================================================

#define RGB_RED 25
#define RGB_GREEN 26
#define RGB_BLUE 33

#define BUTTON_PIN 32
#define BUZZER_PIN 13

// =====================================================
// NRF24 CONFIGURATION
// =====================================================

const uint64_t RADIO_ADDRESS = 0x4E4F444531LL;

const uint8_t RADIO_CHANNEL = 108;

const rf24_datarate_e RADIO_DATA_RATE = RF24_250KBPS;

const rf24_pa_dbm_e RADIO_PA_LEVEL = RF24_PA_LOW;

// =====================================================
// SENSOR PACKET
// MUST MATCH TRANSMITTER EXACTLY
// =====================================================

struct SensorPacket {

  float temperature;

  float humidity;

  bool motion;

  uint32_t packet_number;
};

// =====================================================
// OBJECTS
// =====================================================

RF24 radio(NRF_CE, NRF_CSN);

SensorPacket packet;

// =====================================================
// VARIABLES
// =====================================================

unsigned long lastPacketReceived = 0;
unsigned long lastWiFiCheck = 0;
unsigned long lastHeartbeat = 0;

bool buzzerAcknowledged = false;
bool lastMotionState = false;

uint32_t lastPacketNumber = 0;

uint32_t wifiReconnects = 0;
uint32_t backendFailures = 0;

// =====================================================
// TIMERS
// =====================================================

const unsigned long DEVICE_TIMEOUT = 10000;

const unsigned long WIFI_RECONNECT_INTERVAL = 10000;

const unsigned long HEARTBEAT_INTERVAL = 30000;

const unsigned long HTTP_TIMEOUT = 15000;

// =====================================================
// RGB LED
// =====================================================

void rgbOff() {

  digitalWrite(RGB_RED, LOW);
  digitalWrite(RGB_GREEN, LOW);
  digitalWrite(RGB_BLUE, LOW);
}

void rgbGreen() {

  digitalWrite(RGB_RED, LOW);
  digitalWrite(RGB_GREEN, HIGH);
  digitalWrite(RGB_BLUE, LOW);
}

void rgbRed() {

  digitalWrite(RGB_RED, HIGH);
  digitalWrite(RGB_GREEN, LOW);
  digitalWrite(RGB_BLUE, LOW);
}

void rgbBlue() {

  digitalWrite(RGB_RED, LOW);
  digitalWrite(RGB_GREEN, LOW);
  digitalWrite(RGB_BLUE, HIGH);
}

// =====================================================
// WIFI
// =====================================================

void connectWiFi() {

  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  wifiReconnects++;

  Serial.println();
  Serial.println("================================");
  Serial.println("CONNECTING TO WI-FI");
  Serial.println("================================");

  WiFi.mode(WIFI_STA);

  WiFi.disconnect(true);
  delay(200);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {

    delay(500);

    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {

    Serial.println("[OK] Wi-Fi CONNECTED");

    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());

    Serial.print("RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");

  } else {

    Serial.println("[FAILED] Wi-Fi connection");
  }
}

// =====================================================
// PRINT HTTP RESULT
// =====================================================

void printHTTPResult(int httpCode, const String &response) {

  Serial.println();
  Serial.println("================================");
  Serial.println("BACKEND RESPONSE");
  Serial.println("================================");

  Serial.print("HTTP Status: ");
  Serial.println(httpCode);

  Serial.println("Server Response:");

  if (response.length() > 0) {
    Serial.println(response);
  } else {
    Serial.println("(empty response)");
  }

  Serial.println("================================");
}

// =====================================================
// SEND SENSOR DATA
// =====================================================

bool sendSensorData() {

  if (WiFi.status() != WL_CONNECTED) {

    Serial.println("[FAILED] Cannot upload: Wi-Fi offline");

    return false;
  }

  Serial.println();
  Serial.println("================================");
  Serial.println("SENDING SENSOR DATA");
  Serial.println("================================");

  Serial.print("Backend URL: ");
  Serial.println(API_URL);

  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);

  Serial.print("Wi-Fi IP: ");
  Serial.println(WiFi.localIP());

  Serial.print("Wi-Fi RSSI: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");

  WiFiClientSecure secureClient;

  // Development/testing.
  // For production, use the server CA certificate.
  secureClient.setInsecure();

  HTTPClient http;

  http.setConnectTimeout(10000);
  http.setTimeout(HTTP_TIMEOUT);

  bool beginSuccess = http.begin(secureClient, API_URL);

  if (!beginSuccess) {

    Serial.println("[FAILED] HTTP connection initialization");

    backendFailures++;

    return false;
  }

  // ===================================================
  // HEADERS
  // ===================================================

  http.addHeader("Content-Type", "application/json");

  /*
    Your FastAPI backend accepts:
      X-Device-API-Key
    or:
      X-Device-Key

    Send BOTH to make the ESP32 compatible with
    the current backend authentication middleware.
  */

  http.addHeader("X-Device-API-Key", DEVICE_API_KEY);

  http.addHeader("X-Device-Key", DEVICE_API_KEY);

  http.addHeader("Accept", "application/json");

  http.addHeader("User-Agent", "ESP32-NRF24-Receiver/1.0.0");

  // ===================================================
  // JSON
  // ===================================================

  String json = "{";

  json += "\"device_id\":\"";
  json += DEVICE_ID;
  json += "\",";

  json += "\"temperature\":";
  json += String(packet.temperature, 2);
  json += ",";

  json += "\"humidity\":";
  json += String(packet.humidity, 2);
  json += ",";

  json += "\"motion\":";
  json += packet.motion ? "true" : "false";
  json += ",";

  json += "\"packet_number\":";
  json += String(packet.packet_number);
  json += ",";

  json += "\"wifi_reconnects\":";
  json += String(wifiReconnects);
  json += ",";

  json += "\"backend_failures\":";
  json += String(backendFailures);
  json += ",";

  json += "\"uptime\":";
  json += String(millis() / 1000);
  json += ",";

  json += "\"buffer_count\":";
  json += "0";
  json += ",";

  json += "\"firmware_version\":\"";
  json += FIRMWARE_VERSION;
  json += "\"";

  json += "}";

  Serial.println();
  Serial.println("JSON:");
  Serial.println(json);

  // ===================================================
  // POST
  // ===================================================

  int httpCode = http.POST(json);

  String response = "";

  if (httpCode > 0) {

    response = http.getString();
  }

  printHTTPResult(httpCode, response);

  // ===================================================
  // RESULT HANDLING
  // ===================================================

  if (httpCode == 200 || httpCode == 201 || httpCode == 202) {

    Serial.println("[SUCCESS] SENSOR DATA UPLOADED");

    http.end();

    return true;
  }

  if (httpCode == 401) {

    Serial.println();
    Serial.println("[ERROR] 401 UNAUTHORIZED");
    Serial.println("Check SECRET_API_KEY in receiver_config.h");
  }

  else if (httpCode == 403) {

    Serial.println();
    Serial.println("[ERROR] 403 FORBIDDEN");
    Serial.println("Device API key was rejected.");
  }

  else if (httpCode == 404) {

    Serial.println();
    Serial.println("[ERROR] 404 NOT FOUND");
    Serial.println("Check API_URL and deployed backend route.");
  }

  else if (httpCode == 422) {

    Serial.println();
    Serial.println("[ERROR] 422 VALIDATION ERROR");
    Serial.println("Backend rejected the JSON structure.");
  }

  else if (httpCode == 500) {

    Serial.println();
    Serial.println("[ERROR] 500 BACKEND ERROR");
    Serial.println("ESP32 reached the backend, but the");
    Serial.println("server failed while processing the data.");
    Serial.println("Compare this response with local Swagger.");
  }

  else if (httpCode < 0) {

    Serial.println();
    Serial.println("[ERROR] HTTP CONNECTION ERROR");

    Serial.print("Reason: ");
    Serial.println(http.errorToString(httpCode));
  }

  backendFailures++;

  http.end();

  return false;
}

// =====================================================
// HEARTBEAT
// =====================================================

bool sendHeartbeat() {

  if (WiFi.status() != WL_CONNECTED) {

    Serial.println("Cannot send heartbeat: Wi-Fi offline");

    return false;
  }

  WiFiClientSecure secureClient;

  secureClient.setInsecure();

  HTTPClient http;

  http.setConnectTimeout(10000);
  http.setTimeout(HTTP_TIMEOUT);

  bool beginSuccess = http.begin(secureClient, HEARTBEAT_URL);

  if (!beginSuccess) {

    Serial.println("[FAILED] Heartbeat initialization");

    backendFailures++;

    return false;
  }

  // ===================================================
  // HEADERS
  // ===================================================

  http.addHeader("Content-Type", "application/json");

  http.addHeader("X-Device-API-Key", DEVICE_API_KEY);

  http.addHeader("X-Device-Key", DEVICE_API_KEY);

  http.addHeader("Accept", "application/json");

  http.addHeader("User-Agent", "ESP32-NRF24-Receiver/1.0.0");

  // ===================================================
  // NRF STATUS
  // ===================================================

  String nrfStatus = "ERROR";

  if (lastPacketReceived > 0 &&
      millis() - lastPacketReceived <= DEVICE_TIMEOUT) {

    nrfStatus = "ACTIVE";
  }

  // ===================================================
  // HEARTBEAT JSON
  // ===================================================

  String json = "{";

  json += "\"device_id\":\"";
  json += DEVICE_ID;
  json += "\",";

  json += "\"wifi_status\":\"CONNECTED\",";

  json += "\"nrf_status\":\"";
  json += nrfStatus;
  json += "\",";

  json += "\"wifi_reconnects\":";
  json += String(wifiReconnects);
  json += ",";

  json += "\"backend_failures\":";
  json += String(backendFailures);
  json += ",";

  json += "\"uptime\":";
  json += String(millis() / 1000);
  json += ",";

  json += "\"buffer_count\":0,";

  json += "\"firmware_version\":\"";
  json += FIRMWARE_VERSION;
  json += "\"";

  json += "}";

  Serial.println();
  Serial.println("Sending heartbeat...");

  Serial.println(json);

  int httpCode = http.POST(json);

  String response = "";

  if (httpCode > 0) {
    response = http.getString();
  }

  Serial.print("Heartbeat HTTP Status: ");
  Serial.println(httpCode);

  if (response.length() > 0) {

    Serial.println("Heartbeat Response:");
    Serial.println(response);
  }

  if (httpCode >= 200 && httpCode < 300) {

    Serial.println("[SUCCESS] HEARTBEAT");

    http.end();

    return true;
  }

  Serial.println("[FAILED] HEARTBEAT");

  backendFailures++;

  http.end();

  return false;
}

// =====================================================
// LOCAL DEVICE STATUS
// =====================================================

void updateLocalOutputs() {

  if (lastPacketReceived == 0 ||
      millis() - lastPacketReceived > DEVICE_TIMEOUT) {

    rgbBlue();

    digitalWrite(BUZZER_PIN, LOW);

    return;
  }

  if (packet.motion) {

    rgbRed();

    if (!buzzerAcknowledged) {

      digitalWrite(BUZZER_PIN, HIGH);
    }

  } else {

    rgbGreen();

    digitalWrite(BUZZER_PIN, LOW);

    buzzerAcknowledged = false;
  }
}

// =====================================================
// BUTTON
// =====================================================

void checkButton() {

  static bool previousButtonState = HIGH;

  bool currentButtonState = digitalRead(BUTTON_PIN);

  if (previousButtonState == HIGH && currentButtonState == LOW) {

    Serial.println("BUTTON PRESSED");

    buzzerAcknowledged = true;

    digitalWrite(BUZZER_PIN, LOW);

    delay(50);
  }

  previousButtonState = currentButtonState;
}

// =====================================================
// RECEIVE NRF24 DATA
// =====================================================

void receiveNRF24Data() {

  if (!radio.available()) {
    return;
  }

  while (radio.available()) {

    radio.read(&packet, sizeof(packet));
  }

  // ===================================================
  // VALIDATION
  // ===================================================

  if (isnan(packet.temperature) || isnan(packet.humidity)) {

    Serial.println("WARNING: Invalid sensor packet");

    return;
  }

  if (packet.humidity < 0 || packet.humidity > 100) {

    Serial.println("WARNING: Invalid humidity");

    return;
  }

  if (packet.temperature < -50 || packet.temperature > 100) {

    Serial.println("WARNING: Invalid temperature");

    return;
  }

  // ===================================================
  // PACKET RECEIVED
  // ===================================================

  lastPacketReceived = millis();

  lastPacketNumber = packet.packet_number;

  Serial.println();
  Serial.println("================================");

  Serial.println("NRF24 DATA RECEIVED");

  Serial.println("================================");

  Serial.print("Packet: ");

  Serial.println(packet.packet_number);

  Serial.print("Temperature: ");

  Serial.print(packet.temperature, 2);

  Serial.println(" °C");

  Serial.print("Humidity: ");

  Serial.print(packet.humidity, 2);

  Serial.println(" %");

  Serial.print("Motion: ");

  if (packet.motion) {

    Serial.println("DETECTED");

  } else {

    Serial.println("NO MOTION");
  }

  Serial.println("================================");

  // ===================================================
  // MOTION EVENT
  // ===================================================

  if (packet.motion && !lastMotionState) {

    Serial.println(">>> MOTION EVENT STARTED <<<");

    buzzerAcknowledged = false;
  }

  if (!packet.motion && lastMotionState) {

    Serial.println(">>> MOTION EVENT CLEARED <<<");
  }

  lastMotionState = packet.motion;

  // ===================================================
  // IMPORTANT
  // ===================================================
  // Do not modify packet data here.
  // HTTP upload is performed immediately for now.
  // ===================================================

  sendSensorData();
}

// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println();
  Serial.println("====================================");

  Serial.println("      IoT RECEIVER ESP32");

  Serial.println("====================================");

  // ===================================================
  // GPIO
  // ===================================================

  pinMode(RGB_RED, OUTPUT);

  pinMode(RGB_GREEN, OUTPUT);

  pinMode(RGB_BLUE, OUTPUT);

  pinMode(BUZZER_PIN, OUTPUT);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  rgbOff();

  digitalWrite(BUZZER_PIN, LOW);

  // ===================================================
  // NRF24
  // ===================================================

  if (!radio.begin()) {

    Serial.println("CRITICAL ERROR: NRF24 NOT DETECTED");

    rgbRed();

    while (true) {

      digitalWrite(BUZZER_PIN, HIGH);

      delay(200);

      digitalWrite(BUZZER_PIN, LOW);

      delay(200);
    }
  }

  radio.setChannel(RADIO_CHANNEL);

  radio.setDataRate(RADIO_DATA_RATE);

  radio.setPALevel(RADIO_PA_LEVEL);

  radio.setRetries(5, 15);

  radio.openReadingPipe(1, RADIO_ADDRESS);

  radio.startListening();

  Serial.println("[OK] NRF24L01 initialized");

  Serial.print("Channel: ");

  Serial.println(RADIO_CHANNEL);

  Serial.println("Data Rate: 250KBPS");

  Serial.println("PA Level: LOW");

  // ===================================================
  // WIFI
  // ===================================================

  connectWiFi();

  // ===================================================
  // INITIAL STATUS
  // ===================================================

  rgbBlue();

  Serial.println();
  Serial.println("RECEIVER READY");

  Serial.println("------------------------------------");

  Serial.print("Device ID: ");

  Serial.println(DEVICE_ID);

  Serial.print("Backend URL: ");

  Serial.println(API_URL);

  Serial.println("API authentication: ENABLED");

  Serial.println("Waiting for NRF24 data...");
}

// =====================================================
// LOOP
// =====================================================

void loop() {

  // ===================================================
  // NRF24
  // ===================================================

  receiveNRF24Data();

  // ===================================================
  // BUTTON
  // ===================================================

  checkButton();

  // ===================================================
  // LOCAL STATUS
  // ===================================================

  updateLocalOutputs();

  // ===================================================
  // WIFI RECONNECT
  // ===================================================

  if (millis() - lastWiFiCheck > WIFI_RECONNECT_INTERVAL) {

    lastWiFiCheck = millis();

    if (WiFi.status() != WL_CONNECTED) {

      Serial.println("Wi-Fi disconnected. Reconnecting...");

      connectWiFi();
    }
  }

  // ===================================================
  // HEARTBEAT
  // ===================================================

  if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL) {

    lastHeartbeat = millis();

    Serial.println();
    Serial.println("========== RECEIVER STATUS ==========");

    Serial.print("Wi-Fi: ");

    if (WiFi.status() == WL_CONNECTED) {

      Serial.println("ONLINE");

    } else {

      Serial.println("OFFLINE");
    }

    Serial.print("IP: ");

    if (WiFi.status() == WL_CONNECTED) {

      Serial.println(WiFi.localIP());

    } else {

      Serial.println("N/A");
    }

    Serial.print("Wi-Fi RSSI: ");

    Serial.print(WiFi.RSSI());

    Serial.println(" dBm");

    Serial.print("Last NRF Packet: ");

    Serial.println(lastPacketNumber);

    Serial.print("Backend Failures: ");

    Serial.println(backendFailures);

    Serial.print("Wi-Fi Reconnects: ");

    Serial.println(wifiReconnects);

    Serial.println("=====================================");

    sendHeartbeat();
  }

  delay(5);
}