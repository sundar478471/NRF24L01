/**
 * Blockchain-Enabled Secure IoT Monitoring System
 * TRANSMITTER NODE FIRMWARE
 * 
 * Hardware: ESP32 WROOM 38-pin
 * Sensors: DHT22 (Temp/Hum), PIR (Motion)
 * Wireless: NRF24L01+ PA/LNA
 */

#include <SPI.h>
#include <RF24.h>
#include <DHT.h>

// Sensor Pin Configurations
#define DHTPIN 17
#define DHTTYPE DHT22
#define PIRPIN 27

// NRF24L01 Pin Configurations
#define CE_PIN 4
#define CSN_PIN 5

// System Parameters
const uint64_t PIPE_ADDRESS = 0x4E4F444531LL; // "NODE1" address
const uint8_t RF_CHANNEL = 108;               // Channel 108
const rf24_pa_dbm_e PA_LEVEL = RF24_PA_LOW;   // Startup power level
const rf24_datarate_e DATA_RATE = RF24_250KBPS; // 250kbps speed for longer range

// Data Packet Structure (Must match Receiver)
struct SensorPacket {
  float temperature;
  float humidity;
  bool motion;
  uint32_t packet_number;
};

// Global Instances
DHT dht(DHTPIN, DHTTYPE);
RF24 radio(CE_PIN, CSN_PIN);
SensorPacket packet = {0.0, 0.0, false, 0};
unsigned long lastReadTime = 0;
const unsigned long READ_INTERVAL = 2500; // Read sensors every 2.5s (DHT22 max rate)

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    delay(10); // Wait for serial port
  }
  Serial.println("\n=== Starting IoT Sensor Transmitter ===");

  // Initialize Sensors
  dht.begin();
  pinMode(PIRPIN, INPUT);
  Serial.println("DHT22 and PIR initialized.");

  // Initialize NRF24L01
  if (!radio.begin()) {
    Serial.println("CRITICAL: NRF24L01 hardware did not respond!");
    while (1) {
      // Loop forever on hardware fault
      delay(1000);
    }
  }

  radio.setChannel(RF_CHANNEL);
  radio.setDataRate(DATA_RATE);
  radio.setPALevel(PA_LEVEL);
  radio.openWritingPipe(PIPE_ADDRESS);
  radio.stopListening(); // Set as Transmitter

  Serial.println("NRF24L01 radio initialized successfully.");
  Serial.print("Channel: "); Serial.println(RF_CHANNEL);
  Serial.print("Data Rate: "); Serial.println("250KBPS");
}

void loop() {
  unsigned long currentMillis = millis();

  // Periodic sensor read and transmit
  if (currentMillis - lastReadTime >= READ_INTERVAL) {
    lastReadTime = currentMillis;

    // Read Sensors
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    bool motion = (digitalRead(PIRPIN) == HIGH);

    // Validate sensor values (prevent NaN crashes)
    if (isnan(t) || isnan(h)) {
      Serial.println("WARNING: Failed to read from DHT sensor! Keeping previous values.");
    } else {
      packet.temperature = t;
      packet.humidity = h;
    }
    packet.motion = motion;
    packet.packet_number++;

    // Diagnostics Serial print
    Serial.print("Reading [Packet #"); Serial.print(packet.packet_number); Serial.println("]");
    Serial.print("  Temp: "); Serial.print(packet.temperature); Serial.println(" C");
    Serial.print("  Hum:  "); Serial.print(packet.humidity); Serial.println(" %");
    Serial.print("  Motion: "); Serial.println(packet.motion ? "DETECTED" : "None");

    // Send packet
    bool success = radio.write(&packet, sizeof(packet));

    if (success) {
      Serial.println("  Transmission: SUCCESSFUL");
    } else {
      Serial.println("  Transmission: FAILED! (Receiver offline or range issue)");
      // Optional: Add NRF retry logic here
    }
    Serial.println("----------------------------------------");
  }
}
