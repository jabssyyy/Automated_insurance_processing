"""
Generate Sample PDF Documents for ClaimSense.ai Demo.

Run standalone:  python -m demo.generate_pdfs
  (from the claimsense/ directory)

Creates 5 sample medical documents in data/sample_documents/:
  1. sample_discharge_summary.pdf
  2. sample_hospital_bill.pdf
  3. sample_prescription.pdf
  4. sample_id_proof.pdf
  5. sample_lab_report.pdf   ← intentionally NOT uploaded first in demo
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure importable when run as script
sys.path.insert(0, ".")

try:
    from fpdf import FPDF
except ImportError:
    print("ERROR: fpdf2 is required.  Install it:  pip install fpdf2")
    sys.exit(1)

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data" / "sample_documents"


def _make_pdf(filename: str, title: str, lines: list[str]) -> None:
    """Build a simple single-page text PDF."""
    pdf = FPDF()
    pdf.add_page()

    # Title
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 12, title, new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(4)

    # Horizontal rule
    pdf.set_draw_color(100, 100, 100)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(6)

    # Body
    pdf.set_font("Helvetica", "", 11)
    for line in lines:
        if line.startswith("##"):
            pdf.ln(3)
            pdf.set_font("Helvetica", "B", 12)
            pdf.cell(0, 8, line.lstrip("# "), new_x="LMARGIN", new_y="NEXT")
            pdf.set_font("Helvetica", "", 11)
        elif line == "---":
            pdf.ln(2)
            pdf.line(10, pdf.get_y(), 200, pdf.get_y())
            pdf.ln(4)
        else:
            if line.strip() == "":
                pdf.ln(4)
            else:
                pdf.cell(0, 7, text=line, new_x="LMARGIN", new_y="NEXT")

    output_path = OUTPUT_DIR / filename
    pdf.output(str(output_path))
    print(f"  Created: {output_path}")


def generate_all() -> None:
    """Generate all 5 sample PDFs."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── 1. Discharge Summary ──────────────────────────────────────────
    _make_pdf(
        "sample_discharge_summary.pdf",
        "DISCHARGE SUMMARY",
        [
            "## Patient Information",
            "Patient Name:  Rajesh Kumar",
            "Date of Birth: 15-03-1985",
            "Gender:        Male",
            "Patient ID:    PAT-2026-0042",
            "",
            "## Hospital Details",
            "Hospital:      Apollo Hospitals, Chennai",
            "Hospital ID:   HOSP-KIT-001",
            "",
            "## Admission Details",
            "Date of Admission:  10-03-2026",
            "Date of Discharge:  14-03-2026",
            "Duration:           4 days",
            "",
            "## Diagnosis",
            "Primary Diagnosis: Acute myocardial infarction, anterior wall",
            "ICD-10 Code:       I21.0",
            "",
            "## Procedure Performed",
            "Procedure:         Percutaneous coronary intervention (Angioplasty)",
            "Procedure Code:    0270346 (ICD-10-PCS)",
            "",
            "## Treating Doctor",
            "Doctor Name:               Dr. Suresh Mehta",
            "Registration Number:       TN-MED-2005-1234",
            "Department:                Cardiology",
            "",
            "## Clinical Summary",
            "Patient presented to the Emergency Department on 10-03-2026 with",
            "severe chest pain radiating to the left arm. ECG showed ST elevation",
            "in leads V1-V4. Troponin I was elevated at 12.5 ng/mL. Patient was",
            "diagnosed with acute anterior wall myocardial infarction (STEMI).",
            "",
            "Emergency percutaneous coronary intervention (PCI) was performed.",
            "A drug-eluting stent was placed in the LAD artery with excellent",
            "angiographic result. Post-procedure, the patient was monitored in",
            "the ICU for 24 hours and subsequently shifted to the ward.",
            "",
            "Patient recovered well and was discharged in stable condition on",
            "14-03-2026 with follow-up instructions and medications.",
            "---",
            "Digitally signed by Dr. Suresh Mehta | Date: 14-03-2026",
        ],
    )

    # ── 2. Hospital Bill ──────────────────────────────────────────────
    _make_pdf(
        "sample_hospital_bill.pdf",
        "HOSPITAL BILL / INVOICE",
        [
            "## Bill Details",
            "Bill No:       BILL-2026-78432",
            "Patient Name:  Rajesh Kumar",
            "Hospital:      Apollo Hospitals, Chennai",
            "Admission:     10-03-2026  |  Discharge: 14-03-2026",
            "",
            "## Itemized Charges",
            "---",
            "Room charges (4 days x Rs. 4,500/day) ........... Rs. 18,000",
            "ICU charges (1 day x Rs. 9,000/day)  ............ Rs.  9,000",
            "Operation Theatre charges  ...................... Rs. 45,000",
            "Medicines & consumables  ........................ Rs. 25,000",
            "Diagnostics (ECG, Echo, Blood tests) ............ Rs. 15,000",
            "Doctor consultation fees  ....................... Rs.  8,000",
            "---",
            "",
            "## Total Amount",
            "GRAND TOTAL:  Rs. 1,20,000  (Rupees One Lakh Twenty Thousand Only)",
            "",
            "## Payment Details",
            "Payment Mode:  Insurance Claim (Reimbursement)",
            "Policy No:     STAR-HEALTH-2025-001",
            "Insurer:       Star Health Insurance",
            "---",
            "Certified that the above charges are correct.",
            "Billing Department | Apollo Hospitals, Chennai",
        ],
    )

    # ── 3. Prescription ───────────────────────────────────────────────
    _make_pdf(
        "sample_prescription.pdf",
        "MEDICAL PRESCRIPTION",
        [
            "## Doctor Information",
            "Dr. Suresh Mehta, MD (Cardiology)",
            "Reg No: TN-MED-2005-1234",
            "Apollo Hospitals, Chennai",
            "",
            "## Patient",
            "Name: Rajesh Kumar        Age: 40 years        Gender: Male",
            "Date: 14-03-2026",
            "",
            "## Post-Angioplasty Medications",
            "---",
            "1. Tab. Aspirin 75 mg        - Once daily (morning, after food)",
            "2. Tab. Clopidogrel 75 mg     - Once daily (morning, after food)",
            "3. Tab. Atorvastatin 40 mg    - Once daily (at bedtime)",
            "4. Tab. Metoprolol 25 mg      - Twice daily (morning & evening)",
            "5. Tab. Ramipril 2.5 mg       - Once daily (morning)",
            "6. Tab. Pantoprazole 40 mg    - Once daily (before breakfast)",
            "---",
            "",
            "## Instructions",
            "- Continue dual antiplatelet therapy for at least 12 months",
            "- Low-salt, low-fat cardiac diet",
            "- Avoid strenuous activity for 6 weeks",
            "- Follow-up visit in 2 weeks with repeat ECG and blood work",
            "- Report immediately if chest pain, breathlessness, or palpitations",
            "",
            "Dr. Suresh Mehta | Digitally signed",
        ],
    )

    # ── 4. ID Proof ───────────────────────────────────────────────────
    _make_pdf(
        "sample_id_proof.pdf",
        "IDENTITY PROOF - AADHAAR CARD",
        [
            "## Aadhaar Details (Mock)",
            "---",
            "Name:             Rajesh Kumar",
            "Date of Birth:    15-03-1985",
            "Gender:           Male",
            "Aadhaar Number:   XXXX-XXXX-4832",
            "",
            "Address:",
            "42, Greenfield Apartments,",
            "Anna Nagar West,",
            "Chennai - 600040,",
            "Tamil Nadu",
            "---",
            "",
            "This is a mock document for demonstration purposes only.",
            "No real Aadhaar data is used.",
        ],
    )

    # ── 5. Lab Report (intentionally NOT uploaded first in demo) ──────
    _make_pdf(
        "sample_lab_report.pdf",
        "LABORATORY REPORT",
        [
            "## Patient Information",
            "Patient Name:  Rajesh Kumar",
            "Age/Gender:    40 years / Male",
            "Sample Date:   10-03-2026",
            "Report Date:   10-03-2026",
            "",
            "## Hematology",
            "---",
            "Hemoglobin:       13.2 g/dL     (Normal: 13-17)",
            "WBC Count:        8,500 /cumm    (Normal: 4000-11000)",
            "Platelet Count:   2.1 Lakhs     (Normal: 1.5-4.0)",
            "---",
            "",
            "## Cardiac Markers",
            "---",
            "Troponin I:       12.5 ng/mL    (Normal: <0.04)     ** HIGH **",
            "CK-MB:            85 U/L        (Normal: <25)       ** HIGH **",
            "BNP:              320 pg/mL     (Normal: <100)      ** HIGH **",
            "---",
            "",
            "## Biochemistry",
            "---",
            "Blood Sugar (F):  102 mg/dL     (Normal: 70-110)",
            "Serum Creatinine: 0.9 mg/dL     (Normal: 0.7-1.3)",
            "Total Cholesterol: 242 mg/dL    (Normal: <200)      ** HIGH **",
            "LDL Cholesterol:  168 mg/dL     (Normal: <100)      ** HIGH **",
            "HDL Cholesterol:  38 mg/dL      (Normal: >40)       ** LOW **",
            "Triglycerides:    180 mg/dL     (Normal: <150)      ** HIGH **",
            "---",
            "",
            "## Interpretation",
            "Elevated cardiac markers (Troponin I, CK-MB) consistent with",
            "acute myocardial infarction. Deranged lipid profile noted.",
            "",
            "Reported by: Dr. Meera Krishnan, MD (Pathology)",
        ],
    )

    print("\nAll 5 sample PDFs generated successfully!")


if __name__ == "__main__":
    print("=== Generating ClaimSense.ai Sample Documents ===\n")
    generate_all()
