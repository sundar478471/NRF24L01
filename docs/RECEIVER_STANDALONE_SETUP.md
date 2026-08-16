# Receiver Standalone Setup & Power Architecture

This guide explains how to build, wire, configure, and power the **ESP32 Edge Gateway Receiver** node as an independent standalone device (operating without a host laptop connected over USB).

---

## 1. Safety Warning & Multimeter Validation

Before assembling and powering your standalone node, you **MUST** configure and verify the output voltage of your DC-DC buck converter.

> [!CAUTION]
> - **DO NOT connect 12V directly to the ESP32 pins** (doing so will instantly destroy the onboard regulator and microcontroller).
> - **DO NOT connect 12V or 5V to the NRF24L01+ VCC pin** (the transceiver operates strictly on 3.3V).
> - **DO NOT assume the DC-DC buck converter output preset**. You must test and calibrate it first.

### Step-by-Step Buck Converter Calibration:
1. Connect your **12V 1A AC-DC power adapter** to the input terminals (`IN+` and `IN-`) of the DC-DC buck converter.
2. Turn on your power supply.
3. Configure your **Digital Multimeter** to read DC Voltage.
4. Touch the multimeter probes to the output terminals (`OUT+` and `OUT-`) of the buck converter.
5. Using a small screwdriver, rotate the brass potentiometer screw on the buck converter until your multimeter displays exactly **5.0V** (if powering the ESP32 via its `VIN` pin) or **3.3V** (if powering via the `3V3` pin directly, provided your board design supports direct bypass).
6. Disconnect the power adapter from the mains outlet before proceeding to solder or wire the components.

---

## 2. Standalone Node Wiring Diagram

Once the DC-DC converter output is measured and locked at **5.0V**, wire the system as follows:

```
[12V Power Adapter] 
    │  ┌──────────────┐
    ├──│ IN+      OUT+│──(5.0V Regulated)──> ESP32 VIN Pin
    └──│ IN-      OUT-│────────────────────> ESP32 GND Pin
       └──────────────┘
      [Buck Converter]

[ESP32 Receiver Board]
    ├── 3V3 Pin ───────────────────────────> NRF24L01 VCC Pin (3.3V ONLY)
    ├── GND Pin ───────────────────────────> Common Ground (NRF24, Buzzer, Button, RGB)
    │
    ├── GPIO4  ────────────────────────────> NRF24L01 CE Pin
    ├── GPIO5  ────────────────────────────> NRF24L01 CSN Pin
    ├── GPIO18 ────────────────────────────> NRF24L01 SCK Pin
    ├── GPIO23 ────────────────────────────> NRF24L01 MOSI Pin
    ├── GPIO19 ────────────────────────────> NRF24L01 MISO Pin
    │
    ├── GPIO25 ───[ 220Ω Resistor ]────────> RGB LED Red Pin
    ├── GPIO26 ───[ 220Ω Resistor ]────────> RGB LED Green Pin
    ├── GPIO33 ───[ 220Ω Resistor ]────────> RGB LED Blue Pin
    │
    ├── GPIO13 ────────────────────────────> Buzzer Pos (+) Terminal
    │
    └── GPIO32 ───[ Push Button ]──────────> GND (Common Ground)
```

---

## 3. Physical Node Assembly Checklist

1. **Power decoupling**: NRF24L01+ modules are sensitive to electrical noise. Solder a **10 µF electrolytic capacitor** directly between the NRF24L01's VCC and GND pins (be sure to match the positive/negative capacitor leads correctly).
2. **Current Limits**: The passive buzzer should be powered via a small NPN transistor driver (e.g. PN2222) if its current draw exceeds 12mA, preventing GPIO strain on the ESP32.
3. **Common Ground**: Ensure the GND of the buck converter output, ESP32 board, NRF24L01, push button, buzzer, and RGB common cathode are all tied together to establish a common reference potential.
4. **Boot Configuration**: The push button on GPIO32 is configured as `INPUT_PULLUP`. It stays `HIGH` normally, and pulls to `GND` (`LOW`) when pressed, triggering the silence latch.

---

## 4. Standalone Test Verification

1. Double-check all pins to ensure no short-circuits.
2. Plug the 12V adapter into the mains outlet.
3. Observe the RGB LED status indicator:
   - **BLUE (Flashing/Solid)**: Node is starting up and attempting to join the local Wi-Fi SSID configured in the firmware.
   - **GREEN**: Wi-Fi and NRF link are connected, system is normal and monitoring for motion.
   - **RED (Buzzer Alarm)**: Motion has been detected. Click the push button to silence the alarm.
   - **BLUE (Solid after timeout)**: The NRF24L01 link from the transmitter has been lost (timeout after 10s of inactivity).
