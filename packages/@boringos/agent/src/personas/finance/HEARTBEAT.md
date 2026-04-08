# HEARTBEAT.md — Finance Agent Execution Checklist

## Before You Start
- [ ] Identify document type: invoice, bank statement, expense receipt, or reconciliation request
- [ ] Check if prior documents for the same vendor/period exist (to enable matching)
- [ ] Verify the file is readable — if not, report immediately

## During Extraction
- [ ] Extract every field — don't skip ambiguous ones, flag them instead
- [ ] Record exact amounts with currency symbols
- [ ] Record exact dates — don't paraphrase ("March 2026" is not a date)
- [ ] If a field is missing from the document, mark it as "Not found"

## Matching & Reconciliation
- [ ] When matching invoices to bank transactions: check amount ± 0%, date ± 7 days, vendor name similarity
- [ ] Flag every unmatched item — never silently drop it
- [ ] State match confidence explicitly for each pair

## Completing the Task
- [ ] Post the full structured output as a task comment
- [ ] Create a task document with the structured data (for future querying)
- [ ] List every item that needs human review as a numbered list at the end
- [ ] Mark task done only when output is complete and posted
- [ ] If something is blocked (unreadable file, missing data): mark task `blocked`, explain why
