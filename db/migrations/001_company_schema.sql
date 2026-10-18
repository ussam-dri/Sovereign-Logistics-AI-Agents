-- Applied to atlas_logistics, maghreb_freight, sahara_transport

CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    external_ref VARCHAR(32) NOT NULL UNIQUE,
    full_name VARCHAR(200) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    address TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trucks (
    id SERIAL PRIMARY KEY,
    plate_code VARCHAR(32) NOT NULL UNIQUE,
    capacity_kg NUMERIC(10,2) NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('available', 'occupied', 'maintenance')),
    current_location VARCHAR(128) NOT NULL,
    internal_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drivers (
    id SERIAL PRIMARY KEY,
    employee_code VARCHAR(32) NOT NULL UNIQUE,
    full_name VARCHAR(200) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    qualifications JSONB DEFAULT '[]',
    schedule JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipments (
    id SERIAL PRIMARY KEY,
    external_ref VARCHAR(32) NOT NULL UNIQUE,
    origin VARCHAR(128) NOT NULL,
    destination VARCHAR(128) NOT NULL,
    weight_kg NUMERIC(10,2) NOT NULL,
    deadline TIMESTAMPTZ NOT NULL,
    status VARCHAR(32) NOT NULL,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    assigned_truck_id INTEGER REFERENCES trucks(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_slots (
    id SERIAL PRIMARY KEY,
    route_name VARCHAR(128) NOT NULL,
    destination_city VARCHAR(128) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    max_weight_kg NUMERIC(10,2) NOT NULL,
    trucks_available INTEGER NOT NULL DEFAULT 0,
    truck_ids INTEGER[] DEFAULT '{}',
    cost_estimate NUMERIC(10,2) NOT NULL,
    eta_hours NUMERIC(8,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partners (
    id SERIAL PRIMARY KEY,
    partner_org_id VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(128) NOT NULL,
    trust_level VARCHAR(32) NOT NULL,
    allowed_interactions TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipments_ref ON shipments(external_ref);
CREATE INDEX IF NOT EXISTS idx_shipments_dest ON shipments(destination);
CREATE INDEX IF NOT EXISTS idx_slots_dest ON delivery_slots(destination_city);
CREATE INDEX IF NOT EXISTS idx_trucks_status ON trucks(status);
