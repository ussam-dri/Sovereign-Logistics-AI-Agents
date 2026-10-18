#!/usr/bin/env python3
"""Generate fictional logistics data for demo databases."""

from __future__ import annotations

import json
import os
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
import yaml
from faker import Faker

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS = Path(__file__).parent / "scenarios.yaml"

COMPANY_DBS = ["atlas_logistics", "maghreb_freight", "sahara_transport"]
CITIES = ["Casablanca", "Rabat", "Marrakech", "Tanger", "Fes", "Agadir"]
STATUSES = ["pending", "in_transit", "delivered", "delayed", "cancelled"]


def conn_url(db: str) -> str:
    user = os.environ.get("POSTGRES_USER", "demo")
    password = os.environ.get("POSTGRES_PASSWORD", "demo_secret_change_me")
    host = os.environ.get("POSTGRES_HOST", "localhost")
    port = os.environ.get("POSTGRES_PORT", "5432")
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


def load_config() -> dict:
    with open(SCENARIOS, encoding="utf-8") as f:
        return yaml.safe_load(f)


def clear_company_tables(cur: psycopg.Cursor) -> None:
    cur.execute(
        """
        TRUNCATE delivery_slots, shipments, partners, drivers, trucks, customers
        RESTART IDENTITY CASCADE
        """
    )


def insert_partners(cur: psycopg.Cursor, org: str) -> None:
    partners = [
        ("maghreb_freight", "Maghreb Freight (Fictional)", "trusted", ["assist_query"]),
        ("sahara_transport", "Sahara Transport (Fictional)", "trusted", ["assist_query"]),
        ("atlas_logistics", "Atlas Logistics (Fictional)", "trusted", ["assist_query"]),
    ]
    for pid, name, trust, interactions in partners:
        if pid == org:
            continue
        cur.execute(
            """
            INSERT INTO partners (partner_org_id, display_name, trust_level, allowed_interactions)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (partner_org_id) DO NOTHING
            """,
            (pid, name, trust, interactions),
        )


def bulk_company(org: str, cfg: dict, fake: Faker, rng: random.Random) -> None:
    org_cfg = cfg["orgs"][org]
    n_ship = org_cfg["shipments"]
    n_trucks = org_cfg["trucks"]
    n_drivers = org_cfg["drivers"]
    now = datetime.now(timezone.utc)
    demo_deadline = now + timedelta(hours=48)

    with psycopg.connect(conn_url(org)) as conn:
        with conn.cursor() as cur:
            clear_company_tables(cur)
            insert_partners(cur, org)

            customers = []
            for i in range(max(n_ship // 3, 50)):
                customers.append(
                    (
                        f"CUST-{org[:3].upper()}-{i:04d}",
                        fake.name(),
                        fake.phone_number(),
                        fake.address(),
                    )
                )
            cur.executemany(
                "INSERT INTO customers (external_ref, full_name, phone, address) VALUES (%s,%s,%s,%s)",
                customers,
            )
            cur.execute("SELECT id FROM customers")
            customer_ids = [r[0] for r in cur.fetchall()]

            trucks = []
            for i in range(n_trucks):
                status = rng.choice(["available", "occupied", "maintenance"])
                trucks.append(
                    (
                        f"TRK-{org[:3].upper()}-{i:04d}",
                        float(rng.randint(800, 3000)),
                        status,
                        rng.choice(CITIES),
                        "Fictional internal note",
                    )
                )
            cur.executemany(
                """
                INSERT INTO trucks (plate_code, capacity_kg, status, current_location, internal_notes)
                VALUES (%s,%s,%s,%s,%s)
                """,
                trucks,
            )
            cur.execute("SELECT id, capacity_kg, status FROM trucks ORDER BY id")
            truck_rows = cur.fetchall()

            drivers = []
            for i in range(n_drivers):
                drivers.append(
                    (
                        f"DRV-{org[:3].upper()}-{i:04d}",
                        fake.name(),
                        fake.phone_number(),
                        json.dumps(["hazmat", "long_haul"]),
                        json.dumps({"mon": "route_a", "tue": "route_b"}),
                    )
                )
            cur.executemany(
                """
                INSERT INTO drivers (employee_code, full_name, phone, qualifications, schedule)
                VALUES (%s,%s,%s,%s::jsonb,%s::jsonb)
                """,
                drivers,
            )

            shipments = []
            for i in range(n_ship):
                ref = f"SHP-{1000 + i}"
                shipments.append(
                    (
                        ref,
                        rng.choice(CITIES),
                        rng.choice(CITIES),
                        float(rng.randint(200, 2500)),
                        now + timedelta(hours=rng.randint(-72, 168)),
                        rng.choice(STATUSES),
                        rng.choice(customer_ids),
                        rng.choice(truck_rows)[0] if rng.random() > 0.3 else None,
                    )
                )
            cur.executemany(
                """
                INSERT INTO shipments
                (external_ref, origin, destination, weight_kg, deadline, status, customer_id, assigned_truck_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                shipments,
            )

            slots = []
            for i in range(80):
                dest = rng.choice(CITIES)
                ws = now + timedelta(hours=rng.randint(6, 120))
                we = ws + timedelta(hours=rng.randint(4, 24))
                suitable = [t for t in truck_rows if t[1] >= 1000 and t[2] == "available"]
                ta = min(len(suitable), rng.randint(0, 5))
                tids = [t[0] for t in suitable[:ta]]
                slots.append(
                    (
                        f"Route-{i}",
                        dest,
                        ws,
                        we,
                        2500.0,
                        ta,
                        tids,
                        float(rng.randint(800, 5000)),
                        float(rng.randint(12, 72)),
                    )
                )
            cur.executemany(
                """
                INSERT INTO delivery_slots
                (route_name, destination_city, window_start, window_end, max_weight_kg,
                 trucks_available, truck_ids, cost_estimate, eta_hours)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                slots,
            )

            apply_scenario_anchors(cur, org, cfg, demo_deadline, truck_rows, now)
            conn.commit()


def apply_scenario_anchors(
    cur: psycopg.Cursor,
    org: str,
    cfg: dict,
    demo_deadline: datetime,
    truck_rows: list,
    now: datetime,
) -> None:
    ref = cfg["demo_shipment_ref"]
    dest = cfg["demo_destination"]
    weight = cfg["demo_weight_kg"]

    cur.execute("SELECT id FROM customers ORDER BY id LIMIT 1")
    cust_id = cur.fetchone()[0]

    if org == "atlas_logistics":
        demo_count = cfg["orgs"]["atlas_logistics"]["demo_trucks_total"]
        cur.execute("SELECT id FROM trucks ORDER BY id LIMIT %s", (demo_count,))
        demo_truck_ids = [r[0] for r in cur.fetchall()]
        for tid in demo_truck_ids:
            cur.execute("UPDATE trucks SET status = 'occupied' WHERE id = %s", (tid,))
        cur.execute(
            """
            INSERT INTO shipments
            (external_ref, origin, destination, weight_kg, deadline, status, customer_id, assigned_truck_id)
            VALUES (%s, %s, %s, %s, %s, 'pending', %s, NULL)
            ON CONFLICT (external_ref) DO UPDATE SET
              origin = EXCLUDED.origin,
              destination = EXCLUDED.destination,
              weight_kg = EXCLUDED.weight_kg,
              deadline = EXCLUDED.deadline,
              status = EXCLUDED.status,
              customer_id = EXCLUDED.customer_id
            """,
            (ref, "Rabat", dest, weight, demo_deadline, cust_id),
        )

    if org == "maghreb_freight":
        eta = cfg["orgs"]["maghreb_freight"]["demo_eta_hours"]
        n = cfg["orgs"]["maghreb_freight"]["suitable_trucks_for_demo"]
        cur.execute(
            """
            SELECT id FROM trucks WHERE capacity_kg >= %s ORDER BY id LIMIT %s
            """,
            (weight, n),
        )
        ids = [r[0] for r in cur.fetchall()]
        for tid in ids:
            cur.execute("UPDATE trucks SET status = 'available' WHERE id = %s", (tid,))
        ws = now + timedelta(hours=6)
        we = demo_deadline
        cur.execute(
            """
            INSERT INTO delivery_slots
            (route_name, destination_city, window_start, window_end, max_weight_kg,
             trucks_available, truck_ids, cost_estimate, eta_hours)
            VALUES ('Demo-Casa-Urgent', %s, %s, %s, %s, %s, %s, 3200, %s)
            """,
            (dest, ws, we, 3000.0, len(ids), ids, eta),
        )

    if org == "sahara_transport":
        eta = cfg["orgs"]["sahara_transport"]["demo_eta_hours"]
        cur.execute(
            "SELECT id FROM trucks WHERE capacity_kg >= %s ORDER BY id LIMIT 1",
            (weight,),
        )
        row = cur.fetchone()
        if row:
            tid = row[0]
            cur.execute("UPDATE trucks SET status = 'available' WHERE id = %s", (tid,))
            ws = now + timedelta(hours=12)
            we = demo_deadline + timedelta(hours=24)
            cur.execute(
                """
                INSERT INTO delivery_slots
                (route_name, destination_city, window_start, window_end, max_weight_kg,
                 trucks_available, truck_ids, cost_estimate, eta_hours)
                VALUES ('Demo-Casa-Late', %s, %s, %s, %s, 1, ARRAY[%s]::integer[], 2800, %s)
                """,
                (dest, ws, we, 3000.0, tid, eta),
            )


def main() -> None:
    cfg = load_config()
    fake = Faker("en_US")
    rng = random.Random(cfg.get("seed", 42))
    Faker.seed(cfg.get("seed", 42))

    for org in COMPANY_DBS:
        print(f"Seeding {org}...")
        bulk_company(org, cfg, fake, rng)

    print("Done. Fictional data loaded.")


if __name__ == "__main__":
    main()
