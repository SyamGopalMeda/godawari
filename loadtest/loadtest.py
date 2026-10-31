"""Load test: mixed pilgrim read traffic + device write traffic against a running API.

Usage:  python loadtest/loadtest.py --base http://localhost:8000 --users 200 --seconds 30

Traffic mix per virtual user loop (approximates festival usage):
  55%  GET /crowd/status            (home/crowd screen refresh)
  15%  GET /locations?near=...       (facilities)
  10%  GET /parking
  10%  GET /routes?from=...&to=...   (navigation)
   5%  GET /alerts/active
   5%  device writes: POST /crowd/readings or /rfid/sightings (demo device keys)

Prints throughput, error rate and latency percentiles. This measures the single-process dev
server (uvicorn, SQLite); production numbers (PostgreSQL, N workers, Redis cache) will differ.
"""
from __future__ import annotations

import argparse
import asyncio
import random
import statistics
import time

import httpx

DEMO_KEYS = ["pk_demo_cam_pushkar", "pk_demo_cam_kotilingala", "pk_demo_rfid_gate_a", "pk_demo_rfid_cp_2"]


async def worker(client: httpx.AsyncClient, api: str, stop: float, dests: list[int], lat: list[tuple[str, float, bool]]):
    while time.perf_counter() < stop:
        r = random.random()
        t0 = time.perf_counter()
        ok = False
        name = ""
        try:
            if r < 0.55:
                name = "crowd/status"
                resp = await client.get(f"{api}/crowd/status")
            elif r < 0.70:
                name = "locations/near"
                resp = await client.get(f"{api}/locations", params={"types": "restroom,water,medical", "near": "17.0018,81.7762", "radius_m": 800})
            elif r < 0.80:
                name = "parking"
                resp = await client.get(f"{api}/parking", params={"near": "17.0030,81.7805"})
            elif r < 0.90:
                name = "routes"
                resp = await client.get(f"{api}/routes", params={"from": "17.0110,81.7860", "to": random.choice(dests)})
            elif r < 0.95:
                name = "alerts"
                resp = await client.get(f"{api}/alerts/active")
            else:
                key = random.choice(DEMO_KEYS)
                if "cam" in key:
                    name = "POST crowd/readings"
                    resp = await client.post(f"{api}/crowd/readings", json={"count": random.randint(500, 15000), "source": "camera"}, headers={"X-Device-Key": key})
                else:
                    name = "POST rfid/sightings"
                    resp = await client.post(f"{api}/rfid/sightings", json=[{"tag_uid": f"GP27-{random.randint(1, 50):05d}"}], headers={"X-Device-Key": key})
            ok = resp.status_code < 400
        except Exception:  # noqa: BLE001
            ok = False
        lat.append((name, time.perf_counter() - t0, ok))


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--users", type=int, default=100)
    ap.add_argument("--seconds", type=int, default=20)
    args = ap.parse_args()
    api = args.base.rstrip("/") + "/api/v1"
    async with httpx.AsyncClient(timeout=30, limits=httpx.Limits(max_connections=args.users + 10)) as client:
        locs = (await client.get(f"{api}/locations", params={"type": "ghat"})).json()
        dests = [l["id"] for l in locs]
        lat: list[tuple[str, float, bool]] = []
        stop = time.perf_counter() + args.seconds
        t0 = time.perf_counter()
        await asyncio.gather(*(worker(client, api, stop, dests, lat) for _ in range(args.users)))
        elapsed = time.perf_counter() - t0
    total = len(lat)
    errors = sum(1 for _, _, ok in lat if not ok)
    times = sorted(t for _, t, _ in lat)

    def pct(p: float) -> float:
        return times[min(len(times) - 1, int(p * len(times)))] * 1000 if times else 0

    print(f"users={args.users} duration={elapsed:.1f}s requests={total} rps={total / elapsed:.1f} errors={errors} ({errors / max(total, 1) * 100:.2f}%)")
    print(f"latency ms: p50={pct(.5):.0f} p90={pct(.9):.0f} p95={pct(.95):.0f} p99={pct(.99):.0f} max={times[-1] * 1000 if times else 0:.0f} mean={statistics.fmean(times) * 1000 if times else 0:.0f}")
    by: dict[str, list[float]] = {}
    for name, t, _ in lat:
        by.setdefault(name, []).append(t)
    for name, ts in sorted(by.items()):
        ts.sort()
        print(f"  {name:22s} n={len(ts):6d} p50={ts[len(ts) // 2] * 1000:6.0f}ms p95={ts[min(len(ts) - 1, int(.95 * len(ts)))] * 1000:6.0f}ms")


if __name__ == "__main__":
    asyncio.run(main())
