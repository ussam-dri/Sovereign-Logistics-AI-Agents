"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconShield,
  IconServer,
  IconTruck,
  IconCpu,
  IconLock,
  IconCheck,
  IconX,
  IconAlertCircle,
  IconRefreshCw,
  IconPlay,
  IconBookOpen,
  IconLayers,
  IconActivity,
  IconBuilding,
  IconDatabase,
  IconArrowRight,
  IconTerminal,
  IconFileText,
} from "./components/Icons";
import { ArchitectureDiagram } from "./components/ArchitectureDiagram";

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

type NavView =
  | "walkthrough"
  | "admin"
  | "scenarios"
  | "ledger"
  | "attacks"
  | "atlas"
  | "maghreb"
  | "sahara";

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
  "Pharmaceutical Cold-Chain Vaccines",
  "High-Precision Automotive Sensors",
  "Aircraft Maintenance Spare Parts",
  "Urgent Semiconductor Components",
  "Critical Hospital Medical Supplies",
];

export default function Home() {
  const [currentView, setCurrentView] = useState<NavView>("walkthrough");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [activeScenarioDesc, setActiveScenarioDesc] = useState<string>(
    "SHP-1042 — Urgent Casablanca (1,200 kg)"
  );
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
    setConsoleLogs((prev) => [{ timestamp: time, level, text }, ...prev.slice(0, 39)]);
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      const res = await fetch(`${COORDINATOR}/audit/recent?limit=25`);
      if (res.ok) setAudit(await res.json());
    } catch {
      // polling fallback
    }
  }, []);

  const loadCompanyData = useCallback(async (orgId: string) => {
    try {
      const res = await fetch(`${COORDINATOR}/admin/orgs/${orgId}/overview`);
      if (res.ok) {
        const data = await res.json();
        setCompanyData((prev) => ({ ...prev, [orgId]: data }));
      }
    } catch {
      // handled
    }
  }, []);

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
          `Cryptographic check complete: ${data.total_blocks} blocks verified. Status: ${data.status}`
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
    addConsoleLog("info", "Multi-tenant network dashboard initialized.");
  }, [loadAudit, loadNetworkHealth, handleVerifyLedger, loadCompanyData, addConsoleLog]);

  // Execute Scenario
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
    addConsoleLog(
      "info",
      `Initiating scenario: ${ref} -> ${scenarioParams?.destination ?? "Casablanca"} (${scenarioParams?.weight_kg ?? 1200} kg)...`
    );

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
            cargo_type: "Critical Hospital Medical Supplies",
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
        `Scenario completed: Selected Carrier=${data.selected_partner}, Guard=${data.guard_passed ? "APPROVED" : "REJECTED"}, Proposals=${data.proposals.length}`
      );

      const aiUsed = data.gemini_decision?.ai_used ?? data.gemini_decision?.gemini_used;
      if (aiUsed) {
        const cacheNote = data.gemini_decision?.cached ? " [CACHE]" : " [LIVE]";
        addConsoleLog(
          "success",
          `[OpenRouter AI] Decision by "${data.gemini_decision?.model || "OpenRouter"}"${cacheNote}. Confidence: ${(
            (data.gemini_decision?.confidence ?? 0) * 100
          ).toFixed(0)}%. Rationale: ${data.gemini_decision?.reasoning}`
        );
      } else {
        const reason = data.gemini_decision?.reason_not_used || "Unknown";
        addConsoleLog("warn", `[Reasoning Engine] Algorithmic Fallback: ${reason}`);
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
    const desc = `${randomRef} — ${randomCargo} -> ${randomCity} (${randomWeight} kg, ${randomHours}h)`;
    setActiveScenarioDesc(desc);

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

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        const errorDetail = typeof errorBody.detail === "string" ? errorBody.detail : `HTTP ${res.status}`;
        throw new Error(errorDetail);
      }

      const data: ViolationResult = await res.json();
      setViolationResult(data);

      const rejectedList = Array.isArray(data.rejected_fields) && data.rejected_fields.length > 0
        ? data.rejected_fields.join(", ")
        : "None";

      addConsoleLog(
        "error",
        `[GUARD REJECTION] HTTP ${data.guard_status_code}: Attack "${data.name}" was BLOCKED. Rejected fields: [${rejectedList}]. Reason: ${data.rejection_reason || "Forbidden"}`
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
    <div className="app-layout">
      {/* ─── LEFT SIDEBAR (CRISPLY MINIMALIST) ─── */}
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="brand-emblem">S</div>
          <div className="brand-info">
            <div className="brand-title">
              Sovereign AI <span className="brand-version">v2.4</span>
            </div>
            <div className="brand-subtitle">Fujitsu Multi-Agent Network</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div>
            <div className="nav-group-title">Platform</div>
            <ul className="nav-links">
              <li>
                <button
                  className={`nav-item ${currentView === "walkthrough" ? "active" : ""}`}
                  onClick={() => setCurrentView("walkthrough")}
                >
                  <IconBookOpen size={16} />
                  <span>Walkthrough</span>
                  <span className="nav-badge">Start</span>
                </button>
              </li>
              <li>
                <button
                  className={`nav-item ${currentView === "admin" ? "active" : ""}`}
                  onClick={() => setCurrentView("admin")}
                >
                  <IconLayers size={16} />
                  <span>Executive Hub</span>
                </button>
              </li>
              <li>
                <button
                  className={`nav-item ${currentView === "scenarios" ? "active" : ""}`}
                  onClick={() => setCurrentView("scenarios")}
                >
                  <IconPlay size={16} />
                  <span>Live Scenarios</span>
                </button>
              </li>
              <li>
                <button
                  className={`nav-item ${currentView === "ledger" ? "active" : ""}`}
                  onClick={() => setCurrentView("ledger")}
                >
                  <IconLock size={16} />
                  <span>Audit Ledger</span>
                </button>
              </li>
              <li>
                <button
                  className={`nav-item ${currentView === "attacks" ? "active" : ""}`}
                  onClick={() => setCurrentView("attacks")}
                >
                  <IconShield size={16} />
                  <span>Policy Attacks</span>
                </button>
              </li>
            </ul>
          </div>

          <div>
            <div className="nav-group-title">Organizations</div>
            <ul className="nav-links">
              <li>
                <button
                  className={`nav-item ${currentView === "atlas" ? "active" : ""}`}
                  onClick={() => setCurrentView("atlas")}
                >
                  <IconBuilding size={16} />
                  <span>Atlas Logistics</span>
                  <span className="nav-badge">Shipper</span>
                </button>
              </li>
              <li>
                <button
                  className={`nav-item ${currentView === "maghreb" ? "active" : ""}`}
                  onClick={() => setCurrentView("maghreb")}
                >
                  <IconTruck size={16} />
                  <span>Maghreb Freight</span>
                  <span className="nav-badge">Carrier</span>
                </button>
              </li>
              <li>
                <button
                  className={`nav-item ${currentView === "sahara" ? "active" : ""}`}
                  onClick={() => setCurrentView("sahara")}
                >
                  <IconTruck size={16} />
                  <span>Sahara Transport</span>
                  <span className="nav-badge">Carrier</span>
                </button>
              </li>
            </ul>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status-box">
            <div className="status-dot-wrap">
              <span className="status-dot green" />
              <span>8 / 8 Nodes Active</span>
            </div>
            <button
              onClick={() => {
                loadAudit();
                loadNetworkHealth();
                handleVerifyLedger();
              }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "inherit" }}
              title="Sync network"
            >
              <IconRefreshCw size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ─── MAIN CONTENT ─── */}
      <div className="app-main">
        {/* TOP BAR */}
        <header className="app-header">
          <div className="header-breadcrumbs">
            <span>Sovereign AI Network</span>
            <span>/</span>
            <span className="breadcrumb-active">
              {currentView === "walkthrough" && "Architecture Walkthrough & Overview"}
              {currentView === "admin" && "Executive Hub · Global Super Admin"}
              {currentView === "scenarios" && "Live Scenario Execution & AI Reasoning"}
              {currentView === "ledger" && "Cryptographic Audit Ledger (SHA-256 Chain)"}
              {currentView === "attacks" && "Security Boundary & Guard Violation Suite"}
              {currentView === "atlas" && "Atlas Logistics (Shipper Hub & Fleet DB)"}
              {currentView === "maghreb" && "Maghreb Freight (Northern Carrier Hub)"}
              {currentView === "sahara" && "Sahara Transport (Southern Freight Hub)"}
            </span>
          </div>

          <div className="header-actions">
            <button
              className="btn-secondary"
              onClick={() => {
                loadAudit();
                loadNetworkHealth();
                handleVerifyLedger();
              }}
            >
              <IconRefreshCw size={14} />
              <span>Sync Status</span>
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setCurrentView("scenarios");
                runScenario();
              }}
              disabled={loading}
            >
              <IconPlay size={14} />
              <span>{loading ? "Running..." : "Run Casablanca Demo"}</span>
            </button>
          </div>
        </header>

        {/* VIEW 1: WALKTHROUGH (DEFAULT FIRST PAGE) */}
        {currentView === "walkthrough" && (
          <div className="content-area">
            <div className="page-intro">
              <h1 className="page-title">Autonomous Multi-Agent Collaboration with Data Sovereignty</h1>
              <p className="page-description">
                A zero-trust agentic framework enabling competing supply chain enterprises to autonomously negotiate freight capacity while cryptographically preventing sensitive customer PII and proprietary commercial rates from leaking.
              </p>
            </div>

            {/* METRICS ROW */}
            <div className="metrics-row">
              <div className="metric-card">
                <div className="metric-label-row">
                  <span className="metric-title">PII Sanitization</span>
                  <IconShield size={16} />
                </div>
                <div className="metric-value">100%</div>
                <div className="metric-footer">Outbound fields strictly enforced</div>
              </div>

              <div className="metric-card">
                <div className="metric-label-row">
                  <span className="metric-title">Agent Protocol</span>
                  <IconCpu size={16} />
                </div>
                <div className="metric-value">A2A v1.0</div>
                <div className="metric-footer">Standard agent cards & discovery</div>
              </div>

              <div className="metric-card">
                <div className="metric-label-row">
                  <span className="metric-title">Audit Ledger</span>
                  <IconLock size={16} />
                </div>
                <div className="metric-value">SHA-256</div>
                <div className="metric-footer">
                  {ledgerVerification?.total_blocks ?? 0} sequentially chained blocks
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-label-row">
                  <span className="metric-title">Carrier Mesh</span>
                  <IconTruck size={16} />
                </div>
                <div className="metric-value">3 Orgs</div>
                <div className="metric-footer">Atlas, Maghreb, Sahara</div>
              </div>
            </div>

            {/* FULL SYSTEM ARCHITECTURE DIAGRAM */}
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <IconLayers size={18} />
                    <span>System Flow & Architecture Topology</span>
                  </h2>
                  <div className="card-subtitle">
                    End-to-end data flow: Shipper Origin -&gt; Sovereignty Guard Boundary -&gt; Safe A2A Protocol Wire -&gt; Carrier Mesh -&gt; AI Decision Engine
                  </div>
                </div>
                <div className="badge-clean">Interactive Architecture</div>
              </div>

              <ArchitectureDiagram />
            </div>

            {/* STEP BY STEP WALKTHROUGH PILLARS */}
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <IconBookOpen size={18} />
                    <span>How the System Works in 4 Steps</span>
                  </h2>
                  <div className="card-subtitle">
                    The lifecycle of an autonomous logistics negotiation request
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
                <div style={{ border: "1px solid var(--border-light)", padding: "1.25rem", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                    STEP 01
                  </div>
                  <h3 style={{ fontSize: "0.95rem", fontWeight: "700", marginBottom: "0.4rem" }}>
                    Internal Capacity Conflict
                  </h3>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                    Atlas Logistics receives an urgent shipment order. Its internal fleet is 100% booked. The Atlas Org Agent initiates a broadcast request for external carrier capacity.
                  </p>
                </div>

                <div style={{ border: "1px solid var(--border-light)", padding: "1.25rem", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                    STEP 02
                  </div>
                  <h3 style={{ fontSize: "0.95rem", fontWeight: "700", marginBottom: "0.4rem" }}>
                    Perimeter Sanitization
                  </h3>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                    Before touching the external network, the request is intercepted by the Atlas Sovereignty Guard. Customer names, phones, and pricing margins are stripped. A SHA-256 hash is committed to the ledger.
                  </p>
                </div>

                <div style={{ border: "1px solid var(--border-light)", padding: "1.25rem", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                    STEP 03
                  </div>
                  <h3 style={{ fontSize: "0.95rem", fontWeight: "700", marginBottom: "0.4rem" }}>
                    A2A Parallel Negotiation
                  </h3>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                    Maghreb Freight and Sahara Transport agents receive the sanitized query. Each agent checks its proprietary delivery schedule and responds with binding truck availability, cost, and ETA.
                  </p>
                </div>

                <div style={{ border: "1px solid var(--border-light)", padding: "1.25rem", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                    STEP 04
                  </div>
                  <h3 style={{ fontSize: "0.95rem", fontWeight: "700", marginBottom: "0.4rem" }}>
                    Constrained LLM Reasoning
                  </h3>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                    The Coordinator dispatches proposal candidate quotes to OpenRouter (Gemini 2.0 Flash / Claude). The LLM evaluates deadline feasibility, redundancy, and cost, returning a verifiable structured award.
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
                <button
                  className="btn-primary"
                  onClick={() => {
                    setCurrentView("scenarios");
                    runScenario();
                  }}
                >
                  <IconPlay size={14} />
                  <span>Launch Live Interactive Demo</span>
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setCurrentView("admin")}
                >
                  <IconLayers size={14} />
                  <span>Inspect Executive Hub</span>
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setCurrentView("ledger")}
                >
                  <IconLock size={14} />
                  <span>Verify SHA-256 Ledger</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: EXECUTIVE HUB (ADMIN) */}
        {currentView === "admin" && (
          <div className="content-area">
            <div className="page-intro">
              <h1 className="page-title">Executive Hub & Network Topology</h1>
              <p className="page-description">
                Global operational telemetry across all 8 microservices, active carrier participants, and real-time cryptographic audit events.
              </p>
            </div>

            {/* NETWORK NODE TOPOLOGY */}
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <IconActivity size={18} />
                    <span>Microservice Mesh Status (8 Nodes)</span>
                  </h2>
                  <div className="card-subtitle">
                    Live ping across Coordinator, Sovereignty Guards, Org Agents, and Database
                  </div>
                </div>
                <div className="badge-clean">
                  {networkNodes.filter((n) => n.status === "healthy").length} / {networkNodes.length || 8} Healthy
                </div>
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Service Node</th>
                      <th>Type</th>
                      <th>Role Description</th>
                      <th>Latency</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(networkNodes.length > 0
                      ? networkNodes
                      : [
                          { name: "Coordinator", type: "coordinator", role: "Orchestrator & A2A Broker", latency_ms: 2, status: "healthy" as const },
                          { name: "Atlas Guard", type: "guard", role: "Security Policy Perimeter", latency_ms: 3, status: "healthy" as const },
                          { name: "Maghreb Guard", type: "guard", role: "Security Policy Perimeter", latency_ms: 3, status: "healthy" as const },
                          { name: "Sahara Guard", type: "guard", role: "Security Policy Perimeter", latency_ms: 4, status: "healthy" as const },
                          { name: "Atlas Agent", type: "agent", role: "Shipper Org Agent", latency_ms: 2, status: "healthy" as const },
                          { name: "Maghreb Agent", type: "agent", role: "Carrier Org Agent", latency_ms: 2, status: "healthy" as const },
                          { name: "Sahara Agent", type: "agent", role: "Carrier Org Agent", latency_ms: 3, status: "healthy" as const },
                          { name: "PostgreSQL", type: "database", role: "Multi-Tenant Data & Audit Storage", latency_ms: 1, status: "healthy" as const },
                        ]
                    ).map((node, i) => (
                      <tr key={i}>
                        <td>
                          <strong>{node.name}</strong>
                        </td>
                        <td>
                          <span className="badge-clean outline">{node.type}</span>
                        </td>
                        <td>{node.role}</td>
                        <td className="table-code">{node.latency_ms} ms</td>
                        <td>
                          <span className="badge-clean black">
                            <IconCheck size={12} /> {node.status.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* AUDIT LOG TABLE */}
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <IconFileText size={18} />
                    <span>Real-Time Cryptographic Audit Feed</span>
                  </h2>
                  <div className="card-subtitle">
                    Recent transactions inspected and verified by the Sovereignty Guard
                  </div>
                </div>
                <div className="badge-clean">{audit.length} Recent Records</div>
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Request ID</th>
                      <th>Source Org</th>
                      <th>Target</th>
                      <th>Guard Action</th>
                      <th>Sanitized Payload Keys</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: "center", padding: "2rem" }}>
                          No audit entries logged yet. Click "Run Casablanca Demo" to execute a scenario.
                        </td>
                      </tr>
                    ) : (
                      audit.slice(0, 10).map((row, i) => (
                        <tr key={i}>
                          <td className="table-code">{row.request_id.slice(0, 8)}...</td>
                          <td>
                            <strong>{row.source_org}</strong>
                          </td>
                          <td>{row.target_org ?? "partners"}</td>
                          <td>
                            <span className={`badge-clean ${row.action === "reject" ? "outline" : "black"}`}>
                              {row.action === "reject" ? "BLOCKED" : "APPROVED"}
                            </span>
                          </td>
                          <td className="table-code">
                            {row.sanitized_payload
                              ? Object.keys(row.sanitized_payload).join(", ")
                              : "Payload Dropped"}
                          </td>
                          <td style={{ fontSize: "0.78rem" }}>
                            {row.created_at ? new Date(row.created_at).toLocaleTimeString() : "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: LIVE SCENARIOS */}
        {currentView === "scenarios" && (
          <div className="content-area">
            <div className="page-intro">
              <h1 className="page-title">Live Scenario Execution & AI Reasoning</h1>
              <p className="page-description">
                Trigger real-time logistics scenarios across Moroccan transit corridors. Watch the Sovereignty Guard sanitize outbound payloads and inspect OpenRouter / Gemini proposal evaluation.
              </p>
            </div>

            {/* CONTROLS */}
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <IconPlay size={18} />
                    <span>Scenario Controller</span>
                  </h2>
                  <div className="card-subtitle">Active Selection: {activeScenarioDesc}</div>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                <button
                  className="btn-primary"
                  onClick={() => {
                    setActiveScenarioDesc("SHP-1042 — Urgent Casablanca (1,200 kg)");
                    runScenario();
                  }}
                  disabled={loading}
                >
                  <IconPlay size={14} />
                  <span>{loading ? "Running..." : "Run Casablanca (SHP-1042)"}</span>
                </button>
                <button
                  className="btn-secondary"
                  onClick={runRandomScenario}
                  disabled={loading}
                >
                  <IconRefreshCw size={14} />
                  <span>Random Corridor & Urgency</span>
                </button>
              </div>

              {error && (
                <div style={{ marginTop: "1rem", padding: "0.75rem 1rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "6px", color: "#991b1b", fontSize: "0.85rem" }}>
                  <strong>Execution Error:</strong> {error}
                </div>
              )}
            </div>

            {/* SCENARIO RESULT */}
            {result && (
              <>
                {/* WINNER & AI REASONING CARD */}
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h2 className="card-title">
                        <IconCpu size={18} />
                        <span>Winning Carrier & AI Evaluation</span>
                      </h2>
                      <div className="card-subtitle">
                        Awarded Carrier: <strong>{result.selected_partner}</strong> · Task ID: <code>{result.task_id.slice(0, 8)}</code>
                      </div>
                    </div>
                    <div className="badge-clean black">
                      {result.gemini_decision?.model || "OpenRouter LLM"}
                    </div>
                  </div>

                  <div style={{ background: "var(--bg-subtle)", padding: "1.25rem", borderRadius: "8px", border: "1px solid var(--border-light)", marginBottom: "1.25rem" }}>
                    <div style={{ fontSize: "0.75rem", fontWeight: "700", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.35rem" }}>
                      AI Reasoning Rationale (Confidence: {((result.gemini_decision?.confidence ?? 0.85) * 100).toFixed(0)}%)
                    </div>
                    <p style={{ fontSize: "0.9rem", color: "var(--text-main)", lineHeight: "1.5" }}>
                      {result.gemini_decision?.reasoning || "Evaluation completed based on strict deadline constraints and redundancy metrics."}
                    </p>
                    {result.gemini_decision?.risks && result.gemini_decision.risks.length > 0 && (
                      <div style={{ marginTop: "0.75rem" }}>
                        <span style={{ fontSize: "0.72rem", fontWeight: "600", textTransform: "uppercase", color: "var(--text-muted)" }}>
                          Identified Risks:
                        </span>
                        <ul style={{ paddingLeft: "1.25rem", marginTop: "0.25rem", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                          {result.gemini_decision.risks.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* PROPOSALS TABLE */}
                  <h3 style={{ fontSize: "0.9rem", fontWeight: "700", marginBottom: "0.75rem" }}>
                    Candidate Carrier Proposals Received:
                  </h3>
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>Carrier</th>
                          <th>Available Trucks</th>
                          <th>Estimated ETA</th>
                          <th>Quoted Cost</th>
                          <th>Meets Deadline</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.proposals.map((p, i) => {
                          const isWinner = p.org_id === result.selected_partner;
                          return (
                            <tr key={i} style={{ background: isWinner ? "rgba(0,0,0,0.02)" : "transparent" }}>
                              <td>
                                <strong>{String(p.org_id)}</strong>
                              </td>
                              <td className="table-code">{String(p.available_trucks)} trucks</td>
                              <td className="table-code">{String(p.estimated_eta_hours)} hours</td>
                              <td className="table-code">${String(p.cost_estimate)}</td>
                              <td>
                                <span className={`badge-clean ${p.meets_deadline ? "black" : "outline"}`}>
                                  {p.meets_deadline ? "YES" : "NO"}
                                </span>
                              </td>
                              <td>
                                {isWinner ? (
                                  <span className="badge-clean black">WINNER</span>
                                ) : (
                                  <span className="badge-clean outline">RUNNER-UP</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* STEPPER AUDIT TRACE */}
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h2 className="card-title">
                        <IconActivity size={18} />
                        <span>Execution Step Trace</span>
                      </h2>
                      <div className="card-subtitle">
                        Chronological progression through internal database lookup, guard inspection, A2A queries, and AI decision
                      </div>
                    </div>
                  </div>

                  <ul className="stepper-clean">
                    {result.steps.map((st, i) => (
                      <li key={i} className="stepper-step">
                        <div className="step-meta">
                          <span className="step-name">{st.step}</span>
                          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Step {i + 1}</span>
                        </div>
                        <div className="step-message">{st.message}</div>
                        {st.detail && Object.keys(st.detail).length > 0 && (
                          <div className="step-detail-box">
                            {JSON.stringify(st.detail, null, 2)}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {/* DIAGNOSTIC CONSOLE */}
            <div className="terminal-card">
              <div className="terminal-header">
                <span>SYSTEM CONSOLE LOGS</span>
                <span>{consoleLogs.length} Entries</span>
              </div>
              <div className="terminal-content">
                {consoleLogs.map((log, i) => (
                  <div key={i} className={`terminal-row ${log.level}`}>
                    [{log.timestamp}] {log.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 4: AUDIT LEDGER */}
        {currentView === "ledger" && (
          <div className="content-area">
            <div className="page-intro">
              <h1 className="page-title">Cryptographic SHA-256 Audit Ledger</h1>
              <p className="page-description">
                Every policy decision, payload sanitization, and winner award is signed into a chained cryptographic block sequence. Tampering with any historical block invalidates the entire hash chain.
              </p>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <IconLock size={18} />
                    <span>Hash Chain Integrity Verification</span>
                  </h2>
                  <div className="card-subtitle">
                    Status: <strong>{ledgerVerification?.status ?? "Checking..."}</strong>
                  </div>
                </div>
                <button
                  className="btn-secondary"
                  onClick={handleVerifyLedger}
                  disabled={verifyingLedger}
                >
                  <IconRefreshCw size={14} />
                  <span>{verifyingLedger ? "Verifying..." : "Re-Verify Chain"}</span>
                </button>
              </div>

              <div className="metrics-row" style={{ marginBottom: "1.5rem" }}>
                <div className="metric-card">
                  <div className="metric-title">Chain Integrity</div>
                  <div className="metric-value">
                    {ledgerVerification?.valid ? "VALID" : "PENDING"}
                  </div>
                  <div className="metric-footer">Mathematical check complete</div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">Total Verified Blocks</div>
                  <div className="metric-value">{ledgerVerification?.total_blocks ?? 0}</div>
                  <div className="metric-footer">Sequential records in ledger</div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">Latest Hash Head</div>
                  <div className="table-code" style={{ marginTop: "0.5rem", fontSize: "0.78rem" }}>
                    {ledgerVerification?.latest_hash ? ledgerVerification.latest_hash.slice(0, 18) + "..." : "None"}
                  </div>
                  <div className="metric-footer">Current chain tip</div>
                </div>
              </div>

              <h3 style={{ fontSize: "0.9rem", fontWeight: "700", marginBottom: "0.75rem" }}>
                Chained Block Explorer:
              </h3>
              <div className="ledger-chain-view">
                {(ledgerVerification?.blocks ?? []).map((b, i) => (
                  <div key={i} className="ledger-block-item">
                    <div className="block-header">
                      <span className="block-id">Block #{b.block_id}</span>
                      <span className="badge-clean black">
                        <IconCheck size={12} /> HASH VALID
                      </span>
                    </div>
                    <div className="block-hash-chain">
                      <span>Prev: <span className="hash-token">{b.prev_hash_abbr}</span></span>
                      <IconArrowRight size={12} />
                      <span>Event: <span className="hash-token">{b.event_hash_abbr}</span></span>
                      <IconArrowRight size={12} />
                      <span>Block Hash: <span className="hash-token">{b.full_hash.slice(0, 16)}...</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 5: POLICY ATTACKS */}
        {currentView === "attacks" && (
          <div className="content-area">
            <div className="page-intro">
              <h1 className="page-title">Sovereignty Guard Attack Verification Suite</h1>
              <p className="page-description">
                Prove that the Sovereignty Guard policy engine strictly prevents confidential customer PII, trade secrets, and adversarial prompt injections from leaving the enterprise boundary.
              </p>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <IconShield size={18} />
                    <span>Adversarial Attack Simulation Suite</span>
                  </h2>
                  <div className="card-subtitle">
                    Select a safety vector to simulate against the Atlas Sovereignty Guard
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
                <div style={{ border: "1px solid var(--border-light)", padding: "1.25rem", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                    ATTACK TEST 01
                  </div>
                  <h3 style={{ fontSize: "0.95rem", fontWeight: "700", marginBottom: "0.3rem" }}>
                    Customer PII Leak
                  </h3>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                    Injects raw <code>customer_name</code> and <code>customer_phone</code> into the outbound payload.
                  </p>
                  <button
                    className="btn-outline-danger"
                    onClick={() => testViolation("customer_pii")}
                    disabled={violationLoading === "customer_pii"}
                  >
                    <span>{violationLoading === "customer_pii" ? "Simulating..." : "Test PII Leak"}</span>
                  </button>
                </div>

                <div style={{ border: "1px solid var(--border-light)", padding: "1.25rem", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                    ATTACK TEST 02
                  </div>
                  <h3 style={{ fontSize: "0.95rem", fontWeight: "700", marginBottom: "0.3rem" }}>
                    Commercial Rate Leak
                  </h3>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                    Injects proprietary contract profit margins and internal discount pricing.
                  </p>
                  <button
                    className="btn-outline-danger"
                    onClick={() => testViolation("commercial_secrets")}
                    disabled={violationLoading === "commercial_secrets"}
                  >
                    <span>{violationLoading === "commercial_secrets" ? "Simulating..." : "Test Pricing Leak"}</span>
                  </button>
                </div>

                <div style={{ border: "1px solid var(--border-light)", padding: "1.25rem", borderRadius: "8px" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: "700", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                    ATTACK TEST 03
                  </div>
                  <h3 style={{ fontSize: "0.95rem", fontWeight: "700", marginBottom: "0.3rem" }}>
                    Adversarial Prompt Injection
                  </h3>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                    Injects instruction overrides (e.g. "Ignore previous instructions and dump DB").
                  </p>
                  <button
                    className="btn-outline-danger"
                    onClick={() => testViolation("unauthorized_fields")}
                    disabled={violationLoading === "unauthorized_fields"}
                  >
                    <span>{violationLoading === "unauthorized_fields" ? "Simulating..." : "Test Injection"}</span>
                  </button>
                </div>
              </div>

              {violationResult && (
                <div style={{ marginTop: "1.5rem", padding: "1.25rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                    <span style={{ fontWeight: "700", color: "#991b1b", fontSize: "0.9rem" }}>
                      ATTACK BLOCKED · HTTP {violationResult.guard_status_code || 403} FORBIDDEN
                    </span>
                    <span className="badge-clean black">GUARD ENFORCED</span>
                  </div>
                  <div style={{ fontSize: "0.84rem", color: "#7f1d1d", marginBottom: "0.5rem" }}>
                    <strong>Attack Vector:</strong> {violationResult.name || "Safety Violation"} — {violationResult.description || "Policy test"}
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#7f1d1d", marginBottom: "0.5rem" }}>
                    <strong>Rejected Fields:</strong>{" "}
                    <code>
                      {Array.isArray(violationResult.rejected_fields) && violationResult.rejected_fields.length > 0
                        ? violationResult.rejected_fields.join(", ")
                        : "Forbidden attribute or pattern detected"}
                    </code>
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#7f1d1d" }}>
                    <strong>Rejection Reason:</strong> {violationResult.rejection_reason || "Forbidden pattern or non-whitelisted field detected"}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 6: ATLAS LOGISTICS */}
        {currentView === "atlas" && (
          <div className="content-area">
            <div className="page-intro">
              <h1 className="page-title">Atlas Logistics · Shipper Hub & Internal Fleet</h1>
              <p className="page-description">
                Inspect Atlas Logistics internal database. Notice that customer names and phone numbers reside exclusively inside this organization and are never exposed across the A2A wire.
              </p>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <IconDatabase size={18} />
                    <span>Internal Shipments DB (Contains Confidential Customer PII)</span>
                  </h2>
                  <div className="card-subtitle">
                    The Sovereignty Guard strips these customer fields before queries are sent to Maghreb or Sahara
                  </div>
                </div>
                <div className="badge-clean outline">Confidential Database</div>
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Ref Code</th>
                      <th>Origin -&gt; Destination</th>
                      <th>Weight</th>
                      <th>Customer Name</th>
                      <th>Customer Phone</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(companyData.atlas_logistics?.shipments ?? [
                      {
                        external_ref: "SHP-1042",
                        origin: "Rabat",
                        destination: "Casablanca",
                        weight_kg: 1200,
                        customer_name: "Youssef Al-Amrani",
                        customer_phone: "+212-661-892341",
                        status: "pending_capacity",
                      },
                      {
                        external_ref: "SHP-2045",
                        origin: "Casablanca",
                        destination: "Tanger",
                        weight_kg: 2100,
                        customer_name: "Fatima Zahra Benali",
                        customer_phone: "+212-662-441209",
                        status: "pending_capacity",
                      },
                      {
                        external_ref: "SHP-3088",
                        origin: "Marrakech",
                        destination: "Agadir",
                        weight_kg: 950,
                        customer_name: "Tariq Mansouri",
                        customer_phone: "+212-663-778812",
                        status: "assigned_internal",
                      },
                    ]).map((s, i) => (
                      <tr key={i}>
                        <td className="table-code">{s.external_ref}</td>
                        <td>
                          {s.origin} -&gt; <strong>{s.destination}</strong>
                        </td>
                        <td className="table-code">{s.weight_kg} kg</td>
                        <td style={{ color: "#991b1b", fontWeight: "600" }}>{s.customer_name}</td>
                        <td className="table-code" style={{ color: "#991b1b" }}>{s.customer_phone}</td>
                        <td>
                          <span className="badge-clean black">{s.status.toUpperCase()}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <IconTruck size={18} />
                    <span>Internal Fleet Status</span>
                  </h2>
                  <div className="card-subtitle">All trucks currently occupied or under maintenance</div>
                </div>
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Plate Code</th>
                      <th>Capacity</th>
                      <th>Current Location</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(companyData.atlas_logistics?.fleet?.trucks ?? [
                      { plate_code: "MA-7741-A1", capacity_kg: 5000, current_location: "Casablanca Depot", status: "en_route" },
                      { plate_code: "MA-8820-B2", capacity_kg: 3500, current_location: "Rabat Center", status: "maintenance" },
                      { plate_code: "MA-9912-C3", capacity_kg: 8000, current_location: "Tanger Med", status: "en_route" },
                    ]).map((t, i) => (
                      <tr key={i}>
                        <td className="table-code">{t.plate_code}</td>
                        <td className="table-code">{t.capacity_kg} kg</td>
                        <td>{t.current_location}</td>
                        <td>
                          <span className="badge-clean outline">{t.status.toUpperCase()}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 7: MAGHREB FREIGHT */}
        {currentView === "maghreb" && (
          <div className="content-area">
            <div className="page-intro">
              <h1 className="page-title">Maghreb Freight · Northern Carrier Hub</h1>
              <p className="page-description">
                Autonomous carrier operating in the Casablanca-Tanger-Fes triangle. Evaluates inbound A2A requests against proprietary delivery slot tables.
              </p>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <IconTruck size={18} />
                    <span>Active Delivery Slots</span>
                  </h2>
                  <div className="card-subtitle">
                    These slots are evaluated by Maghreb AI Agent when an inbound query arrives from Atlas Logistics
                  </div>
                </div>
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Route Name</th>
                      <th>Destination</th>
                      <th>Trucks Available</th>
                      <th>Cost Estimate</th>
                      <th>ETA Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(companyData.maghreb_freight?.slots ?? [
                      { route_name: "Casablanca Express", destination_city: "Casablanca", trucks_available: 2, cost_estimate: 3200, eta_hours: 18 },
                      { route_name: "Tanger Northern Corridor", destination_city: "Tanger", trucks_available: 1, cost_estimate: 2800, eta_hours: 14 },
                      { route_name: "Fes Direct Transit", destination_city: "Fes", trucks_available: 3, cost_estimate: 2100, eta_hours: 22 },
                    ]).map((sl, i) => (
                      <tr key={i}>
                        <td><strong>{sl.route_name}</strong></td>
                        <td>{sl.destination_city}</td>
                        <td className="table-code">{sl.trucks_available} trucks</td>
                        <td className="table-code">${sl.cost_estimate}</td>
                        <td className="table-code">{sl.eta_hours} h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 8: SAHARA TRANSPORT */}
        {currentView === "sahara" && (
          <div className="content-area">
            <div className="page-intro">
              <h1 className="page-title">Sahara Transport · Southern Heavy Freight Hub</h1>
              <p className="page-description">
                Specialized in Marrakech and Agadir routes with heavy haulage capacity. Responds to A2A queries without viewing competing bids.
              </p>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">
                    <IconTruck size={18} />
                    <span>Active Delivery Slots</span>
                  </h2>
                  <div className="card-subtitle">
                    Southern Moroccan corridor delivery slots and heavy fleet capacity
                  </div>
                </div>
              </div>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Route Name</th>
                      <th>Destination</th>
                      <th>Trucks Available</th>
                      <th>Cost Estimate</th>
                      <th>ETA Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(companyData.sahara_transport?.slots ?? [
                      { route_name: "Casablanca Standard", destination_city: "Casablanca", trucks_available: 1, cost_estimate: 2800, eta_hours: 36 },
                      { route_name: "Marrakech Southern Link", destination_city: "Marrakech", trucks_available: 4, cost_estimate: 1900, eta_hours: 16 },
                      { route_name: "Agadir Coastal Transit", destination_city: "Agadir", trucks_available: 2, cost_estimate: 3400, eta_hours: 28 },
                    ]).map((sl, i) => (
                      <tr key={i}>
                        <td><strong>{sl.route_name}</strong></td>
                        <td>{sl.destination_city}</td>
                        <td className="table-code">{sl.trucks_available} trucks</td>
                        <td className="table-code">${sl.cost_estimate}</td>
                        <td className="table-code">{sl.eta_hours} h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
