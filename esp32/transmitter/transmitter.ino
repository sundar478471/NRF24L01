/*
  Blockchain-Enabled IoT Monitoring System
  TRANSMITTER ESP32

  Hardware:
  - ESP32 WROOM 38-pin
  - DHT22
  - PIR
  - NRF24L01

  Data flow:
  DHT22 + PIR
       ↓
  ESP32 Transmitter
       ↓
  NRF24L01
*/

#include <SPI.h>
#include <RF24.h>
#include <DHT.h>

// =====================================================
// PIN CONFIGURATION
// =====================================================

#define DHT_PIN 17
#define DHT_TYPE DHT22

#define PIR_PIN 27

#define NRF_CE 4
#define NRF_CSN 5

// =====================================================
// NRF24 CONFIGURATION
// =====================================================

const uint64_t RADIO_ADDRESS = 0x4E4F444531LL; // NODE1

const uint8_t RADIO_CHANNEL = 108;

const rf24_datarate_e RADIO_DATA_RATE = RF24_250KBPS;

const rf24_pa_dbm_e RADIO_PA_LEVEL = RF24_PA_LOW;

// =====================================================
// SENSOR TRANSMISSION INTERVAL
// =====================================================

const unsigned long SENSOR_INTERVAL = 2500;

// =====================================================
// SENSOR PACKET
// IMPORTANT:
// Receiver MUST use the exact same structure.
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

DHT dht(DHT_PIN, DHT_TYPE);

RF24 radio(NRF_CE, NRF_CSN);

SensorPacket packet;

// =====================================================
// VARIABLES
// =====================================================

unsigned long lastSensorRead = 0;

uint32_t packetCounter = 0;

// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println();
  Serial.println("=================================");
  Serial.println("   IoT TRANSMITTER ESP32");
  Serial.println("=================================");

  // -----------------------------
  // DHT22
  // -----------------------------

  dht.begin();

  Serial.println("[OK] DHT22 initialized");

  // -----------------------------
  // PIR
  // -----------------------------

  pinMode(PIR_PIN, INPUT);

  Serial.println("[OK] PIR initialized");

  // -----------------------------
  // NRF24
  // -----------------------------

  if (!radio.begin()) {

    Serial.println("[ERROR] NRF24L01 NOT DETECTED");

    while (true) {
      delay(1000);
    }
  }

  radio.setChannel(RADIO_CHANNEL);

  radio.setDataRate(RADIO_DATA_RATE);

  radio.setPALevel(RADIO_PA_LEVEL);

  radio.setRetries(5, 15);

  radio.openWritingPipe(RADIO_ADDRESS);

  radio.stopListening();

  Serial.println("[OK] NRF24L01 initialized");

  Serial.print("Channel: ");
  Serial.println(RADIO_CHANNEL);

  Serial.println("Data Rate: 250KBPS");

  Serial.println();
  Serial.println("TRANSMITTER READY");
  Serial.println("---------------------------------");

  packet.temperature = 0;
  packet.humidity = 0;
  packet.motion = false;
  packet.packet_number = 0;
}

// =====================================================
// LOOP
// =====================================================

void loop() {

  unsigned long now = millis();

  if (now - lastSensorRead < SENSOR_INTERVAL) {
    return;
  }

  lastSensorRead = now;

  // -----------------------------
  // READ DHT22
  // -----------------------------

  float temperature = dht.readTemperature();

  float humidity = dht.readHumidity();

  if (!isnan(temperature)) {
    packet.temperature = temperature;
  } else {
    Serial.println("[WARNING] Temperature read failed");
  }

  if (!isnan(humidity)) {
    packet.humidity = humidity;
  } else {
    Serial.println("[WARNING] Humidity read failed");
  }

  // -----------------------------
  // READ PIR
  // -----------------------------

  packet.motion = digitalRead(PIR_PIN) == HIGH;

  // -----------------------------
  // PACKET NUMBER
  // -----------------------------

  packetCounter++;

  packet.packet_number = packetCounter;

  // -----------------------------
  // SERIAL OUTPUT
  // -----------------------------

  Serial.println();

  Serial.print("Packet #");
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

  // -----------------------------
  // SEND THROUGH NRF24
  // -----------------------------

  bool sent = radio.write(&packet, sizeof(packet));

  if (sent) {

    Serial.println("NRF24: TRANSMISSION SUCCESS");

  } else {

    Serial.println("NRF24: TRANSMISSION FAILED");

  }

  Serial.println("---------------------------------");
}
