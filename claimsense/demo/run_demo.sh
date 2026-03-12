#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# ClaimSense.ai — Demo Launch Script
# ═══════════════════════════════════════════════════════════════════════

set -e

echo "╔══════════════════════════════════════════════════╗"
echo "║         ClaimSense.ai — Demo Setup               ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── 1. Prerequisites ─────────────────────────────────────────────────
echo "1. Checking PostgreSQL..."
if pg_isready -q 2>/dev/null; then
    echo "   ✅ PostgreSQL is running"
else
    echo "   ⚠️  PostgreSQL not detected — make sure it's running"
fi

# ── 2. Generate sample documents ─────────────────────────────────────
echo ""
echo "2. Generating sample PDF documents..."
python -m demo.generate_pdfs

# ── 3. Seed demo data ────────────────────────────────────────────────
echo ""
echo "3. Seeding demo data..."
python -m demo.seed_data

# ── 4. Start backend ─────────────────────────────────────────────────
echo ""
echo "4. Starting backend..."
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
sleep 3
echo "   ✅ Backend running (PID: $BACKEND_PID)"

# ── 5. Start frontend ────────────────────────────────────────────────
echo ""
echo "5. Starting frontend..."
cd frontend && npm run dev &
FRONTEND_PID=$!
cd ..
sleep 3
echo "   ✅ Frontend running (PID: $FRONTEND_PID)"

# ── Ready ─────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║              DEMO READY!                         ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Open 3 browser tabs:"
echo "  Tab 1 → http://localhost:5173 → Click 'Patient'"
echo "  Tab 2 → http://localhost:5173 → Click 'Hospital Staff'"
echo "  Tab 3 → http://localhost:5173 → Click 'Insurer'"
echo ""
echo "═══════════════════════════════════════════════════"
echo " DEMO FLOW (~3 minutes):"
echo "═══════════════════════════════════════════════════"
echo ""
echo " 0:15 — On Patient tab: upload 4 docs:"
echo "         discharge_summary, hospital_bill, prescription, id_proof"
echo "         (DO NOT upload lab_report yet)"
echo ""
echo " 0:25 — All 3 screens update:"
echo "         'Documents missing: Lab Report'"
echo "         + WhatsApp notification sent"
echo ""
echo " 0:40 — On Patient tab: upload lab_report"
echo ""
echo " 0:50 — Screens update:"
echo "         'Documents complete' → 'Validating policy...'"
echo ""
echo " 1:10 — Patient sees coverage summary"
echo "         Hospital staff sees all docs green"
echo ""
echo " 1:20 — Insurer sees validation results"
echo "         Claim appears in Review Queue"
echo ""
echo " 1:40 — On Insurer tab: click 'Approve'"
echo ""
echo " 1:50 — All screens:"
echo "         'Assembling package' → 'Submitted' → 'Approved!'"
echo ""
echo " 2:00 — WhatsApp: 'Your claim has been approved!'"
echo ""
echo " 2:10 — Show Adjudicator Summary + FHIR package on Insurer screen"
echo ""
echo " 2:30 — On Patient tab: open chat, ask:"
echo "         'What is my co-pay?'  → get specific answer"
echo ""
echo " 2:45 — Done. Switch to Path A walkthrough slides."
echo ""
echo "═══════════════════════════════════════════════════"
echo ""
echo "Press Ctrl+C to stop all services."

# Wait for background processes
wait
