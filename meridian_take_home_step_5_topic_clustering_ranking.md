# Step 5: Topic Clustering + Ranking

## Goal
Convert the noisy list of enriched queries from Step 4 into a **customer-friendly output**:
- group similar queries into **topics** (clusters)
- rank **topics** and **queries within topics**
- work even when `has_volume=false` for many long-tail PAA questions

---

## Inputs
- `queries[]` from Step 4 (each has: `query`, `source`, `intent`, `geo`, `lang`, optional `volume_monthly`, etc.)
- `company_profile` from Step 1 (recommended for relevance)

---

## What to Build

### 1) Normalize + Dedupe (again)
Before clustering:
- lowercase
- trim
- remove trailing punctuation (`?`, `.`, `!`)
- collapse multiple spaces
- optional: remove brand duplicates (“gymshark gymshark …”)

Keep both:
- `query_original`
- `query_normalized`

---

### 2) Compute Embeddings
Create embeddings for:
- each `query_normalized`
- optionally: a single embedding for `company_profile` (or summary string)

Store:
- `embedding_vector` per query

---

### 3) Cluster Queries into Topics
Pick one simple clustering approach:

**Option A (fast + good): Agglomerative / hierarchical clustering**
- distance = cosine distance
- yields natural clusters without picking k exactly

**Option B (simplest): k-means**
- choose k ~ 5–10 for a prototype

**Option C (no ML): rules-based** (fallback)
- group by keywords like “return”, “shipping”, “discount”, “size”, “store”, “tracking”

Output:
- each query gets a `topic_id`

---

### 4) Label Each Topic
For each cluster:

**Simple label (no LLM):**
- choose the “most central” query (closest to centroid)
- shorten it into a 2–4 word label (string cleanup)

**Better label (LLM):**
- pass the top 10 queries in the cluster and ask: “Give a 2–4 word topic label.”

Store:
- `topic_label`

---

### 5) Scoring / Ranking
You want a score for:
- each **query**
- each **topic**

#### Query score
Use volume when you have it, but don’t drop queries with `has_volume=false`.

Recommended features:
- `volume_score`:
  - if `has_volume=true`: `log1p(volume_monthly)` normalized
  - else: 0 (or small fallback)
- `relevance_score`:
  - cosine similarity(query_embedding, company_profile_embedding)
- `source_bonus`:
  - +0.1 if `source == "paa"` (real SERP-discovered)
- `intent_weight`:
  - transactional/navigational slightly higher if your product focuses on acquisition

Example:
- `query_score = 0.55*volume_score + 0.35*relevance_score + 0.05*source_bonus + 0.05*intent_weight`

#### Topic score
Rank topics by aggregate importance.

Two good prototype options:
- `topic_score = sum(top 5 query_scores in topic)`
- or `topic_score = sum(top 5 volumes) + alpha*avg_relevance`

Also track:
- `topic_volume_coverage = (# queries with volume) / (topic query count)`

---

### 6) Pick Top Queries Per Topic
For each topic:
- sort queries by `query_score`
- return top N (e.g., 5–10)

---

## Output Shape (Recommended)

```json
{
  "topics": [
    {
      "topic_id": "t3",
      "topic": "Returns & refunds",
      "topic_score": 92,
      "confidence": 0.84,
      "volume_coverage": 0.60,
      "top_queries": [
        {
          "query": "gymshark return policy",
          "intent": "informational",
          "volume_monthly": 18200,
          "has_volume": true,
          "sources": ["discovered:paa", "estimated:dataforseo:google_ads"],
          "query_score": 18.3,
          "confidence": 0.72
        }
      ]
    }
  ]
}
```

---

## Confidence (carryover from Step 6 idea)
You can already compute a draft confidence here:
- base 0.2
- +0.2 if `has_volume=true`
- +0.1 if `source == "paa"`
- +0.1 if intent is clear (transactional/navigational)

(Full provenance/confidence packaging happens in Step 6, but you can prep it now.)

---

## Done Criteria
- You produce 5–10 topic clusters
- each cluster has a clean label
- each cluster has 5–10 top queries ranked
- ranking works even when many queries have `has_volume=false`

Next step: **Step 6** final packaging (provenance + confidence + explainability + output contract).

