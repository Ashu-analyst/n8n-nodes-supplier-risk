# n8n-nodes-supplier-risk

An **n8n community node written in TypeScript**. It scores suppliers for due-diligence risk and returns a 0–100 score, a risk band and an approval route. You drop it into any onboarding workflow (CRM webhook → score → route to auto-approve, Category Manager or Compliance Committee).

The scoring model is the same one as in the [Supplier Compliance RAG Assistant](../supplier-compliance-rag) knowledge base, so the two projects work together.

## Why a custom node instead of a Code node?

| Code node | Custom node |
|---|---|
| Logic copied into every workflow | One versioned package, used by every workflow |
| No tests | 10 unit tests + CI |
| Anyone can edit it in the UI | Changes go through review and a release |
| No UI for parameters | Business users map fields in a form |

Once the same logic shows up in 3+ workflows, it should become a node.

## What it does

| Component | Weight | Rule |
|---|---|---|
| Country risk | 30% | 0–100 index for the country of production |
| Category risk | 25% | Lookup table (raw materials 90 … software 10); unknown category → 50 + warning |
| Questionnaire (SAQ) | 25% | `100 − SAQ score`; a missing SAQ counts as worst case + warning |
| Adverse media | 20% | Verified negative news items in 24 months, capped at 5 |
| Override | ± | Compliance officer, limited to ±15 points + warning |

Bands: **Low** < 40 → `auto-approve` · **Medium** 40–69 → `category-manager` · **High** ≥ 70 → `compliance-committee`.

Sample run (`examples/sample_suppliers.json`):

```
SUP-001    6.9 Low     auto-approve
SUP-002   31.5 Low     auto-approve
SUP-003   66.4 Medium  category-manager
SUP-004   85.1 High    compliance-committee
```

## Design decisions

- **Pure logic separate from the n8n wrapper** (`src/riskScore.ts` vs `nodes/…/SupplierRisk.node.ts`). The scoring can be tested without n8n and reused elsewhere (API, batch job, or ported to Zoho Deluge).
- **Configurable field mapping**: the node reads whatever field names the upstream CRM uses, so no renaming step is needed.
- **Fails safe**: missing data increases risk, it never hides it. Every assumption is returned in `warnings`, so it's visible in the workflow output.
- **Respects "Continue On Fail"**: one bad record in a batch of 500 doesn't stop the run. The error is written onto that item.
- **`pairedItem`** is set, so n8n can trace each output back to its input.

## Develop

```bash
npm install
npm test          # compiles TypeScript and runs node:test (10 tests)
npm run build
```

Install it in a self-hosted n8n:

```bash
npm run build && npm pack
# in your n8n custom folder (~/.n8n/custom or N8N_CUSTOM_EXTENSIONS):
npm install /path/to/n8n-nodes-supplier-risk-0.1.0.tgz
# restart n8n → search "Supplier Risk Score" in the node panel
```

Then import `examples/onboarding_workflow.json` into n8n.

## Structure

```
src/riskScore.ts                         pure scoring logic (typed)
nodes/SupplierRisk/SupplierRisk.node.ts  n8n node wrapper (INodeType)
test/riskScore.test.ts                   unit tests + node test with a fake n8n context
examples/                                sample data + importable workflow
.github/workflows/ci.yml                 type-check + tests on every push
```

## Next steps

- Credentials + an operation that fetches the country index from an external API
- Load the category table from a data table / Google Sheet, so business owners can maintain it
- Publish to npm and submit for n8n community-node verification
