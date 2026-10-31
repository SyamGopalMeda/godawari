"""DEMO seed (tests and offline demos only - PUSHKAR_SEED_MODE=demo). Production uses app/seed_real.py.

Demo seed data for a Rajamahendravaram (Rajahmundry) riverfront pilot site.

*** All coordinates, capacities and names below are DEMO values for development and testing. ***
They are placed along the real Godavari riverfront at Rajamahendravaram but are NOT surveyed
positions. Replace with the organisers' surveyed facility list before any field deployment
(see docs/09-deployment-and-operations.md, "Data onboarding").
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import (
    Alert,
    Device,
    Location,
    ParkingLot,
    RfidTag,
    Site,
    User,
    WalkwayEdge,
    WalkwayNode,
)
from .security import hash_password, hash_token
from .services.crowd import record_reading
from .services.geo import haversine_m

log = logging.getLogger("seed")

DEMO = {"seed": "demo", "note": "Demo coordinates - replace with surveyed data"}

# Demo device keys are fixed so simulators can use them. Never do this in production:
# production keys are generated once at registration and shown only to the operator.
DEMO_DEVICE_KEYS = {
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

LOCATIONS: list[dict] = [
    # ghats (monitored, with capacity)
    dict(code="GHAT-GOWTHAMI", type="ghat", name="Gowthami Ghat", name_te="గౌతమి ఘాట్", name_hi="गौतमी घाट", lat=17.0095, lng=81.7788, capacity=8000, monitored=True),
    dict(code="GHAT-KOTILINGALA", type="ghat", name="Kotilingala Ghat", name_te="కోటిలింగాల ఘాట్", name_hi="कोटिलिंगला घाट", lat=17.0052, lng=81.7772, capacity=10000, monitored=True),
    dict(code="GHAT-PUSHKAR", type="ghat", name="Pushkar Ghat", name_te="పుష్కర ఘాట్", name_hi="पुष्कर घाट", lat=17.0018, lng=81.7762, capacity=15000, monitored=True),
    dict(code="GHAT-SARASWATHI", type="ghat", name="Saraswathi Ghat", name_te="సరస్వతి ఘాట్", name_hi="सरस्वती घाट", lat=16.9975, lng=81.7752, capacity=6000, monitored=True),
    dict(code="GHAT-PADMAVATHI", type="ghat", name="Padmavathi Ghat (accessible)", name_te="పద్మావతి ఘాట్ (సులభ ప్రవేశం)", name_hi="पद्मावती घाट (सुगम)", lat=16.9935, lng=81.7745, capacity=7000, monitored=True, is_accessible=True),
    # gates (monitored)
    dict(code="GATE-A", type="gate", name="Gate A - North", name_te="గేట్ A - ఉత్తరం", name_hi="गेट A - उत्तर", lat=17.0080, lng=81.7820, capacity=3000, monitored=True),
    dict(code="GATE-B", type="gate", name="Gate B - Central", name_te="గేట్ B - మధ్య", name_hi="गेट B - मध्य", lat=17.0020, lng=81.7800, capacity=4000, monitored=True),
    dict(code="GATE-C", type="gate", name="Gate C - South", name_te="గేట్ C - దక్షిణం", name_hi="गेट C - दक्षिण", lat=16.9950, lng=81.7790, capacity=3000, monitored=True),
    dict(code="GATE-D", type="gate", name="Gate D - Accessible entry", name_te="గేట్ D - సులభ ప్రవేశం", name_hi="गेट D - सुगम प्रवेश", lat=16.9940, lng=81.7762, capacity=1500, monitored=True, is_accessible=True),
    # checkpoints (RFID)
    dict(code="CP-1", type="checkpoint", name="Checkpoint 1 - North promenade", name_te="చెక్‌పాయింట్ 1", name_hi="चेकपॉइंट 1", lat=17.0065, lng=81.7795),
    dict(code="CP-2", type="checkpoint", name="Checkpoint 2 - Central promenade", name_te="చెక్‌పాయింట్ 2", name_hi="चेकपॉइंट 2", lat=17.0005, lng=81.7778),
    dict(code="CP-3", type="checkpoint", name="Checkpoint 3 - South promenade", name_te="చెక్‌పాయింట్ 3", name_hi="चेकपॉइंट 3", lat=16.9960, lng=81.7768),
    # parking
    dict(code="PARK-P1", type="parking", name="P1 Kambala Park (cars)", name_te="P1 కంబాల పార్క్ (కార్లు)", name_hi="P1 कंबाला पार्क (कार)", lat=17.0110, lng=81.7860),
    dict(code="PARK-P2", type="parking", name="P2 Railway Station Road (cars)", name_te="P2 రైల్వే స్టేషన్ రోడ్ (కార్లు)", name_hi="P2 रेलवे स्टेशन रोड (कार)", lat=16.9900, lng=81.7850),
    dict(code="PARK-P3", type="parking", name="P3 Bus & van bay", name_te="P3 బస్సు & వ్యాన్ బే", name_hi="P3 बस व वैन बे", lat=17.0050, lng=81.7900),
    dict(code="PARK-P4", type="parking", name="P4 Two-wheeler park", name_te="P4 ద్విచక్ర వాహనాల పార్కింగ్", name_hi="P4 दोपहिया पार्किंग", lat=16.9985, lng=81.7830),
    # help, medical, police, lost & found
    dict(code="HELP-1", type="help_desk", name="Help Desk 1 (Gate A)", name_te="సహాయ కేంద్రం 1 (గేట్ A)", name_hi="सहायता केंद्र 1 (गेट A)", lat=17.0076, lng=81.7812, details={"phone": "+91-883-2400001", "hours": "24x7"}),
    dict(code="HELP-2", type="help_desk", name="Help Desk 2 (Pushkar Ghat)", name_te="సహాయ కేంద్రం 2 (పుష్కర ఘాట్)", name_hi="सहायता केंद्र 2 (पुष्कर घाट)", lat=17.0012, lng=81.7772, is_accessible=True, details={"phone": "+91-883-2400002", "hours": "24x7"}),
    dict(code="HELP-3", type="help_desk", name="Help Desk 3 (Gate C)", name_te="సహాయ కేంద్రం 3 (గేట్ C)", name_hi="सहायता केंद्र 3 (गेट C)", lat=16.9948, lng=81.7782, details={"phone": "+91-883-2400003", "hours": "24x7"}),
    dict(code="LF-1", type="lost_found", name="Lost & Found / Reunification Centre", name_te="తప్పిపోయిన వారి కేంద్రం", name_hi="खोया-पाया / पुनर्मिलन केंद्र", lat=17.0030, lng=81.7790, is_accessible=True, details={"phone": "+91-883-2400010", "hours": "24x7"}),
    dict(code="MED-1", type="medical", name="Medical Camp 1 (North)", name_te="వైద్య శిబిరం 1", name_hi="चिकित्सा शिविर 1", lat=17.0088, lng=81.7805, is_accessible=True, details={"phone": "108", "services": ["first aid", "ambulance", "oxygen"]}),
    dict(code="MED-2", type="medical", name="Field Hospital (Central)", name_te="ఫీల్డ్ హాస్పిటల్", name_hi="फील्ड अस्पताल", lat=17.0025, lng=81.7812, is_accessible=True, details={"phone": "108", "services": ["emergency", "beds", "ambulance"]}),
    dict(code="MED-3", type="medical", name="First Aid Post (South)", name_te="ప్రథమ చికిత్స కేంద్రం", name_hi="प्राथमिक चिकित्सा", lat=16.9955, lng=81.7760, details={"services": ["first aid"]}),
    dict(code="POL-1", type="police", name="Police Assistance Point (Gate B)", name_te="పోలీస్ సహాయ కేంద్రం", name_hi="पुलिस सहायता केंद्र", lat=17.0022, lng=81.7806, details={"phone": "100"}),
    dict(code="POL-2", type="police", name="Police Outpost (South)", name_te="పోలీస్ అవుట్‌పోస్ట్", name_hi="पुलिस चौकी", lat=16.9945, lng=81.7795, details={"phone": "100"}),
    # amenities
    dict(code="WC-1", type="restroom", name="Toilets block 1", name_te="మరుగుదొడ్లు 1", name_hi="शौचालय 1", lat=17.0090, lng=81.7800, is_accessible=True),
    dict(code="WC-2", type="restroom", name="Toilets block 2", name_te="మరుగుదొడ్లు 2", name_hi="शौचालय 2", lat=17.0040, lng=81.7785),
    dict(code="WC-3", type="restroom", name="Toilets block 3", name_te="మరుగుదొడ్లు 3", name_hi="शौचालय 3", lat=17.0000, lng=81.7785, is_accessible=True),
    dict(code="WC-4", type="restroom", name="Toilets block 4", name_te="మరుగుదొడ్లు 4", name_hi="शौचालय 4", lat=16.9965, lng=81.7775),
    dict(code="WC-5", type="restroom", name="Toilets block 5 (accessible)", name_te="మరుగుదొడ్లు 5", name_hi="शौचालय 5", lat=16.9938, lng=81.7755, is_accessible=True),
    dict(code="WATER-1", type="water", name="Drinking water 1", name_te="తాగునీరు 1", name_hi="पेयजल 1", lat=17.0085, lng=81.7795),
    dict(code="WATER-2", type="water", name="Drinking water 2", name_te="తాగునీరు 2", name_hi="पेयजल 2", lat=17.0045, lng=81.7780),
    dict(code="WATER-3", type="water", name="Drinking water 3", name_te="తాగునీరు 3", name_hi="पेयजल 3", lat=17.0008, lng=81.7780),
    dict(code="WATER-4", type="water", name="Drinking water 4", name_te="తాగునీరు 4", name_hi="पेयजल 4", lat=16.9970, lng=81.7770),
    dict(code="WATER-5", type="water", name="Drinking water 5", name_te="తాగునీరు 5", name_hi="पेयजल 5", lat=16.9940, lng=81.7752),
    dict(code="DRESS-1", type="dressing_room", name="Changing rooms (Gowthami)", name_te="దుస్తులు మార్చుకునే గదులు", name_hi="वस्त्र बदलने का कक्ष", lat=17.0092, lng=81.7793),
    dict(code="DRESS-2", type="dressing_room", name="Changing rooms (Kotilingala)", name_te="దుస్తులు మార్చుకునే గదులు", name_hi="वस्त्र बदलने का कक्ष", lat=17.0055, lng=81.7779),
    dict(code="DRESS-3", type="dressing_room", name="Changing rooms (Pushkar)", name_te="దుస్తులు మార్చుకునే గదులు", name_hi="वस्त्र बदलने का कक्ष", lat=17.0015, lng=81.7769, is_accessible=True),
    dict(code="DRESS-4", type="dressing_room", name="Changing rooms (Saraswathi)", name_te="దుస్తులు మార్చుకునే గదులు", name_hi="वस्त्र बदलने का कक्ष", lat=16.9978, lng=81.7758),
    dict(code="DRESS-5", type="dressing_room", name="Changing rooms (Padmavathi)", name_te="దుస్తులు మార్చుకునే గదులు", name_hi="वस्त्र बदलने का कक्ष", lat=16.9932, lng=81.7750, is_accessible=True),
    dict(code="FOOD-1", type="food", name="Annadanam hall (North)", name_te="అన్నదానం హాల్", name_hi="अन्नदान हॉल", lat=17.0098, lng=81.7812, details={"hours": "06:00-22:00", "free": True}),
    dict(code="FOOD-2", type="food", name="Food court (Central)", name_te="ఫుడ్ కోర్ట్", name_hi="फूड कोर्ट", lat=17.0030, lng=81.7815),
    dict(code="FOOD-3", type="food", name="Food stalls (South)", name_te="ఆహార దుకాణాలు", name_hi="खाद्य स्टॉल", lat=16.9952, lng=81.7800),
    dict(code="REST-1", type="rest_area", name="Rest shelter (Central)", name_te="విశ్రాంతి కేంద్రం", name_hi="विश्राम स्थल", lat=17.0035, lng=81.7800, is_accessible=True),
    dict(code="REST-2", type="rest_area", name="Senior citizens' rest area", name_te="వృద్ధుల విశ్రాంతి కేంద్రం", name_hi="वरिष्ठ नागरिक विश्राम", lat=16.9942, lng=81.7770, is_accessible=True),
    dict(code="BUS-1", type="bus_stop", name="Shuttle stop - Gate A", name_te="షటిల్ స్టాప్ - గేట్ A", name_hi="शटल स्टॉप - गेट A", lat=17.0085, lng=81.7830),
    dict(code="BUS-2", type="bus_stop", name="Shuttle stop - Gate C", name_te="షటిల్ స్టాప్ - గేట్ C", name_hi="शटल स्टॉप - गेट C", lat=16.9948, lng=81.7800),
]

PARKING = [
    dict(code="PARK-P1", total=1500, occupied=620, types=["car", "van"], gate="GATE-A", shuttle="Free e-shuttle to Gate A every 5 min"),
    dict(code="PARK-P2", total=900, occupied=850, types=["car"], gate="GATE-C", shuttle="Walk 600 m to Gate C"),
    dict(code="PARK-P3", total=300, occupied=120, types=["bus", "van"], gate="GATE-A", shuttle="E-shuttle to Gate A and Gate B"),
    dict(code="PARK-P4", total=2500, occupied=900, types=["bike"], gate="GATE-B", shuttle="Walk 350 m to Gate B"),
]

# Walkway graph: (label, lat, lng, location_code or None)
NODES = [
    ("P1", 17.0110, 81.7860, "PARK-P1"), ("P2", 16.9900, 81.7850, "PARK-P2"), ("P3", 17.0050, 81.7900, "PARK-P3"), ("P4", 16.9985, 81.7830, "PARK-P4"),
    ("Gate A", 17.0080, 81.7820, "GATE-A"), ("Gate B", 17.0020, 81.7800, "GATE-B"), ("Gate C", 16.9950, 81.7790, "GATE-C"), ("Gate D", 16.9940, 81.7762, "GATE-D"),
    ("CP-1", 17.0065, 81.7795, "CP-1"), ("CP-2", 17.0005, 81.7778, "CP-2"), ("CP-3", 16.9960, 81.7768, "CP-3"),
    ("Promenade N", 17.0095, 81.7795, None), ("Promenade N2", 17.0070, 81.7785, None), ("Promenade C1", 17.0050, 81.7780, None),
    ("Promenade C2", 17.0030, 81.7775, None), ("Promenade C3", 17.0010, 81.7770, None), ("Promenade S1", 16.9985, 81.7762, None), ("Promenade S2", 16.9960, 81.7755, None), ("Promenade S3", 16.9938, 81.7752, None),
    ("Gowthami", 17.0095, 81.7788, "GHAT-GOWTHAMI"), ("Kotilingala", 17.0052, 81.7772, "GHAT-KOTILINGALA"), ("Pushkar", 17.0018, 81.7762, "GHAT-PUSHKAR"),
    ("Saraswathi", 16.9975, 81.7752, "GHAT-SARASWATHI"), ("Padmavathi", 16.9935, 81.7745, "GHAT-PADMAVATHI"),
    ("Help 2", 17.0012, 81.7772, "HELP-2"), ("Med 2", 17.0025, 81.7812, "MED-2"), ("Lost&Found", 17.0030, 81.7790, "LF-1"), ("Gate B road", 17.0025, 81.7822, None),
]
# (from, to, accessible, zone_code)
EDGES = [
    ("P1", "Gate A", True, None), ("P3", "Gate A", True, None), ("P3", "Gate B road", True, None), ("Gate B road", "Gate B", True, None), ("Gate B road", "Med 2", True, None),
    ("P4", "Gate B", True, None), ("P2", "Gate C", True, None), ("P2", "Gate D", True, None),
    ("Gate A", "CP-1", True, "GATE-A"), ("CP-1", "Promenade N2", True, None), ("Promenade N", "Promenade N2", True, None), ("Promenade N", "Gowthami", False, "GHAT-GOWTHAMI"),
    ("Promenade N2", "Promenade C1", True, None), ("Promenade C1", "Kotilingala", False, "GHAT-KOTILINGALA"), ("Promenade C1", "Promenade C2", True, None),
    ("Promenade C2", "Lost&Found", True, None), ("Gate B", "Lost&Found", True, "GATE-B"), ("Lost&Found", "CP-2", True, None), ("Promenade C2", "CP-2", True, None),
    ("CP-2", "Promenade C3", True, None), ("Promenade C3", "Pushkar", True, "GHAT-PUSHKAR"), ("Promenade C3", "Help 2", True, None),
    ("Promenade C3", "Promenade S1", True, None), ("Promenade S1", "Saraswathi", False, "GHAT-SARASWATHI"), ("Promenade S1", "Promenade S2", True, None),
    ("Gate C", "CP-3", True, "GATE-C"), ("CP-3", "Promenade S2", True, None), ("Promenade S2", "Promenade S3", True, None), ("Gate D", "Promenade S3", True, "GATE-D"),
    ("Promenade S3", "Padmavathi", True, "GHAT-PADMAVATHI"),
]


def seed_demo(db: Session) -> None:
    if db.scalar(select(Site).limit(1)):
        _ensure_admin(db)
        return
    log.info("Seeding DEMO data for Rajamahendravaram pilot site")
    site = Site(
        code="DEMO",
        name="Rajamahendravaram Riverfront (demo)",
        name_te="రాజమహేంద్రవరం నదీతీరం (డెమో)",
        name_hi="राजमहेंद्रवरम नदी तट (डेमो)",
        district="East Godavari",
        center_lat=17.0005,
        center_lng=81.7785,
        emergency_contacts={"control_room": "+91-883-2400000", "lost_found": "+91-883-2400010", "medical": "108", "police": "100", "emergency": "112"},
    )
    db.add(site)
    db.flush()

    by_code: dict[str, Location] = {}
    for spec in LOCATIONS:
        d = dict(spec)
        details = {**DEMO, **d.pop("details", {})}
        loc = Location(site_id=site.id, details=details, verification="demo", source="Demo seed (synthetic)", **d)
        db.add(loc)
        by_code[loc.code] = loc
    db.flush()

    for p in PARKING:
        lot = ParkingLot(location_id=by_code[p["code"]].id, total_slots=p["total"], occupied_slots=p["occupied"], vehicle_types=p["types"], nearest_gate_id=by_code[p["gate"]].id, shuttle_info=p["shuttle"], source="manual", updated_at=datetime.now(timezone.utc))
        if lot.occupied_slots >= lot.total_slots:
            lot.status = "full"
        elif lot.occupied_slots >= 0.8 * lot.total_slots:
            lot.status = "filling"
        db.add(lot)

    node_by_label: dict[str, WalkwayNode] = {}
    for label, lat, lng, code in NODES:
        n = WalkwayNode(site_id=site.id, lat=lat, lng=lng, location_id=by_code[code].id if code else None, label=label)
        db.add(n)
        node_by_label[label] = n
    db.flush()
    for a, b, acc, zone in EDGES:
        na, nb = node_by_label[a], node_by_label[b]
        db.add(WalkwayEdge(from_node=na.id, to_node=nb.id, length_m=round(haversine_m(na.lat, na.lng, nb.lat, nb.lng)), is_accessible=acc, zone_location_id=by_code[zone].id if zone else None))

    # initial crowd readings (demo values)
    now = datetime.now(timezone.utc)
    demo_counts = {"GHAT-GOWTHAMI": 2100, "GHAT-KOTILINGALA": 7600, "GHAT-PUSHKAR": 14200, "GHAT-SARASWATHI": 2400, "GHAT-PADMAVATHI": 1900, "GATE-A": 900, "GATE-B": 3300, "GATE-C": 1100, "GATE-D": 300}
    for code, cnt in demo_counts.items():
        for i in range(6, 0, -1):
            record_reading(db, by_code[code], int(cnt * (0.6 + 0.4 * (6 - i) / 6)), "manual", recorded_at=now - timedelta(minutes=10 * i))
        record_reading(db, by_code[code], cnt, "manual", recorded_at=now)

    # demo devices
    dev_loc = {"rfid-gate-a": "GATE-A", "rfid-gate-b": "GATE-B", "rfid-gate-c": "GATE-C", "rfid-cp-1": "CP-1", "rfid-cp-2": "CP-2", "rfid-helpdesk-1": "HELP-2", "cam-pushkar": "GHAT-PUSHKAR", "cam-kotilingala": "GHAT-KOTILINGALA", "parking-p1": "PARK-P1"}
    for name, key in DEMO_DEVICE_KEYS.items():
        typ = "rfid_reader" if name.startswith("rfid") else "camera" if name.startswith("cam") else "parking_counter"
        db.add(Device(name=name, type=typ, api_key_hash=hash_token(key), location_id=by_code[dev_loc[name]].id))

    # demo wristband tags
    for i in range(1, 51):
        db.add(RfidTag(uid=f"GP27-{i:05d}"))

    db.add(Alert(title="Welcome to Godavari Pushkaralu 2027", body="Peak bathing hours are 05:00-09:00. Gate D and Padmavathi Ghat are reserved for senior citizens and differently-abled pilgrims.", title_te="గోదావరి పుష్కరాలు 2027కు స్వాగతం", body_te="ఉదయం 5-9 గంటల మధ్య రద్దీ ఎక్కువ. గేట్ D మరియు పద్మావతి ఘాట్ వృద్ధులు, దివ్యాంగుల కోసం.", title_hi="गोदावरी पुष्करालु 2027 में स्वागत है", body_hi="सुबह 5-9 बजे सबसे अधिक भीड़। गेट D और पद्मावती घाट वरिष्ठ नागरिकों व दिव्यांगों के लिए आरक्षित।", severity="info", site_id=site.id, expires_at=now + timedelta(days=30)))

    _ensure_admin(db)
    # demo field staff
    if not db.scalar(select(User).where(User.username == "helpdesk2")):
        db.add(User(username="helpdesk2", password_hash=hash_password("helpdesk12345"), name="Help Desk 2 volunteer", role="volunteer", site_id=site.id, help_desk_location_id=by_code["HELP-2"].id))
    if not db.scalar(select(User).where(User.username == "staff1")):
        db.add(User(username="staff1", password_hash=hash_password("staff12345"), name="Control room staff", role="staff", site_id=site.id))
    db.commit()
    log.info("Seed complete: %d locations", len(LOCATIONS))


def _ensure_admin(db: Session) -> None:
    if not db.scalar(select(User).where(User.username == settings.bootstrap_admin_username)):
        db.add(User(username=settings.bootstrap_admin_username, password_hash=hash_password(settings.bootstrap_admin_password), name="Administrator", role="admin"))
        db.commit()
