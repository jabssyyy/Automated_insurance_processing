# ClaimSense

Neutral AI middleware for Indian health-insurance claims — like UPI, it works across every insurer instead of taking a side. Built for TN-IMPACT 2026 by Team Seraphex.

## The problem

Around 17% of Indian health-insurance claims are rejected on administrative grounds, and patients face 7–8 hour discharge delays while hospitals and insurers pass paperwork back and forth. In early 2025, roughly 29,000 CMCHIS claims in Tamil Nadu were denied over spelling mismatches and late uploads.

## What it does

Three synced dashboards — patient, hospital staff, and insurer — over one claim pipeline:

- **Ingestion** — Gemini 2.0 Flash Vision reads uploaded documents directly. No OCR libraries.
- **Coverage engine** — each policy is parsed once into structured JSON, then deterministic Python decides pass/fail.
- **Adjudication** — final settlement calculation.
- **Review queue** — high-value or failed claims are routed to a human.
- **Live sync** — Server-Sent Events push every status change to all three dashboards at once.

## Core principle

The LLM never makes a coverage pass/fail decision. It reads; the rules decide. That keeps the money-path deterministic and free of hallucination risk.

## Stack

Gemini 2.0 Flash · FastAPI · PostgreSQL · Server-Sent Events · React · Twilio

## Compliance

Designed for Indian law — the DPDP Act 2023 and IRDAI regulations (not HIPAA).

## Status

Working MVP, demonstrated live at TN-IMPACT 2026 (KIT Coimbatore) across three synced screens. Demo mode uses pre-seeded accounts, no login required.

## Team

Team Seraphex — Anton Gilchrist A, Jabin Joseph M, Dev Arjun G.
Mentors: Ms. J. Christina and Mr. SriVatsava.
