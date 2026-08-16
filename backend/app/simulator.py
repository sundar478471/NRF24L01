import time
import math
import random
import requests
import sys

# Backend configurations
BACKEND_URL = "http://localhost:8000/api/v1/sensor-data"
HEARTBEAT_URL = "http://localhost:8000/api/v1/devices/heartbeat"
DEVICE_ID = "receiver-01"
DEVICE_API_KEY = "receiver-key-super-secret-12345"

headers = {
    "Content-Type": "application/json",
    "X-Device-API-Key": DEVICE_API_KEY
}

def run_simulator(duration_seconds=None):
    print("====================================================")
    print("      IoT ESP32 Edge Gateway Receiver Simulator     ")
    print("====================================================")
    print(f"Target URL: {BACKEND_URL}")
    print(f"Device ID:  {DEVICE_ID}")
    print("Press Ctrl+C to exit.\n")

    packet_number = 1
    start_time = time.time()
    last_heartbeat = 0
    motion_active = False
    motion_duration = 0

    while True:
        try:
            current_time = time.time()
            elapsed = current_time - start_time

            if duration_seconds and elapsed >= duration_seconds:
                print(f"[SIMULATOR] Duration limit of {duration_seconds}s reached. Stopping.")
                break

            # 1. Heartbeat logic (every 5 seconds)
            if current_time - last_heartbeat >= 5.0:
                heartbeat_payload = {
                    "device_id": DEVICE_ID,
                    "wifi_status": "CONNECTED",
                    "nrf_status": "ACTIVE"
                }
                try:
                    hb_res = requests.post(HEARTBEAT_URL, json=heartbeat_payload, headers=headers, timeout=2)
                    if hb_res.status_code == 200:
                        print(f"[SIMULATOR] Heartbeat posted successfully. Status: ONLINE")
                    else:
                        print(f"[SIMULATOR] Heartbeat failed (HTTP {hb_res.status_code})")
                except Exception as e:
                    print(f"[SIMULATOR] Heartbeat network error: {e}")
                last_heartbeat = current_time

            # 2. Simulate Sensor Data
            temp = 24.5 + 2.0 * math.sin(elapsed / 120.0) + random.uniform(-0.1, 0.1)
            hum = 55.0 + 5.0 * math.cos(elapsed / 180.0) + random.uniform(-0.2, 0.2)

            # PIR Motion State Machine simulation
            if motion_active:
                motion_duration -= 1
                if motion_duration <= 0:
                    motion_active = False
                    print("[SIMULATOR] PIR Motion cleared (Quiet)")
            else:
                if random.random() < 0.1:
                    motion_active = True
                    motion_duration = random.randint(3, 6)
                    print(f"[SIMULATOR] PIR Motion detected! Active for {motion_duration} cycles")

            sensor_payload = {
                "device_id": DEVICE_ID,
                "temperature": round(temp, 1),
                "humidity": round(hum, 1),
                "motion": motion_active,
                "packet_number": packet_number
            }

            print(f"[SIMULATOR] Posting Packet #{packet_number} -> Temp: {sensor_payload['temperature']}°C, Hum: {sensor_payload['humidity']}%, Motion: {sensor_payload['motion']}...")
            
            try:
                res = requests.post(BACKEND_URL, json=sensor_payload, headers=headers, timeout=3)
                if res.status_code == 201:
                    print(f"    SUCCESS (HTTP Code {res.status_code})")
                    packet_number += 1
                elif res.status_code == 409:
                    print(f"    CONFLICT (Duplicate packet #{packet_number}. Retrying with incremented packet...)")
                    packet_number += 1
                else:
                    print(f"    FAILED (HTTP Code {res.status_code}): {res.text}")
            except Exception as e:
                print(f"    Network error posting sensor data: {e}")

            time.sleep(3.0)

        except KeyboardInterrupt:
            print("\n[SIMULATOR] Stopping simulated stream. Goodbye!")
            sys.exit(0)

if __name__ == "__main__":
    run_simulator()
