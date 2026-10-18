# Sovereign AI Agents Mockup (Fictional Data)

**All company names and records in this repository are explicitly fictional.**  
Atlas Logistics, Maghreb Freight, and Sahara Transport are demo entities only. Data is synthetically generated for demonstration—not collected from real companies.

## Architecture

Multi-organization logistics demo with:

- **Org agents** (FastAPI): per-company capacity and slot queries
- **Guard** (FastAPI): policy-driven outbound payload filtering and audit logging
- **Coordinator** (FastAPI): discovery, guarded partner calls, proposal ranking
- **PostgreSQL**: four databases (`atlas_logistics`, `maghreb_freight`, `sahara_transport`, `sovereignty_audit`)
- **Next.js dashboard**: run the SHP-1042 scenario and inspect audit trails

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up --build -d
# Wait for postgres seed (~1–2 min on first run)
docker compose run --rm db-seed
./scripts/run_demo.ps1   # Windows
# or: bash scripts/run_demo.sh
```

Open **http://localhost:3000** and click **Run SHP-1042 — Urgent Casablanca**.

## Demo scenario (SHP-1042)

| Field | Value |
|-------|--------|
| Shipment | SHP-1042 |
| Destination | Casablanca |
| Weight | 1,200 kg |
| Atlas fleet | 12/12 trucks occupied |
| Maghreb Freight | 2 suitable trucks |
| Sahara Transport | 1 suitable truck, later delivery |

Expected behavior: Atlas requests help **without** customer identity; Guard rejects prohibited fields; partners query local DBs; coordinator ranks Maghreb above Sahara on deadline; audit records policy decisions.

## Local development (without Docker)

1. Start PostgreSQL and run `db/init/01-create-databases.sql`, `db/migrations/001_company_schema.sql`, `db/migrations/002_audit_schema.sql`, then `python db/seeds/generate_synthetic.py`.
2. Install shared package and run each service (see `services/*/README` in repo—use uv/pip with `-e packages/shared`).

## AWS (optional)

See [infra/aws/README.md](infra/aws/README.md) for CDK deploy of ECR + ECS Fargate + ALB (+ optional RDS).

## License

MIT — demo / research use only.
