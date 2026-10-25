# Governed AI-assisted arrangement intake

Retrieva treats AI output as a draft, never as an accountable decision. An arrangement proposed
from a contract enters this workflow:

```text
AI draft → maker submits → checker validates → business owner approves → arrangement materialises
```

The three actors must be different people. The maker needs `arrangement:create`, the checker needs
`arrangement:check`, and the approver needs `arrangement:approve`. In the v1 capability map those
responsibilities normally map to `analyst`, `ict_risk_officer`, and `business_owner` respectively.

## API workflow

1. `POST /api/v1/arrangements/intake/confirm` submits the edited draft. It returns `202` and a
   proposal in `submitted`; it does **not** create an arrangement.
2. `POST /api/v1/arrangements/intake/proposals/:id/check` records the independent checker decision.
3. `POST /api/v1/arrangements/intake/proposals/:id/approve` records the accountable approver
   decision. An `approve` decision materialises the authoritative arrangement.
4. A checker or approver can use `request_changes`. The original maker then calls
   `POST /api/v1/arrangements/intake/proposals/:id/resubmit` with the revised proposal.

Decision bodies contain `expectedVersion`, `decision` (`approve`, `reject`, or `request_changes`),
and a non-empty `justification`. Version mismatch returns `409`, preventing a decision against a
proposal that changed after it was reviewed.

`GET /api/v1/arrangements/intake/proposals` lists the review inbox and accepts an optional `status`
query. `GET /api/v1/arrangements/intake/proposals/:id` returns the full decision record.

## Audit and authority boundary

The durable record stores AI provenance, the edited proposal, maker/checker/approver identities,
timestamps, justifications, row version, and the resulting arrangement ID. Every transition is
written to the immutable audit log. Register and assessment consumers see an arrangement only after
final approval and materialisation.

Bulk estate migration and internal tool-evaluation services use the lower-level materialisation
service because they have their own explicit control context. They must not expose that service as
an end-user substitute for this workflow.
