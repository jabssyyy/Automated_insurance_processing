# ClaimSense.ai

> AI-powered neutral middleware for Indian health insurance claims.
> Built for TN-IMPACT 2026 · Team Seraphex · Problem Statement TNI26085

---

## The Problem

Indian health insurance claims are broken in three specific ways:

- **17% of claims are administratively rejected** — not because the patient wasn't covered, but because of wrong codes, missing documents, or unchecked policy rules.
- **7–8 hour discharge delays** — patients are clinically ready to leave, but paperwork gets assembled on discharge day itself. Everything is rushed, things are missed.
- **10–15% of claim payouts are lost to fraud annually** — mostly organised syndicates operating across multiple insurers. No single insurer can see the full picture.

Root cause: the claims pipeline has zero intelligence built in. It's entirely reactive. ClaimSense.ai makes it proactive — for hospitals, patients, and insurers simultaneously.

---

## What ClaimSense.ai Does

ClaimSense.ai is a **neutral middleware layer** — like UPI for payments. It sits between hospitals, patients, and insurers, and every party benefits from it existing.

- **Documents are understood** the moment they arrive (not after rejection)
- **Policy rules are checked** before submission (not after denial)
- **Fraud is detected** before payout (not after the money is gone)

---

## Architecture

```
Path A (Hospital / Cashless)            Path B (Patient / Reimbursement)
        │                                          │
  Pre-Authorization                       Document Upload
   (Day 0, automatic)                             │
        │                                  Early Doc Check
        │                                   (Path B only)
        └──────────────┬───────────────────────────┘
                       │
                  M1 — DocTriage
            (Gemini 2.0 Flash → Claim JSON)
                       │
               M2 — Policy &
               Medical Validation
               Engine (deterministic)
                       │
              Human Review Queue
              (triggered on flags)
                       │
          M3 — Clean Claim Guarantee
            (Adjudicator Summary +
             FHIR R4 Packaging)
                       │
            FHIR R4 API Submission
                       │
           IRDAI 3-Hour Monitor ←── Path A only
```

**Designed but not in current demo scope:**
- **M4 — Fraud Graph Network** — Neo4j cross-insurer relationship graph + Isolation Forest anomaly scoring. Detects 5 fraud patterns across insurers. Requires real multi-insurer data to demonstrate live; architecture is fully designed and ready for implementation.

Every stage feeds the **Status Dashboard** (real-time via SSE) and triggers **WhatsApp/SMS notifications**.

Three role-based views run simultaneously: Patient, Hospital Staff, Insurer Team.

---

## Modules

| Module | What It Does |
|--------|-------------|
| **M1 — DocTriage** | Gemini 2.0 Flash reads any document format (PDF, scanned, handwritten, regional languages) → structured Claim JSON |
| **Early Doc Check** | Catches missing documents immediately after upload, before any downstream processing (Path B only) |
| **M2 — Policy & Medical Validation** | ICD-10 code integrity check + deterministic Python policy rule validation. No LLM on pass/fail decisions. |
| **Human Review Queue** | Governance layer — flagged claims require human approval before submission |
| **M3 — Clean Claim Guarantee** | Adjudicator Summary generation + FHIR R4 package assembly for API submission |
| **Status Dashboard** | Real-time mirror of claim state at every pipeline stage, via SSE |
| **Conversational Assistant** | Gemini-powered chat grounded in Claim JSON — answers are specific to the claim, not generic |
| **Notifications** | WhatsApp (primary) → SMS (fallback) → in-app panel (last resort) on every status change |
| **RBAC** | Role-based access control — Patient, Hospital Staff, Insurer Team, Admin views |

**Designed for production:**
| **M4 — Fraud Graph** | Neo4j cross-insurer graph + Isolation Forest anomaly scoring. Five fraud patterns detected. |

---

## Key Design Decisions

**Gemini 2.0 Flash for all AI tasks.** Single model handles document vision (PDFs, scans, handwriting, Tamil/Hindi), policy parsing, summary generation, and conversational assistant. One API, no OCR library dependencies.

**No LLM on coverage decisions.** M2 uses pure Python if-else logic for every pass/fail coverage check. LLMs hallucinate — a wrong coverage decision has real financial and regulatory consequences. Gemini is used only for reading documents, parsing policies, and writing human-readable summaries.

**Neutral middleware positioning.** Not an insurer tool, not a hospital tool, not a patient app. A neutral pipe everyone runs through. This is the only architecture that makes cross-insurer fraud detection possible — no single insurer can see patterns across multiple insurers simultaneously.

**IRDAI 3-hour auto-escalation.** IRDAI Circular 2016 mandates insurers respond to cashless claims within 3 hours. ClaimSense auto-escalates to the regulator if they don't — first automated enforcement of this regulation.

**SSE for real-time sync.** Server-Sent Events push status updates to all connected clients (patient, hospital, insurer screens) simultaneously. Simpler than WebSockets, perfect for one-directional server→client updates.

**Notification priority chain.** WhatsApp first (near-universal in India), SMS if WhatsApp fails, in-app panel only as last resort.

---

## Compliance & Governance

- **AES-256 encryption at rest** for all claims data, medical documents, and audit logs
- **Immutable audit logs** for every automated action — OCR decisions, policy checks, human reviews — all traceable with timestamps
- **IRDAI compliance** — 3-hour cashless window enforced and auto-escalated
- **Role-Based Access Control** on every user-facing output
- **TLS 1.3 in transit** — scoped for production deployment

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python FastAPI |
| LLM | Gemini 2.0 Flash (google-generativeai) |
| Database | PostgreSQL + SQLAlchemy |
| Notifications | Twilio (WhatsApp primary → SMS fallback) + in-app last resort |
| Real-time | SSE (Server-Sent Events) |
| FHIR | fhir.resources |
| Frontend | React + Tailwind CSS |
| Encryption | AES-256 (cryptography library) |
| Auth | JWT (python-jose) |

---

## Getting Started

### Prerequisites
- Python 3.11+
- PostgreSQL running locally
- Node.js 18+ (for frontend)

### Setup

```bash
# Clone the repo
git clone https://github.com/jabssyyy/Automated_insurance_processing.git
cd Automated_insurance_processing

# Install Python dependencies
cd claimsense
pip install -r requirements.txt

# Copy environment variables
cp .env.example .env
# Fill in your API keys in .env

# Start the backend
uvicorn main:app --reload

# Start the frontend (separate terminal)
cd frontend
npm install
npm run dev
```

### Environment Variables

```
GEMINI_API_KEY=
DATABASE_URL=postgresql+asyncpg://user:password@localhost/claimsense
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
TWILIO_SMS_FROM=
JWT_SECRET=
ENCRYPTION_KEY=
```

---

## Demo Flow

**Three screens run simultaneously** — Patient view, Hospital view, Insurer view.

**Path B (live demo, ~3 minutes):**

1. Patient uploads medical documents — one deliberately missing
2. Early Doc Check catches it → WhatsApp notification fires → all 3 screens update
3. Patient uploads the missing document → claim proceeds
4. Status Dashboard updates live across all screens through each stage
5. M2 shows coverage: what's covered, what's excluded, exact co-pay amount
6. Claim enters Human Review Queue on insurer screen (high-value claim trigger)
7. Insurer approves → M3 generates Adjudicator Summary → FHIR R4 package assembled
8. Claim submitted → approval notification on WhatsApp + all screens update

**Path A (walkthrough):** Pre-authorization flow, IRDAI 3-hour monitor, discharge workflow.

---

## Project Structure

```
claimsense/
├── shared/             # Claim schema, DB models, audit logger, config
├── auth/               # JWT + RBAC middleware
├── m1/                 # DocTriage — Gemini Vision extraction
├── doc_check/          # Early document completeness check
├── m2/                 # Policy + medical validation engine
├── review/             # Human review queue
├── m3/                 # Clean Claim Guarantee + FHIR packaging
├── notifications/      # Twilio WhatsApp + SMS + in-app fallback
├── dashboard/          # Status dashboard backend + SSE
├── assistant/          # Conversational assistant
├── data/               # ICD-10 codes, policy samples, synthetic claims
├── frontend/           # React + Tailwind UI (3 role-based views)
├── main.py             # FastAPI app entry point
├── requirements.txt
└── .env.example
```

---

## Innovation Highlights

- **M4 Fraud Graph Network** *(designed, production-ready architecture)* — Neo4j cross-insurer relationship graph with 5 fraud pattern detectors and Isolation Forest anomaly scoring. Requires multi-insurer data partnerships to deploy.
- **Federated Fraud Detection** *(roadmap)* — Each insurer trains locally, only model gradients shared. Cross-insurer intelligence without raw data leaving any insurer's servers.
- **Real-Time Clinical Coding Assist** *(roadmap)* — ICD-10 suggestions as doctors write notes during admission, confirmed throughout the stay instead of rushed at discharge.
- **Per-Insurer Denial Prediction** *(roadmap)* — Rejection probability before submission with specific fix recommendations, trained on each insurer's historical patterns.

---

## Team

**Seraphex** — TN-IMPACT 2026, KIT Coimbatore, 14 March 2026

- Anton
- Jabin Joseph M
- Dev Arjun G

Mentor: Mr. SriVatsava
Problem Statement: TNI26085 — FinTech and Insurance

---

## License

Built for TN-IMPACT 2026 Hackathon. All rights reserved by Team Seraphex.
