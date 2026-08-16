# ESP32 Hardware Wiring & Firmware Setup Guide

This document describes the physical wiring diagrams, pinout configurations, library dependencies, and upload procedures for the Transmitter and Receiver nodes.

---

## 1. Physical Hardware Components

- **Transmitter**: ESP32 WROOM (38-pin), DHT22 sensor, PIR motion sensor, NRF24L01+ PA/LNA.
- **Receiver**: NodeMCU ESP-32S (30-pin), RGB LED (Common Cathode), Buzzer, Push Button, NRF24L01.

---

## 2. Transmitter Wiring Diagram

| Component | Component Pin | ESP32 Pin | Voltage Requirement |
| :--- | :--- | :--- | :--- |
| **DHT22** | DATA | GPIO17 | 3.3V |
| **DHT22** | VCC | 3.3V / VIN | 3.3V or 5V |
| **DHT22** | GND | GND | GND |
| **PIR** | OUT | GPIO27 | 5V |
| **PIR** | VCC | VIN / 5V | 5V |
| **PIR** | GND | GND | GND |
| **NRF24L01** | CE | GPIO4 | 3.3V |
| **NRF24L01** | CSN | GPIO5 | 3.3V |
| **NRF24L01** | SCK | GPIO18 | 3.3V |
| **NRF24L01** | MOSI | GPIO23 | 3.3V |
| **NRF24L01** | MISO | GPIO19 | 3.3V |
| **NRF24L01** | VCC | 3.3V | **3.3V ONLY** (Never connect to 5V) |
| **NRF24L01** | GND | GND | GND |

---

## 3. Receiver Wiring Diagram

| Component | Component Pin | ESP32 Pin | Wiring Description |
| :--- | :--- | :--- | :--- |
| **RGB LED** | RED | GPIO25 | Through 220Ω Resistor |
| **RGB LED** | GREEN | GPIO26 | Through 220Ω Resistor |
| **RGB LED** | BLUE | GPIO33 | Through 220Ω Resistor |
| **RGB LED** | Common Cathode| GND | Ground |
| **Push Button**| PIN 1 | GPIO32 | Configured as `INPUT_PULLUP` |
| **Push Button**| PIN 2 | GND | Ground |
| **Buzzer** | POSITIVE (+) | GPIO13 | Direct pin (or via NPN transistor) |
| **Buzzer** | NEGATIVE (-) | GND | Ground |
| **NRF24L01** | CE | GPIO4 | 3.3V SPI Control |
| **NRF24L01** | CSN | GPIO5 | 3.3V SPI Select |
| **NRF24L01** | SCK | GPIO18 | Hardware SPI SCK |
| **NRF24L01** | MOSI | GPIO23 | Hardware SPI MOSI |
| **NRF24L01** | MISO | GPIO19 | Hardware SPI MISO |
| **NRF24L01** | VCC | 3.3V | **3.3V ONLY** |
| **NRF24L01** | GND | GND | Ground |

---

## 4. Software & IDE Setup

To compile the firmware, configure the Arduino IDE with the following:

### Board Manager Configuration
1. Open Arduino IDE -> Preferences.
2. Add Additional Boards Manager URL:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. Tools -> Board -> Boards Manager -> Search **ESP32** by Espressif and install version 2.x+.

### Library Installation
Open Tools -> Manage Libraries and search/install:
- **RF24** (by TMRh20): For NRF24L01 communication.
- **DHT sensor library** (by Adafruit): For the DHT22 temperature/humidity sensor.
- **Adafruit Unified Sensor** (by Adafruit): Helper library.

---

## 5. Upload Procedure

1. Connect the ESP32 to your PC using a micro-USB cable.
2. Select your board (e.g. `ESP32 Dev Module` or `NodeMCU-32S`) under Tools -> Board.
3. Select the correct Port (e.g. `COM3` on Windows, `/dev/ttyUSB0` on Linux/macOS).
4. Update configuration values in `receiver.ino`:
   - `WIFI_SSID`
   - `WIFI_PASSWORD`
   - `API_URL` (Host server IP address on port 8000)
5. Click **Upload** (Right Arrow icon).
6. Press the **BOOT** button on the ESP32 board if the IDE displays `Connecting...` until the writing percentage begins.

---

## 6. NRF24L01 Troubleshooting

NRF24L01 modules are highly sensitive to voltage spikes and noise. If communication fails, check the following:

- **Power decoupling**: Solder/wrap a **10 µF electrolytic capacitor** directly between the NRF24's VCC and GND pins. This filters out motor/RF switching noise from the ESP32 power rail.
- **Dedicated 3.3V supply**: ESP32 GPIOs or on-board 3.3V regulators can sometimes supply insufficient current to the NRF24L01 (especially the PA/LNA high power versions). Use an external 3.3V buck regulator or NRF24 adapter board if necessary.
- **Interference**:
  - The module operates on 2.4GHz (overlapping with Wi-Fi). Channel 108 is chosen because it sits above standard Wi-Fi channels (2.4GHz ends around 2.4835GHz, which is Channel 83. Channel 108 is ~2.508GHz, clear of Wi-Fi noise).
  - Both nodes MUST use matching settings:
    - Address: `"NODE1"`
    - Channel: `108`
    - Speed: `250KBPS` (longer transmission range, less susceptible to loss).

---

## 7. Standalone & Production Deployments

For advanced configurations, standalone battery/mains power setup, and cloud hosting:
- **Standalone Node Assembly**: See [RECEIVER_STANDALONE_SETUP.md](file:///d:/NRF24L01/docs/RECEIVER_STANDALONE_SETUP.md) for 12V adapter and DC-DC buck converter wiring guides.
- **Public Cloud Hosting**: See [DEPLOYMENT.md](file:///d:/NRF24L01/docs/DEPLOYMENT.md) for instructions on deploying the backend to public HTTPS endpoints (Render/Railway) and compiling the receiver to target it directly.

