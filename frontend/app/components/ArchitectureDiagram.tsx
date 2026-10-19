"use client";

import React, { useState } from "react";
import {
  IconShield,
  IconDatabase,
  IconServer,
  IconCpu,
  IconLock,
  IconTruck,
  IconArrowRight,
  IconCheck,
} from "./Icons";

type ActiveNode =
  | "atlas"
  | "guard"
  | "wire"
  | "maghreb"
  | "sahara"
  | "coordinator"
  | "ledger"
  | null;

export function ArchitectureDiagram() {
  const [activeNode, setActiveNode] = useState<ActiveNode>("guard");

  return (
    <div className="architecture-container">
      {/* ─── DIAGRAM CANVAS ─── */}
      <div className="diagram-canvas">
        {/* ROW 1: PRIMARY TRANSIT PIPELINE */}
        <div className="diagram-grid">
          {/* NODE 1: ATLAS LOGISTICS (SHIPPER) */}
          <div
            className={`diagram-card ${activeNode === "atlas" ? "active" : ""}`}
            onClick={() => setActiveNode("atlas")}
          >
            <div className="diagram-card-badge">01 · ORIGIN</div>
            <div className="diagram-card-title">
              <IconServer size={16} />
              <span>Atlas Logistics</span>
            </div>
            <div className="diagram-card-sub">Shipper Hub · Port 8020</div>
            <div className="diagram-tag-list">
              <span className="diagram-tag private">Private Customer PII</span>
              <span className="diagram-tag">Local Fleet DB</span>
            </div>
            <div className="diagram-card-footer">
              Internal fleet capacity: 0 available
            </div>
          </div>

          {/* ARROW 1 */}
          <div className="diagram-connector">
            <div className="connector-line">
              <span className="connector-label">Outbound Intercept</span>
              <IconArrowRight size={14} />
            </div>
          </div>

          {/* NODE 2: SOVEREIGNTY GUARD (SECURITY PERIMETER) */}
          <div
            className={`diagram-card guard-node ${activeNode === "guard" ? "active" : ""}`}
            onClick={() => setActiveNode("guard")}
          >
            <div className="diagram-card-badge black">02 · SECURITY PERIMETER</div>
            <div className="diagram-card-title">
              <IconShield size={16} />
              <span>Sovereignty Guard</span>
            </div>
            <div className="diagram-card-sub">Policy Firewall · Port 8010</div>
            <div className="diagram-tag-list">
              <span className="diagram-tag highlight">PII Stripped</span>
              <span className="diagram-tag highlight">SHA-256 Signed</span>
            </div>
            <div className="diagram-card-footer">
              Zero-knowledge enforcement engine
            </div>
          </div>

          {/* ARROW 2 */}
          <div className="diagram-connector">
            <div className="connector-line">
              <span className="connector-label">Safe A2A Wire</span>
              <IconArrowRight size={14} />
            </div>
          </div>

          {/* NODE 3: A2A CARRIER PARTNERS */}
          <div
            className={`diagram-card ${activeNode === "maghreb" || activeNode === "sahara" ? "active" : ""}`}
            onClick={() => setActiveNode("maghreb")}
          >
            <div className="diagram-card-badge">03 · CARRIER MESH</div>
            <div className="diagram-card-title">
              <IconTruck size={16} />
              <span>Partner Carriers</span>
            </div>
            <div className="diagram-card-sub">A2A Endpoints · Ports 8021 / 8022</div>
            <div className="diagram-tag-list">
              <span className="diagram-tag">Maghreb Freight</span>
              <span className="diagram-tag">Sahara Transport</span>
            </div>
            <div className="diagram-card-footer">
              Autonomous slot quotes & ETAs
            </div>
          </div>
        </div>

        {/* CONNECTOR DIVIDER */}
        <div className="diagram-mid-flow">
          <div className="flow-vertical-arrow">
            <span>Bids Transmitted to Coordinator</span>
            <svg width="12" height="24" viewBox="0 0 12 24" fill="none" stroke="currentColor">
              <path d="M6 0v20M1 15l5 5 5-5" strokeWidth="1.5" />
            </svg>
          </div>
        </div>

        {/* ROW 2: INTELLIGENCE & AUDIT PILLARS */}
        <div className="diagram-lower-grid">
          {/* NODE 4: COORDINATOR & AI REASONING */}
          <div
            className={`diagram-card ${activeNode === "coordinator" ? "active" : ""}`}
            onClick={() => setActiveNode("coordinator")}
          >
            <div className="diagram-card-badge">04 · AUTONOMOUS ARBITRATION</div>
            <div className="diagram-card-title">
              <IconCpu size={16} />
              <span>Coordinator & OpenRouter AI</span>
            </div>
            <div className="diagram-card-sub">A2A Broker & LLM Gateway · Port 8000</div>
            <p className="diagram-card-desc">
              Evaluates partner bids across ETA, deadline feasibility, capacity redundancy, and cost. Uses constrained structured JSON generation.
            </p>
          </div>

          {/* NODE 5: IMMUTABLE AUDIT LEDGER */}
          <div
            className={`diagram-card ${activeNode === "ledger" ? "active" : ""}`}
            onClick={() => setActiveNode("ledger")}
          >
            <div className="diagram-card-badge">05 · TAMPER-EVIDENT AUDIT</div>
            <div className="diagram-card-title">
              <IconLock size={16} />
              <span>SHA-256 Hash Chain Ledger</span>
            </div>
            <div className="diagram-card-sub">PostgreSQL Audit DB · Port 5432</div>
            <p className="diagram-card-desc">
              Every sanitize action and winning allocation is cryptographically hashed with its preceding block. Mathematically prevents retrospective tampering.
            </p>
          </div>
        </div>
      </div>

      {/* ─── NODE DEEP-DIVE INSPECTOR (CLICKABLE DETAILS) ─── */}
      <div className="node-detail-panel">
        <div className="node-detail-header">
          <span className="node-detail-kicker">Interactive Component Deep-Dive</span>
          <div className="node-quick-pills">
            <button
              className={`pill-btn ${activeNode === "atlas" ? "active" : ""}`}
              onClick={() => setActiveNode("atlas")}
            >
              Atlas Logistics
            </button>
            <button
              className={`pill-btn ${activeNode === "guard" ? "active" : ""}`}
              onClick={() => setActiveNode("guard")}
            >
              Sovereignty Guard
            </button>
            <button
              className={`pill-btn ${activeNode === "maghreb" ? "active" : ""}`}
              onClick={() => setActiveNode("maghreb")}
            >
              Maghreb Freight
            </button>
            <button
              className={`pill-btn ${activeNode === "sahara" ? "active" : ""}`}
              onClick={() => setActiveNode("sahara")}
            >
              Sahara Transport
            </button>
            <button
              className={`pill-btn ${activeNode === "coordinator" ? "active" : ""}`}
              onClick={() => setActiveNode("coordinator")}
            >
              AI Coordinator
            </button>
            <button
              className={`pill-btn ${activeNode === "ledger" ? "active" : ""}`}
              onClick={() => setActiveNode("ledger")}
            >
              Audit Ledger
            </button>
          </div>
        </div>

        <div className="node-detail-body">
          {activeNode === "atlas" && (
            <div className="detail-content">
              <h4>Atlas Logistics (Shipper Hub & Demand Origin)</h4>
              <p>
                Atlas is the originating logistics enterprise. When an urgent order (e.g. <code>SHP-1042</code> to Casablanca) arrives and all internal trucks are occupied, Atlas must find partner capacity.
              </p>
              <div className="detail-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Data Category</th>
                      <th>Perimeter Rule</th>
                      <th>Technical Safeguard</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Customer Name & Phone</td>
                      <td><strong>Strictly Forbidden</strong></td>
                      <td>Stripped at Guard boundary; never transmitted</td>
                    </tr>
                    <tr>
                      <td>Internal Profit Margin</td>
                      <td><strong>Private to Atlas</strong></td>
                      <td>Stored only in <code>atlas_logistics</code> DB</td>
                    </tr>
                    <tr>
                      <td>Destination & Weight</td>
                      <td><strong>Permitted (Sanitized)</strong></td>
                      <td>Included in A2A Assist query payload</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeNode === "guard" && (
            <div className="detail-content">
              <h4>Atlas Sovereignty Guard (Zero-Trust Security Perimeter)</h4>
              <p>
                The Guard is an authoritative, standalone security proxy running on Port 8010. No outbound packet leaves Atlas Logistics without passing the Guard policy engine (<code>atlas_outbound.yaml</code>).
              </p>
              <div className="detail-feature-grid">
                <div className="detail-feat">
                  <div className="feat-title">
                    <IconCheck size={14} /> Schema Filtering
                  </div>
                  <div className="feat-desc">
                    Only whitelisted fields (<code>shipment_ref</code>, <code>destination</code>, <code>weight_kg</code>, <code>deadline</code>) are permitted.
                  </div>
                </div>
                <div className="detail-feat">
                  <div className="feat-title">
                    <IconCheck size={14} /> Adversarial Injection Defense
                  </div>
                  <div className="feat-desc">
                    Regex pattern filters detect attempted prompt injections, credit cards, or customer phone numbers.
                  </div>
                </div>
                <div className="detail-feat">
                  <div className="feat-title">
                    <IconCheck size={14} /> Cryptographic Proof
                  </div>
                  <div className="feat-desc">
                    Generates a SHA-256 fingerprint of the sanitized payload and anchors it to the ledger before dispatch.
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeNode === "maghreb" && (
            <div className="detail-content">
              <h4>Maghreb Freight (Independent Northern Carrier Partner)</h4>
              <p>
                Maghreb Freight operates its own isolated agent and fleet database. When queried via the standardized A2A protocol (<code>POST /a2a/v1/assist/query</code>), Maghreb calculates available delivery slots autonomously.
              </p>
              <div className="detail-code-snippet">
                <code>
                  {`// Maghreb A2A Agent Card: /.well-known/agent.json
{
  "name": "Maghreb Freight Agent",
  "protocol": "a2a/1.0",
  "skills": ["assist_query", "fleet_capacity"],
  "specialty": "Northern Corridor (Casablanca, Tanger, Rabat)"
}`}
                </code>
              </div>
            </div>
          )}

          {activeNode === "sahara" && (
            <div className="detail-content">
              <h4>Sahara Transport (Independent Southern Carrier Partner)</h4>
              <p>
                Sahara Transport specializes in heavy haulage and southern Moroccan routes (Marrakech, Agadir). It receives identical sanitized query schemas from the Coordinator and bids independently without seeing competitor quotes.
              </p>
              <div className="detail-code-snippet">
                <code>
                  {`// Sahara A2A Agent Card: /.well-known/agent.json
{
  "name": "Sahara Transport Agent",
  "protocol": "a2a/1.0",
  "skills": ["assist_query", "fleet_capacity"],
  "specialty": "Southern Corridor (Marrakech, Agadir, Ouarzazate)"
}`}
                </code>
              </div>
            </div>
          )}

          {activeNode === "coordinator" && (
            <div className="detail-content">
              <h4>Sovereign Coordinator & OpenRouter AI Reasoning</h4>
              <p>
                The Coordinator coordinates the A2A handshake and dispatches proposal candidates to the OpenRouter LLM reasoning engine (Google Gemini 2.0 Flash / Claude / Llama).
              </p>
              <div className="detail-feature-grid">
                <div className="detail-feat">
                  <div className="feat-title">Multi-Attribute Ranking</div>
                  <div className="feat-desc">
                    Weights deadline compliance (non-negotiable), delivery speed (ETA), truck redundancy, and financial cost.
                  </div>
                </div>
                <div className="detail-feat">
                  <div className="feat-title">Deterministic Fallback</div>
                  <div className="feat-desc">
                    If external AI APIs experience latency or rate limits, the Coordinator transparently falls back to an algorithmic scoring formula.
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeNode === "ledger" && (
            <div className="detail-content">
              <h4>Cryptographic SHA-256 Chained Audit Ledger</h4>
              <p>
                Unlike standard application logs that can be edited in a database, every transaction in this network is hashed into a sequential cryptographic block chain:
              </p>
              <div className="detail-code-snippet">
                <code>
                  {`Block #12: prev_hash = "90a4...f1" -> payload_hash = "64b1...e8" -> block_hash = "2c19...40"
Block #13: prev_hash = "2c19...40" -> payload_hash = "8e92...11" -> block_hash = "5f3a...d9"`}
                </code>
              </div>
              <p className="detail-note">
                Any retroactive alteration of an earlier record invalidates all subsequent block hashes, giving auditors instantaneous proof of tampering.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
