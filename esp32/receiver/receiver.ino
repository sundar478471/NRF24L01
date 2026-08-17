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

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <RF24.h>
#include "receiver_config.h"

// =====================================================
// USER CONFIGURATION
// =====================================================

// Wi-Fi credentials loaded from receiver_config.h
const char* WIFI_SSID = SECRET_SSID;
const char* WIFI_PASSWORD = SECRET_PASS;

// IMPORTANT:
// Put your PUBLIC backend API endpoint here.
//
// Example:
// https://your-domain.com/api/v1/sensor-data
//
// DO NOT use:
// localhost
// 127.0.0.1
// 192.168.x.x

const char* API_URL =
  "https://nrf24l01-monitoring.vercel.app/api/v1/sensor-data";

const char* HEARTBEAT_URL =
  "https://nrf24l01-monitoring.vercel.app/api/v1/devices/heartbeat";

// Device identifier used by your website/backend
const char* DEVICE_ID = "receiver-01";

// Device API key loaded from receiver_config.h
const char* DEVICE_API_KEY = SECRET_API_KEY;

// =====================================================
// NRF24 PINS
// =====================================================

#define NRF_CE 4
#define NRF_CSN 5

// =====================================================
// RECEIVER OUTPUT PINS
// =====================================================

#define RGB_RED 25
#define RGB_GREEN 26
#define RGB_BLUE 33

#define BUTTON_PIN 32

#define BUZZER_PIN 13

// =====================================================
// NRF24 CONFIGURATION
// MUST MATCH TRANSMITTER
// =====================================================

const uint64_t RADIO_ADDRESS = 0x4E4F444531LL;

const uint8_t RADIO_CHANNEL = 108;

const rf24_datarate_e RADIO_DATA_RATE = RF24_250KBPS;

const rf24_pa_dbm_e RADIO_PA_LEVEL = RF24_PA_LOW;

// =====================================================
// SENSOR PACKET
// MUST EXACTLY MATCH TRANSMITTER
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

// Device diagnostics and state tracking
uint32_t wifiReconnects = 0;
uint32_t backendFailures = 0;
const char* FIRMWARE_VERSION = "1.0.0";

// Device considered offline after this period
const unsigned long DEVICE_TIMEOUT = 10000;

// Wi-Fi reconnect interval
const unsigned long WIFI_RECONNECT_INTERVAL = 10000;

// Heartbeat interval
const unsigned long HEARTBEAT_INTERVAL = 30000;

// =====================================================
// RGB LED FUNCTIONS
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

  wifiReconnects++; // Increment wifi reconnect counter

  Serial.println();
  Serial.println("Connecting to Wi-Fi...");

  WiFi.mode(WIFI_STA);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();

  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - start < 15000
  ) {

    delay(500);

    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {

    Serial.println("Wi-Fi CONNECTED");

    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());

  } else {

    Serial.println("Wi-Fi connection FAILED");

  }
}

// =====================================================
// SEND SENSOR DATA TO WEBSITE BACKEND
// =====================================================

bool sendSensorData() {

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot send data: Wi-Fi offline");
    return false;
  }

  WiFiClientSecure secureClient;
  WiFiClient client;
  HTTPClient http;
  bool beginSuccess = false;

  Serial.println();
  Serial.println("Sending sensor data to backend...");

  if (String(API_URL).startsWith("https://")) {
    secureClient.setInsecure();
    beginSuccess = http.begin(secureClient, API_URL);
  } else {
    beginSuccess = http.begin(client, API_URL);
  }

  if (!beginSuccess) {
    Serial.println("Connection initialization failed");
    backendFailures++;
    return false;
  }

  http.setTimeout(8000);

  // Authentication - updated to expect "X-Device-API-Key"
  http.addHeader(
    "X-Device-API-Key",
    DEVICE_API_KEY
  );

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  // ---------------------------------------------------
  // JSON DATA
  // ---------------------------------------------------

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
  
  // Add diagnostic fields to match database schemas
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
  json += "\"buffer_count\":0,";
  json += "\"firmware_version\":\"";
  json += FIRMWARE_VERSION;
  json += "\"";

  json += "}";

  Serial.println("JSON:");
  Serial.println(json);

  // ---------------------------------------------------
  // POST
  // ---------------------------------------------------

  int httpCode = http.POST(json);

  Serial.print("HTTP Status: ");
  Serial.println(httpCode);

  bool success = false;
  if (httpCode > 0) {

    String response = http.getString();

    Serial.println("Server Response:");
    Serial.println(response);

    if (httpCode >= 200 && httpCode < 300) {
      Serial.println("DATA UPLOAD SUCCESS");
      success = true;
    } else {
      backendFailures++;
    }

  } else {
    Serial.print("HTTP Error: ");
    Serial.println(http.errorToString(httpCode));
    backendFailures++;
  }

  http.end();

  return success;
}

// =====================================================
// SEND HEARTBEAT TO WEBSITE BACKEND
// =====================================================

bool sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot send heartbeat: Wi-Fi offline");
    return false;
  }

  WiFiClientSecure secureClient;
  WiFiClient client;
  HTTPClient http;
  bool beginSuccess = false;

  Serial.println();
  Serial.println("Sending heartbeat to backend...");

  if (String(HEARTBEAT_URL).startsWith("https://")) {
    secureClient.setInsecure();
    beginSuccess = http.begin(secureClient, HEARTBEAT_URL);
  } else {
    beginSuccess = http.begin(client, HEARTBEAT_URL);
  }

  if (!beginSuccess) {
    Serial.println("Heartbeat connection initialization failed");
    backendFailures++;
    return false;
  }

  http.setTimeout(8000);

  http.addHeader("X-Device-API-Key", DEVICE_API_KEY);
  http.addHeader("Content-Type", "application/json");

  // Determine NRF Link status
  String nrfStatus = "ERROR";
  if (millis() - lastPacketReceived <= DEVICE_TIMEOUT && lastPacketReceived > 0) {
    nrfStatus = "ACTIVE";
  }

  // JSON payload
  String json = "{";
  json += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  json += "\"wifi_status\":\"CONNECTED\",";
  json += "\"nrf_status\":\"" + nrfStatus + "\",";
  json += "\"wifi_reconnects\":" + String(wifiReconnects) + ",";
  json += "\"backend_failures\":" + String(backendFailures) + ",";
  json += "\"uptime\":" + String(millis() / 1000) + ",";
  json += "\"buffer_count\":0,";
  json += "\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"";
  json += "}";

  Serial.println("JSON:");
  Serial.println(json);

  int httpCode = http.POST(json);

  Serial.print("HTTP Status: ");
  Serial.println(httpCode);

  bool success = false;
  if (httpCode > 0) {
    String response = http.getString();
    Serial.println("Server Response:");
    Serial.println(response);
    if (httpCode >= 200 && httpCode < 300) {
      Serial.println("HEARTBEAT SUCCESS");
      success = true;
    } else {
      backendFailures++;
    }
  } else {
    Serial.print("HTTP Error: ");
    Serial.println(http.errorToString(httpCode));
    backendFailures++;
  }

  http.end();
  return success;
}

// =====================================================
// LOCAL DEVICE STATUS
// =====================================================

void updateLocalOutputs() {

  if (millis() - lastPacketReceived > DEVICE_TIMEOUT) {

    // NRF24 communication timeout
    rgbBlue();

    digitalWrite(BUZZER_PIN, LOW);

    return;
  }

  // Motion detected
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

  if (
    previousButtonState == HIGH &&
    currentButtonState == LOW
  ) {

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

    radio.read(
      &packet,
      sizeof(packet)
    );
  }

  // ---------------------------------------------------
  // VALIDATE DATA
  // ---------------------------------------------------

  if (isnan(packet.temperature) ||
      isnan(packet.humidity)) {

    Serial.println(
      "WARNING: Invalid sensor packet"
    );

    return;
  }

  if (packet.humidity < 0 ||
      packet.humidity > 100) {

    Serial.println(
      "WARNING: Invalid humidity"
    );

    return;
  }

  if (packet.temperature < -50 ||
      packet.temperature > 100) {

    Serial.println(
      "WARNING: Invalid temperature"
    );

    return;
  }

  // ---------------------------------------------------
  // PACKET RECEIVED
  // ---------------------------------------------------

  lastPacketReceived = millis();

  lastPacketNumber = packet.packet_number;

  Serial.println();
  Serial.println("================================");

  Serial.println("NRF24 DATA RECEIVED");

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

  // ---------------------------------------------------
  // MOTION STATE CHANGE
  // ---------------------------------------------------

  if (
    packet.motion &&
    !lastMotionState
  ) {

    Serial.println(">>> MOTION EVENT STARTED <<<");

    buzzerAcknowledged = false;
  }

  if (
    !packet.motion &&
    lastMotionState
  ) {

    Serial.println(">>> MOTION EVENT CLEARED <<<");
  }

  lastMotionState = packet.motion;

  // ---------------------------------------------------
  // SEND TO WEBSITE
  // ---------------------------------------------------

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

  // ---------------------------------------------------
  // GPIO
  // ---------------------------------------------------

  pinMode(RGB_RED, OUTPUT);

  pinMode(RGB_GREEN, OUTPUT);

  pinMode(RGB_BLUE, OUTPUT);

  pinMode(BUZZER_PIN, OUTPUT);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  rgbOff();

  digitalWrite(BUZZER_PIN, LOW);

  // ---------------------------------------------------
  // NRF24
  // ---------------------------------------------------

  if (!radio.begin()) {

    Serial.println(
      "CRITICAL ERROR: NRF24 NOT DETECTED"
    );

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

  radio.openReadingPipe(
    1,
    RADIO_ADDRESS
  );

  radio.startListening();

  Serial.println(
    "[OK] NRF24L01 initialized"
  );

  // ---------------------------------------------------
  // WIFI
  // ---------------------------------------------------

  connectWiFi();

  // ---------------------------------------------------
  // INITIAL STATUS
  // ---------------------------------------------------

  rgbBlue();

  Serial.println();
  Serial.println("RECEIVER READY");
  Serial.println("------------------------------------");

  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);

  Serial.println("Waiting for NRF24 data...");
}

// =====================================================
// LOOP
// =====================================================

void loop() {

  // ---------------------------------------------------
  // NRF24
  // ---------------------------------------------------

  receiveNRF24Data();

  // ---------------------------------------------------
  // BUTTON
  // ---------------------------------------------------

  checkButton();

  // ---------------------------------------------------
  // LOCAL STATUS
  // ---------------------------------------------------

  updateLocalOutputs();

  // ---------------------------------------------------
  // WIFI RECONNECT
  // ---------------------------------------------------

  if (
    millis() - lastWiFiCheck >
    WIFI_RECONNECT_INTERVAL
  ) {

    lastWiFiCheck = millis();

    if (WiFi.status() != WL_CONNECTED) {

      Serial.println(
        "Wi-Fi disconnected. Reconnecting..."
      );

      connectWiFi();
    }
  }

  // ---------------------------------------------------
  // HEARTBEAT
  // ---------------------------------------------------

  if (
    millis() - lastHeartbeat >
    HEARTBEAT_INTERVAL
  ) {

    lastHeartbeat = millis();

    Serial.println();
    Serial.println("========== RECEIVER STATUS ==========");

    Serial.print("Wi-Fi: ");

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("ONLINE");
    } else {
      Serial.println("OFFLINE");
    }

    Serial.print("Last NRF Packet: ");
    Serial.println(lastPacketNumber);

    Serial.print("Last Data Age: ");
    Serial.print(
      (millis() - lastPacketReceived) / 1000
    );
    Serial.println(" seconds");

    Serial.println("=====================================");

    // Send active heartbeat to website backend
    sendHeartbeat();
  }

  delay(5);
}
