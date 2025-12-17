# Step 4: Volume Enrichment (Demand Proxy)

## Goal

For each query from Step 3 (expanded via PAA), attach a **demand/importance signal** so we can rank later.

**Important:** this is **not “LLM prompt volume.”** It’s a **calibration proxy** for how big the underlying topic is, using legal, accessible sources.

---

## Inputs

* `queries[]`: deduped list from Step 3
* config: `geo` (e.g., US), `lang` (e.g., en)

---

## What to Do

1. **Batch the queries** (e.g., 50–200 at a time depending on provider limits).
2. For each query, request metrics from a volume provider.
3. Normalize and store the results in a consistent schema.
4. Handle missing data gracefully (many long-tail questions won’t have volume).

---

## Provider Options (Prototype Default: DataForSEO)

### Option A (Recommended): DataForSEO Keywords Data API

Use DataForSEO as the Step 4 “demand proxy” provider to avoid Google Ads API onboarding + MCC/account-enable friction.

#### Endpoint (Primary)

**Google Ads Search Volume (Live)**

* `POST https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live`

Returns (typical):

* monthly search volume (often `search_volume`)
* optional: `cpc`, `competition`
* may include additional fields depending on the endpoint/schema

#### Auth

DataForSEO uses **Basic Auth**:

* username = your DataForSEO login
* password = your DataForSEO password/API password

#### Request Shape (Recommended)

Send **one task** with a large keyword batch.

Example payload (Google Ads search volume):

```json
[
  {
    "keywords": ["gymshark sizing", "gymshark return policy"],
    "location_name": "United States",
    "language_name": "English"
  }
]
```

Notes:

* Prefer `location_name`/`language_name` for speed. If you already have IDs/constants, you can use those instead.
* Keep geo/lang fixed for the prototype (US/en).

#### Batching + Budgeting (Critical)

* **Batch aggressively**: aim for **200–700 keywords per request** (or the maximum allowed by the endpoint you’re using).
* Avoid “one keyword per call.” Budget will disappear instantly.
* Enrich only the top **N = 200–700** deduped queries for the take-home (not every long-tail).
* Cache results locally so reruns don’t spend budget.

#### Caching Strategy (Do this)

Cache by:

* `provider` (google_ads vs ai_keyword)
* `geo` + `lang`
* `keyword_normalized`

Store:

* `volume_monthly`
* `competition`
* `cpc_usd`
* `has_volume`
* `volume_provider`
* `fetched_at`

#### Response Parsing + Mapping

* Normalize the returned keyword text the same way you normalized inputs.
* Map back by exact normalized match.
* If a keyword is missing, set `has_volume=false` and leave `volume_monthly=null`.

#### Error Handling

* If DataForSEO returns partial errors, keep the successes and only retry failed batches.
* Add basic retry with backoff for 429/5xx.

**Avoid:**

* Using the free “sandbox” response for final results (it’s not rea (Optional / Later): Google Ads Keyword Planner
  Keep the adapter interface so you can swap providers later. Google Ads can provide estimates/ranges but requires heavier setup.

---

## Normalization + Backoff Rules

Because many PAA questions are long, use fallbacks:

* **Exact query first**
* If missing, try **simplified variants**:

  * remove punctuation / question marks
  * drop leading “what/how/why/does”
  * create a short noun phrase (e.g., “gymshark sizing”)
  * keep the original query but store `volume_source_query` as the variant that matched

Example:

* original: “does gymshark run small?”
* fallback metric query: “gymshark sizing”

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

* For each query, you can output:

  * `has_volume` boolean
  * `volume_monthly` (or range) when available
  * `volume_provider` label
  * `volume_source_query` if you used a fallback variant

Next step: **Step 5 clustering + ranking** uses these metrics as one feature (not the only one).
