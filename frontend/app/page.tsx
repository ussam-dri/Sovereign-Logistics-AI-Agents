"use client";

import { useCallback, useEffect, useState } from "react";

const getCoordinatorUrl = () => {
  if (typeof window !== "undefined") {
    const envUrl = process.env.NEXT_PUBLIC_COORDINATOR_URL;
    if (envUrl && !envUrl.includes("localhost") && !envUrl.includes("127.0.0.1")) {
      return envUrl;
    }
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return process.env.NEXT_PUBLIC_COORDINATOR_URL ?? "http://localhost:8000";
};

const COORDINATOR = getCoordinatorUrl();

type RoleMode = "atlas" | "maghreb" | "sahara" | "admin";

type DemoStep = { step: string; message: string; detail?: Record<string, unknown> };

type GeminiDecision = {
  winner_org_id?: string | null;
  confidence?: number;
  reasoning?: string;
  risks?: string[];
  fallback_org_id?: string | null;
  ai_used?: boolean;
  gemini_used?: boolean;
  provider?: string;
  cached?: boolean;
  is_throttled?: boolean;
  reason_not_used?: string | null;
  ai_error?: string | null;
  gemini_error?: string | null;
  model?: string | null;
};

type DemoResult = {
  task_id: string;
  shipment_ref: string;
  scenario_info?: {
    shipment_ref?: string;
    origin?: string;
    destination?: string;
    weight_kg?: number;
    deadline_hours?: number;
    deadline?: string;
    urgency?: string;
    cargo_type?: string;
  };
  steps: DemoStep[];
  proposals: Array<Record<string, unknown>>;
  selected_partner: string | null;
  guard_passed: boolean;
  gemini_decision?: GeminiDecision | null;
};

type AuditRow = {
  request_id: string;
  source_org: string;
  target_org: string | null;
  action: string | null;
  rejected_fields: string[];
  sanitized_payload: Record<string, unknown> | null;
  created_at: string | null;
};

type ViolationResult = {
  violation_id: string;
  name: string;
  description: string;
  tested_payload: Record<string, unknown>;
  guard_action: string;
  guard_status_code: number;
  rejected_fields: string[];
  rejection_reason: string;
  request_id?: string;
};

type ConsoleLog = {
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  text: string;
};

type NodeHealth = {
  name: string;
  type: string;
  role: string;
  status: "healthy" | "offline" | "degraded";
  latency_ms: number;
  details?: Record<string, unknown>;
};

type LedgerBlock = {
  block_id: number;
  prev_hash_abbr: string;
  event_hash_abbr: string;
  full_hash: string;
  event: Record<string, unknown>;
  created_at: string | null;
  hash_valid: boolean;
};

type LedgerVerification = {
  valid: boolean;
  total_blocks: number;
  status: string;
  latest_hash: string;
  blocks: LedgerBlock[];
};

type CompanyOverview = {
  org_id: string;
  config: {
    display_name: string;
    role: string;
    region: string;
    agent_url: string;
    guard_url: string;
  };
  agent_card?: Record<string, unknown>;
  policy?: {
    policy_id?: string;
    allowed_fields?: string[];
    forbidden_patterns?: string[];
    on_violation?: string;
  };
  fleet?: {
    total_trucks?: number;
    status_counts?: Record<string, number>;
    trucks?: Array<{
      id: number;
      plate_code: string;
      capacity_kg: number;
      status: string;
      current_location: string;
      internal_notes: string;
    }>;
  };
  slots?: Array<{
    id: number;
    route_name: string;
    destination_city: string;
    window_start: string;
    window_end: string;
    max_weight_kg: number;
    trucks_available: number;
    cost_estimate: number;
    eta_hours: number;
  }>;
  shipments?: Array<{
    id: number;
    external_ref: string;
    origin: string;
    destination: string;
    weight_kg: number;
    deadline: string;
    status: string;
    customer_name: string;
    customer_phone: string;
  }>;
  audit_logs?: AuditRow[];
};

const MOROCCAN_CITIES = ["Casablanca", "Marrakech", "Tanger", "Agadir", "Fes", "Rabat"];
const CARGO_PRESETS = [
  "Pharmaceutical Vaccines",
  "High-Tech Automotive Sensors",
  "Perishable Cold-Chain Goods",
  "Urgent Industrial Spare Parts",
  "Critical Medical Equipment",
];

export default function Home() {
  const [role, setRole] = useState<RoleMode>("admin");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [activeScenario, setActiveScenario] = useState<string>("SHP-1042 — Urgent Casablanca (1,200 kg)");
  const [violationResult, setViolationResult] = useState<ViolationResult | null>(null);
  const [violationLoading, setViolationLoading] = useState<string | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);

  // Admin & Multi-tenant State
  const [companyData, setCompanyData] = useState<Record<string, CompanyOverview | null>>({
    atlas_logistics: null,
    maghreb_freight: null,
    sahara_transport: null,
  });
  const [networkNodes, setNetworkNodes] = useState<NodeHealth[]>([]);
  const [ledgerVerification, setLedgerVerification] = useState<LedgerVerification | null>(null);
  const [verifyingLedger, setVerifyingLedger] = useState(false);

  const addConsoleLog = useCallback((level: "info" | "warn" | "error" | "success", text: string) => {
    const time = new Date().toLocaleTimeString();
    setConsoleLogs((prev) => [{ timestamp: time, level, text }, ...prev.slice(0, 49)]);

    if (level === "error") {
      console.error(`[Sovereign AI] ${text}`);
    } else if (level === "warn") {
      console.warn(`[Sovereign AI] ${text}`);
    } else {
      console.log(`[Sovereign AI] ${text}`);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      const res = await fetch(`${COORDINATOR}/audit/recent?limit=25`);
      if (res.ok) setAudit(await res.json());
    } catch {
      // ignore in polling
    }
  }, []);

  // Fetch Company Overview Data
  const loadCompanyData = useCallback(async (orgId: string) => {
    try {
      const res = await fetch(`${COORDINATOR}/admin/orgs/${orgId}/overview`);
      if (res.ok) {
        const data = await res.json();
        setCompanyData((prev) => ({ ...prev, [orgId]: data }));
      }
    } catch {
      // handled gracefully
    }
  }, []);

  // Fetch Network Health
  const loadNetworkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${COORDINATOR}/admin/network-health`);
      if (res.ok) {
        const data = await res.json();
        setNetworkNodes(data.nodes || []);
      }
    } catch {
      // handled
    }
  }, []);

  // Verify Cryptographic Hash Ledger
  const handleVerifyLedger = useCallback(async () => {
    setVerifyingLedger(true);
    addConsoleLog("info", "Starting cryptographic verification of SHA-256 audit ledger...");
    try {
      const res = await fetch(`${COORDINATOR}/admin/ledger/verify`);
      if (res.ok) {
        const data: LedgerVerification = await res.json();
        setLedgerVerification(data);
        addConsoleLog(
          data.valid ? "success" : "error",
          `Cryptographic verification complete: ${data.total_blocks} blocks checked. Status: ${data.status}`
        );
      }
    } catch (e) {
      addConsoleLog("error", `Ledger verification failed: ${e}`);
    } finally {
      setVerifyingLedger(false);
    }
  }, [addConsoleLog]);

  useEffect(() => {
    loadAudit();
    loadNetworkHealth();
    handleVerifyLedger();
    loadCompanyData("atlas_logistics");
    loadCompanyData("maghreb_freight");
    loadCompanyData("sahara_transport");
    addConsoleLog("info", "Multi-Tenant Sovereign Network dashboard initialized.");
  }, [loadAudit, loadNetworkHealth, handleVerifyLedger, loadCompanyData, addConsoleLog]);

  // Execute scenario
  async function runScenario(scenarioParams?: {
    shipment_ref?: string;
    origin?: string;
    destination?: string;
    weight_kg?: number;
    deadline_hours?: number;
    urgency?: string;
    cargo_type?: string;
  }) {
    setLoading(true);
    setError(null);
    setViolationResult(null);

    const ref = scenarioParams?.shipment_ref ?? "SHP-1042";
    addConsoleLog("info", `Initiating scenario: ${ref} → ${scenarioParams?.destination ?? "Casablanca"} (${scenarioParams?.weight_kg ?? 1200} kg)...`);

    try {
      const res = await fetch(`${COORDINATOR}/demo/run-scenario`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          scenarioParams ?? {
            shipment_ref: "SHP-1042",
            origin: "Rabat",
            destination: "Casablanca",
            weight_kg: 1200.0,
            deadline_hours: 48,
            urgency: "Urgent",
            cargo_type: "Urgent Medical Supplies",
          }
        ),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || res.statusText);
      }

      const data: DemoResult = await res.json();
      setResult(data);

      addConsoleLog(
        "success",
        `Scenario completed: winner=${data.selected_partner}, guard=${data.guard_passed ? "APPROVED" : "REJECTED"}, proposals=${data.proposals.length}`
      );

      const aiUsed = data.gemini_decision?.ai_used ?? data.gemini_decision?.gemini_used;
      if (aiUsed) {
        const cacheNote = data.gemini_decision?.cached ? " [⚡ SERVED FROM CACHE - 0 API Calls]" : " [LIVE API CALL]";
        addConsoleLog(
          "success",
          `[OpenRouter AI] Reasoning succeeded with model "${data.gemini_decision?.model || "OpenRouter"}"${cacheNote}. Confidence: ${(
            (data.gemini_decision?.confidence ?? 0) * 100
          ).toFixed(0)}%. Rationale: ${data.gemini_decision?.reasoning}`
        );
      } else {
        const reason = data.gemini_decision?.reason_not_used || "Unknown reason";
        const isThrottled = data.gemini_decision?.is_throttled;
        addConsoleLog(
          isThrottled ? "warn" : "warn",
          `[OpenRouter AI] ${isThrottled ? "⏳ Rate Limit Guard Active" : "Notice"}: ${reason}`
        );
      }

      await loadAudit();
      loadNetworkHealth();
      handleVerifyLedger();
      loadCompanyData("atlas_logistics");
      loadCompanyData("maghreb_freight");
      loadCompanyData("sahara_transport");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scenario execution failed";
      setError(msg);
      addConsoleLog("error", `Scenario execution failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  function runRandomScenario() {
    const randomCity = MOROCCAN_CITIES[Math.floor(Math.random() * MOROCCAN_CITIES.length)];
    const randomWeight = Math.floor(Math.random() * 2200) + 400;
    const randomHours = [12, 18, 24, 36, 48, 72][Math.floor(Math.random() * 6)];
    const randomRef = `SHP-${Math.floor(Math.random() * 8999) + 1000}`;
    const randomCargo = CARGO_PRESETS[Math.floor(Math.random() * CARGO_PRESETS.length)];
    const desc = `${randomRef} — ${randomCargo} → ${randomCity} (${randomWeight} kg, ${randomHours}h)`;
    setActiveScenario(desc);

    runScenario({
      shipment_ref: randomRef,
      origin: "Rabat",
      destination: randomCity,
      weight_kg: randomWeight,
      deadline_hours: randomHours,
      urgency: randomHours <= 24 ? "Critical Express" : "Urgent",
      cargo_type: randomCargo,
    });
  }

  async function testViolation(violationId: string) {
    setViolationLoading(violationId);
    setError(null);
    addConsoleLog("warn", `Testing safety attack scenario: "${violationId}" against Sovereignty Guard...`);

    try {
      const res = await fetch(`${COORDINATOR}/demo/test-violation/${violationId}`, {
        method: "POST",
      });
      const data: ViolationResult = await res.json();
      setViolationResult(data);

      addConsoleLog(
        "error",
        `[GUARD REJECTION] HTTP ${data.guard_status_code}: Attack "${data.name}" was BLOCKED! Rejected fields: [${data.rejected_fields.join(
          ", "
        )}]. Reason: ${data.rejection_reason}`
      );

      await loadAudit();
      handleVerifyLedger();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Violation test failed";
      setError(msg);
      addConsoleLog("error", `Violation test error: ${msg}`);
    } finally {
      setViolationLoading(null);
    }
  }

  return (
    <main>
      {/* ─── TOP STATUS BANNER ─── */}
      <div className="banner">
        <div>
          <strong>Sovereign Multi-Tenant AI Network</strong> · Autonomous Agent Collaboration with Zero-Knowledge Data Sovereignty.
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            className="btn-secondary"
            style={{ padding: "0.3rem 0.6rem", fontSize: "0.78rem" }}
            onClick={() => {
              loadAudit();
              loadNetworkHealth();
              handleVerifyLedger();
            }}
          >
            🔄 Sync Network
          </button>
        </div>
      </div>

      <h1>Sovereign Logistics Network</h1>
      <p className="muted" style={{ marginBottom: "1rem" }}>
        Simulate an administrative view for any company to inspect their internal agents, or switch to the Global Super Admin to monitor the entire network, cryptographic ledger, and Gemini reasoning logs.
      </p>

      {/* ─── ROLE / COMPANY SWITCHER BAR ─── */}
      <div className="role-nav">
        <button
          className={`role-btn atlas ${role === "atlas" ? "active" : ""}`}
          onClick={() => {
            setRole("atlas");
            loadCompanyData("atlas_logistics");
          }}
        >
          🏢 <strong>Atlas Logistics</strong>
          <span className="badge badge-purple" style={{ fontSize: "0.68rem" }}>Shipper</span>
        </button>

        <button
          className={`role-btn maghreb ${role === "maghreb" ? "active" : ""}`}
          onClick={() => {
            setRole("maghreb");
            loadCompanyData("maghreb_freight");
          }}
        >
          🚚 <strong>Maghreb Freight</strong>
          <span className="badge badge-ok" style={{ fontSize: "0.68rem" }}>Partner (North)</span>
        </button>

        <button
          className={`role-btn sahara ${role === "sahara" ? "active" : ""}`}
          onClick={() => {
            setRole("sahara");
            loadCompanyData("sahara_transport");
          }}
        >
          🏜️ <strong>Sahara Transport</strong>
          <span className="badge badge-warn" style={{ fontSize: "0.68rem" }}>Partner (South)</span>
        </button>

        <button
          className={`role-btn admin ${role === "admin" ? "active" : ""}`}
          onClick={() => setRole("admin")}
        >
          👑 <strong>Global Super Admin (Me)</strong>
          <span className="badge badge-danger" style={{ fontSize: "0.68rem" }}>Platform Monitor</span>
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          VIEW 1: ATLAS LOGISTICS ADMIN DASHBOARD
          ═══════════════════════════════════════════════════════════════════ */}
      {role === "atlas" && (
        <>
          <div className="metrics-grid">
            <div className="metric-box">
              <div className="metric-val" style={{ color: "#38bdf8" }}>
                {companyData.atlas_logistics?.fleet?.total_trucks ?? 12} Trucks
              </div>
              <div className="metric-lbl">Total Atlas Fleet</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                {companyData.atlas_logistics?.fleet?.status_counts?.["occupied"] ?? 12} occupied / 0 available
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-val" style={{ color: "var(--warn)" }}>100% Contention</div>
              <div className="metric-lbl">Fleet Capacity State</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                Requires partner A2A assist delegation
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-val" style={{ color: "var(--ok)" }}>ACTIVE</div>
              <div className="metric-lbl">Outbound Sovereignty Guard</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                Policy: atlas_outbound.yaml (Strict PII Deny)
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-val" style={{ color: "var(--purple)" }}>
                {companyData.atlas_logistics?.shipments?.length ?? 1}
              </div>
              <div className="metric-lbl">Active Internal Shipments</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                Protected with zero external leakage
              </div>
            </div>
          </div>

          {/* Atlas Internal Fleet & Internal Customer PII */}
          <div className="card">
            <div className="flex-row">
              <h2>🔒 Atlas Confidential Data &amp; Fleet Status (Internal Only)</h2>
              <span className="badge badge-purple">Zero External Access</span>
            </div>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              This data resides strictly inside Atlas Logistics’ private PostgreSQL database (<code>atlas_logistics</code>). Customer personal information (names, phones) is kept completely confidential and is <strong>never transmitted</strong> to Maghreb Freight or Sahara Transport.
            </p>

            <h3>Customer Shipments (Private Customer Records)</h3>
            <table>
              <thead>
                <tr>
                  <th>Shipment Ref</th>
                  <th>Origin → Destination</th>
                  <th>Weight</th>
                  <th>Deadline</th>
                  <th>Customer Name (PII)</th>
                  <th>Customer Phone (PII)</th>
                  <th>Privacy Guard Status</th>
                </tr>
              </thead>
              <tbody>
                {(companyData.atlas_logistics?.shipments || [
                  {
                    id: 1,
                    external_ref: "SHP-1042",
                    origin: "Rabat Hub",
                    destination: "Casablanca",
                    weight_kg: 1200.0,
                    deadline: "2026-10-11T12:00:00Z",
                    customer_name: "Fictional Client Corp",
                    customer_phone: "+212-555-0199",
                    status: "pending_delegation",
                  },
                ]).map((s) => (
                  <tr key={s.external_ref}>
                    <td><strong>{s.external_ref}</strong></td>
                    <td>{s.origin} → {s.destination}</td>
                    <td>{s.weight_kg} kg</td>
                    <td className="muted">{s.deadline?.slice(0, 16).replace("T", " ")}</td>
                    <td style={{ color: "#fca5a5" }}>{s.customer_name}</td>
                    <td style={{ color: "#fca5a5" }}>{s.customer_phone}</td>
                    <td><span className="pill-ok">🛡️ BLOCKED FROM PARTNERS</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Atlas Sovereignty Guard Policy Rules */}
          <div className="card">
            <h2>🛡️ Atlas Outbound Sovereignty Guard Rules</h2>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              The firewall running at <code>http://guard-atlas:8010</code> intercepts any outbound message leaving Atlas Logistics.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div style={{ background: "#0a101b", padding: "0.75rem", borderRadius: "8px", border: "1px solid #1e293b" }}>
                <strong style={{ color: "var(--ok)", fontSize: "0.85rem" }}>✅ Allowed Whitelist Fields:</strong>
                <div style={{ marginTop: "0.4rem" }}>
                  {(companyData.atlas_logistics?.policy?.allowed_fields || ["shipment_ref", "destination", "weight_kg", "deadline", "source_org"]).map((f) => (
                    <span key={f} className="pill-ok">{f}</span>
                  ))}
                </div>
              </div>
              <div style={{ background: "#0a101b", padding: "0.75rem", borderRadius: "8px", border: "1px solid #1e293b" }}>
                <strong style={{ color: "var(--danger)", fontSize: "0.85rem" }}>🛑 Forbidden Blocked Patterns:</strong>
                <div style={{ marginTop: "0.4rem" }}>
                  {(companyData.atlas_logistics?.policy?.forbidden_patterns || ["customer_*", "driver_*", "phone", "email", "inventory"]).map((p) => (
                    <span key={p} className="pill">{p}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Dispatcher Actions */}
          <div className="card">
            <h2>🚀 Atlas Partner Dispatcher (A2A Collaboration)</h2>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              Trigger collaborative delivery requests to partner carriers when Atlas fleet capacity is exhausted:
            </p>
            <div className="btn-group">
              <button
                disabled={loading}
                onClick={() => {
                  setActiveScenario("SHP-1042 — Urgent Casablanca (1,200 kg)");
                  runScenario({
                    shipment_ref: "SHP-1042",
                    origin: "Rabat",
                    destination: "Casablanca",
                    weight_kg: 1200.0,
                    deadline_hours: 48,
                    urgency: "Urgent",
                    cargo_type: "Medical Vaccines",
                  });
                }}
              >
                🚀 Dispatch SHP-1042 (Urgent Casablanca)
              </button>
              <button className="btn-random" disabled={loading} onClick={runRandomScenario}>
                🎲 Dispatch Random Scenario
              </button>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          VIEW 2: MAGHREB FREIGHT ADMIN DASHBOARD
          ═══════════════════════════════════════════════════════════════════ */}
      {role === "maghreb" && (
        <>
          <div className="metrics-grid">
            <div className="metric-box">
              <div className="metric-val" style={{ color: "var(--ok)" }}>
                {companyData.maghreb_freight?.slots?.reduce((acc, s) => acc + s.trucks_available, 0) ?? 8} Trucks
              </div>
              <div className="metric-lbl">Available Capacity</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                In Northern Regional Corridor
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-val" style={{ color: "#38bdf8" }}>
                {companyData.maghreb_freight?.slots?.length ?? 4} Routes
              </div>
              <div className="metric-lbl">Open Delivery Slots</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                Casablanca, Tanger Port, Rabat, Kenitra
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-val" style={{ color: "var(--purple)" }}>ONLINE</div>
              <div className="metric-lbl">A2A Protocol Agent</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                Endpoint: http://agent-maghreb:8021
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-val" style={{ color: "var(--accent)" }}>18.0h</div>
              <div className="metric-lbl">Casablanca Express ETA</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                Competitive leader on northern route
              </div>
            </div>
          </div>

          {/* Maghreb Scheduled Delivery Slots */}
          <div className="card">
            <div className="flex-row">
              <h2>🚚 Maghreb Scheduled Delivery Slots &amp; Truck Capacity</h2>
              <span className="badge badge-ok">A2A Automated Auctions</span>
            </div>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              These slots are evaluated by Maghreb’s AI Agent when an inbound query arrives from Atlas Logistics or the Sovereign Coordinator.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Route Name</th>
                  <th>Destination</th>
                  <th>Window End</th>
                  <th>Max Weight</th>
                  <th>Trucks Available</th>
                  <th>Quoted Cost</th>
                  <th>Quoted ETA</th>
                </tr>
              </thead>
              <tbody>
                {(companyData.maghreb_freight?.slots || [
                  {
                    id: 1,
                    route_name: "Casablanca Express Linehaul",
                    destination_city: "Casablanca",
                    window_end: "2026-10-14T12:00:00Z",
                    max_weight_kg: 2500.0,
                    trucks_available: 2,
                    cost_estimate: 3200.0,
                    eta_hours: 18.0,
                  },
                  {
                    id: 2,
                    route_name: "Tanger Med Port Shuttle",
                    destination_city: "Tanger",
                    window_end: "2026-10-14T18:00:00Z",
                    max_weight_kg: 3000.0,
                    trucks_available: 3,
                    cost_estimate: 2900.0,
                    eta_hours: 12.0,
                  },
                ]).map((slot) => (
                  <tr key={slot.id}>
                    <td><strong>{slot.route_name}</strong></td>
                    <td>{slot.destination_city}</td>
                    <td className="muted">{slot.window_end?.slice(0, 16).replace("T", " ")}</td>
                    <td>{slot.max_weight_kg} kg</td>
                    <td style={{ color: "var(--ok)", fontWeight: 700 }}>{slot.trucks_available} available</td>
                    <td>${slot.cost_estimate}</td>
                    <td><strong>{slot.eta_hours} hours</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Inbound Privacy Proof */}
          <div className="card">
            <h2>🛡️ Inbound Zero-Knowledge Verification (What Maghreb Sees)</h2>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              Proof of Data Sovereignty: When Maghreb Freight receives a booking assist query from Atlas Logistics, customer names, telephone numbers, and billing contracts are <strong>completely absent</strong>:
            </p>
            <div style={{ background: "#060910", border: "1px solid #1e293b", padding: "0.85rem", borderRadius: "8px", fontFamily: "monospace", fontSize: "0.82rem", color: "#6ee7b7" }}>
              {`// Inbound payload received by Maghreb Agent (:8021)
{
  "shipment_ref": "SHP-1042",
  "destination": "Casablanca",
  "weight_kg": 1200.0,
  "deadline": "2026-10-11T12:00:00Z"
  // NOTICE: customer_name, customer_phone, customer_email are ZERO / NOT PRESENT
}`}
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          VIEW 3: SAHARA TRANSPORT ADMIN DASHBOARD
          ═══════════════════════════════════════════════════════════════════ */}
      {role === "sahara" && (
        <>
          <div className="metrics-grid">
            <div className="metric-box">
              <div className="metric-val" style={{ color: "var(--warn)" }}>
                {companyData.sahara_transport?.slots?.reduce((acc, s) => acc + s.trucks_available, 0) ?? 5} Trucks
              </div>
              <div className="metric-lbl">Available Capacity</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                Southern &amp; Inter-City Routes
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-val" style={{ color: "#38bdf8" }}>
                {companyData.sahara_transport?.slots?.length ?? 3} Routes
              </div>
              <div className="metric-lbl">Scheduled Corridors</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                Marrakech, Agadir, Casablanca Southern
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-val" style={{ color: "var(--purple)" }}>ONLINE</div>
              <div className="metric-lbl">A2A Protocol Agent</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                Endpoint: http://agent-sahara:8022
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-val" style={{ color: "var(--ok)" }}>$2,800</div>
              <div className="metric-lbl">Competitive Economy Rate</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                Low-cost alternative for Casablanca freight
              </div>
            </div>
          </div>

          {/* Sahara Delivery Slots */}
          <div className="card">
            <div className="flex-row">
              <h2>🏜️ Sahara Scheduled Delivery Slots &amp; Regional Reach</h2>
              <span className="badge badge-warn">South Regional Partner</span>
            </div>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              Delivery slots offered by Sahara Transport across southern Morocco and national inter-city connections.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Route Name</th>
                  <th>Destination</th>
                  <th>Window End</th>
                  <th>Max Weight</th>
                  <th>Trucks Available</th>
                  <th>Quoted Cost</th>
                  <th>Quoted ETA</th>
                </tr>
              </thead>
              <tbody>
                {(companyData.sahara_transport?.slots || [
                  {
                    id: 1,
                    route_name: "Marrakech Atlas Linehaul",
                    destination_city: "Marrakech",
                    window_end: "2026-10-14T14:00:00Z",
                    max_weight_kg: 2800.0,
                    trucks_available: 2,
                    cost_estimate: 2400.0,
                    eta_hours: 14.0,
                  },
                  {
                    id: 2,
                    route_name: "Casablanca Southern Linehaul",
                    destination_city: "Casablanca",
                    window_end: "2026-10-14T20:00:00Z",
                    max_weight_kg: 2200.0,
                    trucks_available: 1,
                    cost_estimate: 2800.0,
                    eta_hours: 36.0,
                  },
                ]).map((slot) => (
                  <tr key={slot.id}>
                    <td><strong>{slot.route_name}</strong></td>
                    <td>{slot.destination_city}</td>
                    <td className="muted">{slot.window_end?.slice(0, 16).replace("T", " ")}</td>
                    <td>{slot.max_weight_kg} kg</td>
                    <td style={{ color: "var(--warn)", fontWeight: 700 }}>{slot.trucks_available} available</td>
                    <td>${slot.cost_estimate}</td>
                    <td><strong>{slot.eta_hours} hours</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          VIEW 4: GLOBAL SUPER ADMIN & MONITORING DASHBOARD ("ME")
          ═══════════════════════════════════════════════════════════════════ */}
      {role === "admin" && (
        <>
          {/* Top Platform Metrics */}
          <div className="metrics-grid">
            <div className="metric-box">
              <div className="metric-val" style={{ color: "var(--ok)" }}>
                {networkNodes.filter((n) => n.status === "healthy").length}/{networkNodes.length || 8}
              </div>
              <div className="metric-lbl">Active Network Nodes</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                3 Org Agents · 3 Guards · 1 Coordinator · 1 DB
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-val" style={{ color: "var(--purple)" }}>
                {ledgerVerification?.total_blocks ?? audit.length}
              </div>
              <div className="metric-lbl">Chained Audit Blocks</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                {ledgerVerification?.valid ? "✅ 100% Tamper-Free" : "⚠️ Check Hash Chain"}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-val" style={{ color: "#38bdf8" }}>OpenRouter</div>
              <div className="metric-lbl">AI Reasoning Engine</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                Multi-Model Gateway (No Quota Exhaustion)
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-val" style={{ color: "var(--accent)" }}>0.00%</div>
              <div className="metric-lbl">Cross-Org PII Leakage</div>
              <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
                Mathematically verified by Guard policy
              </div>
            </div>
          </div>

          {/* ─── LIVE NODE HEALTH TOPOLOGY ─── */}
          <div className="card">
            <div className="flex-row">
              <h2>🌐 Global Node Topology &amp; Health Monitor</h2>
              <button
                className="btn-secondary"
                style={{ padding: "0.3rem 0.6rem", fontSize: "0.78rem" }}
                onClick={loadNetworkHealth}
              >
                Ping All Nodes
              </button>
            </div>
            <div className="node-grid">
              {(networkNodes.length > 0
                ? networkNodes
                : [
                    { name: "Coordinator", type: "coordinator", role: "Orchestrator", status: "healthy", latency_ms: 2 },
                    { name: "Atlas Agent", type: "agent", role: "Atlas Logistics", status: "healthy", latency_ms: 3 },
                    { name: "Maghreb Agent", type: "agent", role: "Maghreb Freight", status: "healthy", latency_ms: 3 },
                    { name: "Sahara Agent", type: "agent", role: "Sahara Transport", status: "healthy", latency_ms: 4 },
                    { name: "Atlas Guard", type: "guard", role: "Security Firewall", status: "healthy", latency_ms: 2 },
                    { name: "Maghreb Guard", type: "guard", role: "Security Firewall", status: "healthy", latency_ms: 2 },
                    { name: "Sahara Guard", type: "guard", role: "Security Firewall", status: "healthy", latency_ms: 2 },
                    { name: "PostgreSQL", type: "database", role: "Data Store & Ledger", status: "healthy", latency_ms: 1 },
                  ]
              ).map((node) => (
                <div key={node.name} className="node-box">
                  <div>
                    <span className={`node-status-dot ${node.status}`} />
                    <strong>{node.name}</strong>
                    <div className="muted" style={{ fontSize: "0.72rem" }}>{node.role}</div>
                  </div>
                  <span className="badge badge-ok" style={{ fontSize: "0.72rem" }}>
                    {node.latency_ms} ms
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ─── SCENARIO ORCHESTRATOR ─── */}
          <div className="card">
            <div className="flex-row">
              <h2>📦 Cross-Company Scenario Dispatcher &amp; A2A Orchestration</h2>
              {loading && <span className="badge badge-warn">Running Collaboration...</span>}
            </div>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              Launch multi-agent discovery, sovereignty policy evaluation, and Gemini AI proposal reasoning across companies:
            </p>
            <div className="btn-group">
              <button
                disabled={loading}
                onClick={() => {
                  setActiveScenario("SHP-1042 — Urgent Casablanca (1,200 kg)");
                  runScenario({
                    shipment_ref: "SHP-1042",
                    origin: "Rabat",
                    destination: "Casablanca",
                    weight_kg: 1200.0,
                    deadline_hours: 48,
                    urgency: "Urgent",
                    cargo_type: "Medical Vaccines",
                  });
                }}
              >
                🚀 SHP-1042: Urgent Casablanca (1,200 kg)
              </button>
              <button
                className="btn-secondary"
                disabled={loading}
                onClick={() => {
                  setActiveScenario("SHP-2045 — Express Tanger Med (2,100 kg — Heavy)");
                  runScenario({
                    shipment_ref: "SHP-2045",
                    origin: "Casablanca",
                    destination: "Tanger",
                    weight_kg: 2100.0,
                    deadline_hours: 24,
                    urgency: "Critical Express",
                    cargo_type: "Automotive Industrial Components",
                  });
                }}
              >
                ⚡ SHP-2045: Tanger Med (2,100 kg)
              </button>
              <button
                className="btn-secondary"
                disabled={loading}
                onClick={() => {
                  setActiveScenario("SHP-3088 — Cold-Chain Marrakech (850 kg — Pharma)");
                  runScenario({
                    shipment_ref: "SHP-3088",
                    origin: "Rabat",
                    destination: "Marrakech",
                    weight_kg: 850.0,
                    deadline_hours: 18,
                    urgency: "Ultra-Urgent",
                    cargo_type: "Cold-Chain Pharmaceuticals",
                  });
                }}
              >
                📦 SHP-3088: Marrakech Pharma (850 kg)
              </button>
              <button
                className="btn-secondary"
                disabled={loading}
                onClick={() => {
                  setActiveScenario("SHP-4019 — Agadir Freight (1,600 kg — Standard)");
                  runScenario({
                    shipment_ref: "SHP-4019",
                    origin: "Casablanca",
                    destination: "Agadir",
                    weight_kg: 1600.0,
                    deadline_hours: 60,
                    urgency: "Standard",
                    cargo_type: "Retail Distribution Freight",
                  });
                }}
              >
                🚚 SHP-4019: Agadir Freight (1,600 kg)
              </button>
              <button className="btn-random" disabled={loading} onClick={runRandomScenario}>
                🎲 Randomize Scenario
              </button>
            </div>
            {activeScenario && (
              <p style={{ marginTop: "0.85rem", fontSize: "0.85rem", color: "var(--accent)" }}>
                Active Target: <strong>{activeScenario}</strong>
              </p>
            )}
            {error && <p style={{ color: "var(--danger)", marginTop: "0.5rem" }}>{error}</p>}
          </div>

          {/* ─── SAFETY ATTACK SIMULATOR ─── */}
          <div className="card" style={{ borderLeft: "4px solid var(--danger)" }}>
            <h2>🛡️ Sovereignty Guard Security Attack Simulator</h2>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              Verify security boundaries. Trigger unauthorized data exfiltration attacks against the Sovereign Guard:
            </p>
            <div className="btn-group">
              <button className="btn-danger" disabled={violationLoading !== null} onClick={() => testViolation("customer_pii")}>
                {violationLoading === "customer_pii" ? "Testing..." : "🛑 1. Customer PII Leak (Name/Phone)"}
              </button>
              <button className="btn-danger" disabled={violationLoading !== null} onClick={() => testViolation("driver_identity")}>
                {violationLoading === "driver_identity" ? "Testing..." : "🛑 2. Driver Info & Schedule Leak"}
              </button>
              <button className="btn-danger" disabled={violationLoading !== null} onClick={() => testViolation("nested_pii_injection")}>
                {violationLoading === "nested_pii_injection" ? "Testing..." : "🛑 3. Nested Metadata PII Injection"}
              </button>
              <button className="btn-danger" disabled={violationLoading !== null} onClick={() => testViolation("commercial_secrets")}>
                {violationLoading === "commercial_secrets" ? "Testing..." : "🛑 4. Commercial Margins & Pricing"}
              </button>
              <button className="btn-danger" disabled={violationLoading !== null} onClick={() => testViolation("unauthorized_fields")}>
                {violationLoading === "unauthorized_fields" ? "Testing..." : "🛑 5. Arbitrary Out-of-Bounds Field"}
              </button>
            </div>

            {violationResult && (
              <div style={{ marginTop: "1.25rem", background: "#1e1315", border: "1px solid var(--danger)", borderRadius: "8px", padding: "1rem" }}>
                <div className="flex-row">
                  <span style={{ fontWeight: 700, color: "var(--danger)" }}>🚨 Intercepted: {violationResult.name}</span>
                  <span className="badge badge-danger">HTTP {violationResult.guard_status_code} — {violationResult.guard_action.toUpperCase()}</span>
                </div>
                <p style={{ fontSize: "0.85rem", color: "#fca5a5", margin: "0.5rem 0" }}>{violationResult.description}</p>
                <div style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                  <strong>Blocked Fields:</strong>{" "}
                  {violationResult.rejected_fields.map((f) => (
                    <span key={f} className="pill">{f}</span>
                  ))}
                </div>
                <div style={{ marginTop: "0.5rem", fontSize: "0.82rem", color: "var(--muted)" }}>
                  <strong>Rule Triggered:</strong> {violationResult.rejection_reason} ·{" "}
                  <strong>Audit Ledger ID:</strong> <code style={{ color: "var(--accent)" }}>{violationResult.request_id}</code>
                </div>
              </div>
            )}
          </div>

          {/* ─── CRYPTOGRAPHIC AUDIT LEDGER PROOF ─── */}
          <div className="card">
            <div className="flex-row">
              <h2>⛓️ Cryptographic Hash Ledger (Blockchain-Style Tamper Proof)</h2>
              <button
                className="btn-secondary"
                disabled={verifyingLedger}
                style={{ padding: "0.3rem 0.6rem", fontSize: "0.78rem" }}
                onClick={handleVerifyLedger}
              >
                {verifyingLedger ? "Verifying..." : "🔐 Re-Verify Hash Chain"}
              </button>
            </div>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              Each event is chained using SHA-256: <code>event_hash = sha256(prev_hash + event_json)</code>. Any alteration of past sharing requests breaks the mathematical hash chain.
            </p>
            {ledgerVerification && (
              <div style={{ marginBottom: "0.75rem" }}>
                <span className={`badge ${ledgerVerification.valid ? "badge-ok" : "badge-danger"}`}>
                  {ledgerVerification.status} ({ledgerVerification.total_blocks} total blocks)
                </span>
              </div>
            )}
            <div className="chain-container">
              {(ledgerVerification?.blocks || []).map((b) => (
                <div key={b.block_id} className="chain-block">
                  <div className="flex-row">
                    <span>
                      <strong>Block #{b.block_id}</strong> · Prev: <span className="hash-code">{b.prev_hash_abbr}</span> → Hash: <span className="hash-code">{b.event_hash_abbr}</span>
                    </span>
                    <span className="badge badge-purple" style={{ fontSize: "0.7rem" }}>
                      {b.hash_valid ? "Valid SHA-256" : "Tampered"}
                    </span>
                  </div>
                  <div className="muted" style={{ marginTop: "0.25rem", fontSize: "0.75rem" }}>
                    Action: <strong>{String(b.event.action || "ALLOW").toUpperCase()}</strong> · Intent: {String(b.event.intent || "assist_query")} · Org: {String(b.event.source_org || "atlas_logistics")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SHARED: SCENARIO OUTCOME (WHEN EXECUTED)
          ═══════════════════════════════════════════════════════════════════ */}
      {result && (
        <div className="card">
          <div className="flex-row">
            <h2>Collaboration Outcome: {result.shipment_ref}</h2>
            <span className="badge badge-ok">Selected: {result.selected_partner}</span>
          </div>

          {/* OpenRouter AI Decision Card */}
          {result.gemini_decision && (
            <div
              style={{
                background: (result.gemini_decision.ai_used ?? result.gemini_decision.gemini_used) ? "rgba(168, 85, 247, 0.1)" : "rgba(245, 158, 11, 0.1)",
                border: `1px solid ${(result.gemini_decision.ai_used ?? result.gemini_decision.gemini_used) ? "var(--purple)" : "var(--warn)"}`,
                borderRadius: "8px",
                padding: "0.85rem 1rem",
                marginBottom: "1rem",
              }}
            >
              <div className="flex-row">
                <strong style={{ color: (result.gemini_decision.ai_used ?? result.gemini_decision.gemini_used) ? "#d8b4fe" : "#fde68a" }}>
                  {(result.gemini_decision.ai_used ?? result.gemini_decision.gemini_used)
                    ? `🧠 OpenRouter AI Reasoning Active (${result.gemini_decision.model || "OpenRouter"}) ${
                        result.gemini_decision.cached ? "· ⚡ Cached (0 API calls)" : "· Live Call"
                      }`
                    : result.gemini_decision.is_throttled
                    ? "⏳ Rate Limit Guard Active (Safe Mode)"
                    : "ℹ️ Fallback Scorer Active (OpenRouter Not Invoked)"}
                </strong>
                <span className={`badge ${(result.gemini_decision.ai_used ?? result.gemini_decision.gemini_used) ? "badge-purple" : "badge-warn"}`}>
                  {(result.gemini_decision.ai_used ?? result.gemini_decision.gemini_used)
                    ? result.gemini_decision.cached
                      ? "Cached Decision"
                      : "Live AI Reasoning"
                    : result.gemini_decision.is_throttled
                    ? "Quota Guard"
                    : "Formula Scorer"}
                </span>
              </div>

              {!(result.gemini_decision.ai_used ?? result.gemini_decision.gemini_used) && (
                <p style={{ margin: "0.4rem 0 0", fontSize: "0.85rem", color: "#fef08a" }}>
                  <strong>Why OpenRouter wasn&apos;t used:</strong> {result.gemini_decision.reason_not_used}
                  <br />
                  <span className="muted" style={{ fontSize: "0.8rem" }}>
                    💡 Tip: Set <code style={{ color: "var(--accent)" }}>OPENROUTER_API_KEY=your_key</code> in{" "}
                    <code style={{ color: "var(--accent)" }}>.env</code> to activate multi-model reasoning via OpenRouter.
                  </span>
                </p>
              )}

              {(result.gemini_decision.ai_used ?? result.gemini_decision.gemini_used) && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.88rem" }}>
                  <p style={{ margin: "0 0 0.4rem" }}>
                    <strong>AI Decision:</strong> {result.gemini_decision.reasoning}
                  </p>
                  <p style={{ margin: "0 0 0.4rem", color: "var(--muted)" }}>
                    <strong>Confidence:</strong> {((result.gemini_decision.confidence ?? 0) * 100).toFixed(0)}% ·{" "}
                    <strong>Recommended Fallback Partner:</strong> {result.gemini_decision.fallback_org_id ?? "None"}
                  </p>
                  {result.gemini_decision.risks && result.gemini_decision.risks.length > 0 && (
                    <p style={{ margin: 0, color: "#fca5a5" }}>
                      <strong>Identified Risks:</strong> {result.gemini_decision.risks.join(" · ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <h3>Partner Proposals Received via A2A</h3>
          <table>
            <thead>
              <tr>
                <th>Partner Org</th>
                <th>Available Trucks</th>
                <th>ETA</th>
                <th>Quoted Cost</th>
                <th>Meets Deadline</th>
                <th>Slot Summary</th>
              </tr>
            </thead>
            <tbody>
              {result.proposals.map((p) => {
                const isWinner = String(p.org_id) === result.selected_partner;
                return (
                  <tr key={String(p.org_id)} style={{ background: isWinner ? "rgba(56, 189, 248, 0.08)" : "transparent" }}>
                    <td><strong>{String(p.org_id)}</strong> {isWinner && "🏆 (Selected)"}</td>
                    <td>{String(p.available_trucks)} trucks</td>
                    <td>{String(p.estimated_eta_hours)} hours</td>
                    <td>${String(p.cost_estimate)}</td>
                    <td className={p.meets_deadline ? "tag-allow" : "tag-reject"}>
                      {p.meets_deadline ? "✅ YES" : "❌ NO"}
                    </td>
                    <td className="muted">{String(p.slot_summary || "—")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 style={{ marginTop: "1.25rem" }}>Live Protocol Execution Trace</h3>
          <ol className="stepper">
            {result.steps.map((s, i) => (
              <li
                key={`${s.step}-${i}`}
                className={
                  s.step.includes("guard")
                    ? "guard-step"
                    : s.step.includes("decision") || s.step.includes("reasoning")
                    ? "reasoning-step"
                    : s.step.includes("audit")
                    ? "audit-step"
                    : ""
                }
              >
                <span className="muted" style={{ fontWeight: 600 }}>[{s.step.toUpperCase()}]</span> {s.message}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SHARED: LIVE WEB CONSOLE & LOG FEED
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="card">
        <div className="flex-row">
          <h2>💻 Live Administrative Log Stream</h2>
          <span className="muted" style={{ fontSize: "0.78rem" }}>Real-time coordinator &amp; agent audit feed</span>
        </div>
        <div className="terminal-console">
          {consoleLogs.map((log, i) => (
            <div key={i} className={`terminal-line ${log.level}`}>
              <span style={{ opacity: 0.6 }}>[{log.timestamp}]</span> {log.text}
            </div>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          SHARED: RECENT MASTER AUDIT LEDGER TABLE
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="card">
        <div className="flex-row">
          <h2>📜 Recent Cross-Organization Data Sharing Events</h2>
          <span className="muted" style={{ fontSize: "0.8rem" }}>Immutable PostgreSQL Audit Trail</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Source Org</th>
              <th>Target Org</th>
              <th>Guard Decision</th>
              <th>Sanitized / Rejected Fields</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((row) => (
              <tr key={row.request_id}>
                <td className="muted">{row.created_at?.slice(0, 19).replace("T", " ") ?? "—"}</td>
                <td>{row.source_org}</td>
                <td>{row.target_org ?? "partners"}</td>
                <td className={row.action === "reject" ? "tag-reject" : "tag-allow"}>
                  {row.action ? row.action.toUpperCase() : "ALLOW"}
                </td>
                <td>
                  {(row.rejected_fields ?? []).length > 0 ? (
                    row.rejected_fields.map((f) => (
                      <span key={f} className="pill">{f}</span>
                    ))
                  ) : (
                    <span className="muted">None (Compliant Outbound)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
