# Step 4: Volume Enrichment (Demand Proxy)

## Goal
For each query from Step 3 (expanded via PAA), attach a **demand/importance signal** so we can rank later.

**Important:** this is **not “LLM prompt volume.”** It’s a **calibration proxy** for how big the underlying topic is, using legal, accessible sources.

---

## Inputs
- `queries[]`: deduped list from Step 3
- config: `geo` (e.g., US), `lang` (e.g., en)

---

## What to Do
1) **Batch the queries** (e.g., 50–200 at a time depending on provider limits).
2) For each query, request metrics from a volume provider.
3) Normalize and store the results in a consistent schema.
4) Handle missing data gracefully (many long-tail questions won’t have volume).

---

## Provider Options (Pick 1 for the prototype)

### Option A: Google Ads Keyword Planner (Google Ads API)
Use Keyword Plan Idea endpoints to get:
- `avg_monthly_searches`
- `competition`
- `cpc` (if available)

Output is typically **estimates/ranges** depending on account.

### Option B: Third-party keyword DB (e.g., DataForSEO)
Return:
- `search_volume`
- `cpc`
- `competition`

Faster integration, paid, still “estimated.”

### Option C: Fallback (No keys)
If you can’t call a volume API:
- Use a relative signal:
  - count appearances across PAA runs
  - use Google Trends-like interest if available
  - or rank by relevance only (explicitly mark as low confidence)

---

## Normalization + Backoff Rules
Because many PAA questions are long, use fallbacks:
- **Exact query first**
- If missing, try **simplified variants**:
  - remove punctuation / question marks
  - drop leading “what/how/why/does”
  - create a short noun phrase (e.g., “gymshark sizing”)
  - keep the original query but store `volume_source_query` as the variant that matched

Example:
- original: “does gymshark run small?”
- fallback metric query: “gymshark sizing”

---

## Output
Enriched list where each item includes demand metrics + provenance.

Recommended schema:
```json
{
  "query": "does gymshark run small",
  "source": "discovered:paa",
  "parent_seed": "gymshark sizing",
  "geo": "US",
  "lang": "en",

  "volume_monthly": 5400,
  "competition": "MEDIUM",
  "cpc_usd": 1.12,
  "volume_provider": "estimated:google_ads",
  "volume_source_query": "gymshark sizing",
  "has_volume": true
}
```

---

## Done Criteria
- For each query, you can output:
  - `has_volume` boolean
  - `volume_monthly` (or range) when available
  - `volume_provider` label
  - `volume_source_query` if you used a fallback variant

Next step: **Step 5 clustering + ranking** uses these metrics as one feature (not the only one).

