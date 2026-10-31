"""SIMULATOR - generates synthetic device traffic against a running API.

This stands in for hardware that does not exist in this repository:
  * UHF RFID readers at gates/checkpoints  -> POST /api/v1/rfid/sightings
  * CCTV AI person counters                -> POST /api/v1/crowd/readings
  * Parking loop counters                  -> POST /api/v1/parking/{id}/occupancy

Everything it sends is labelled by the device identity it uses (demo keys from app/seed.py),
and the dashboard shows the source. Run:  python simulators/simulate.py --base http://localhost:8000
"""
from __future__ import annotations

import argparse
import random
import time
from datetime import datetime, timezone

import httpx

from_app_keys = {
    "rfid-gate-a": "pk_demo_rfid_gate_a",
    "rfid-gate-b": "pk_demo_rfid_gate_b",
    "rfid-gate-c": "pk_demo_rfid_gate_c",
    "rfid-cp-1": "pk_demo_rfid_cp_1",
    "rfid-cp-2": "pk_demo_rfid_cp_2",
    "rfid-helpdesk-1": "pk_demo_rfid_helpdesk_1",
    "cam-pushkar": "pk_demo_cam_pushkar",
    "cam-kotilingala": "pk_demo_cam_kotilingala",
    "parking-p1": "pk_demo_parking_p1",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--interval", type=float, default=5.0, help="seconds between rounds")
    ap.add_argument("--rounds", type=int, default=0, help="0 = run forever")
    ap.add_argument("--tags", default="GP27-00001,GP27-00002,GP27-00003", help="comma separated tag UIDs to move around")
    args = ap.parse_args()
    api = args.base.rstrip("/") + "/api/v1"
    tags = [t.strip() for t in args.tags.split(",")]
    client = httpx.Client(timeout=10)

    lots = client.get(f"{api}/parking").json()
    p1 = next((l for l in lots if l["location"]["code"] == "PARK-P1"), None)
    cam_state = {"cam-pushkar": 14000, "cam-kotilingala": 7500}
    readers = ["rfid-gate-a", "rfid-cp-1", "rfid-cp-2", "rfid-gate-b", "rfid-helpdesk-1", "rfid-gate-c"]
    pos = {t: random.randrange(len(readers)) for t in tags}

    n = 0
    while args.rounds == 0 or n < args.rounds:
        n += 1
        now = datetime.now(timezone.utc).isoformat()
        # cameras: random walk around demo counts
        for cam, cnt in cam_state.items():
            cnt = max(500, min(16000, cnt + random.randint(-900, 900)))
            cam_state[cam] = cnt
            r = client.post(f"{api}/crowd/readings", json={"count": cnt, "source": "camera", "recorded_at": now}, headers={"X-Device-Key": from_app_keys[cam]})
            print(f"[{cam}] count={cnt} -> {r.status_code}")
        # rfid: each tag walks to the next reader
        for t in tags:
            pos[t] = (pos[t] + 1) % len(readers)
            reader = readers[pos[t]]
            r = client.post(f"{api}/rfid/sightings", json=[{"tag_uid": t, "rssi": round(random.uniform(-70, -40), 1), "direction": random.choice(["in", "out"]), "seen_at": now}], headers={"X-Device-Key": from_app_keys[reader]})
            print(f"[{reader}] tag={t} -> {r.status_code} {r.json()}")
        # parking: cars in/out
        if p1:
            delta = random.randint(-15, 25)
            r = client.post(f"{api}/parking/{p1['id']}/occupancy", json={"delta": delta}, headers={"X-Device-Key": from_app_keys["parking-p1"]})
            print(f"[parking-p1] delta={delta:+d} -> {r.status_code} occupied={r.json().get('occupied_slots')}")
        if args.rounds == 0 or n < args.rounds:
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
