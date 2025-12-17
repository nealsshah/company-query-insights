# Meridian Take-Home: Company Search Query Insights Prototype (Cursor Context)

## Objective
Build a **6-hour prototype** that takes a **company name** (e.g., “Gymshark”) and returns:
- **Top related search topics + queries** people use to find/learn about that company (questions + keywords)
- A **ranking** that is *as grounded in real signals as possible* (not just LLM guesses)
- **Provenance + confidence** per query/topic (what data source it came from, and how reliable it is)

This is meant to be a usable “first version” of **LLM SEO / AI-search query insights**.

---

## Key Constraints / Principles
- There is no public “ChatGPT search console.” We must blend **available signals** + modeling.
- Keep data acquisition **legal / above-board**.
- Prefer **transparency**: label outputs as **Observed vs Estimated vs Discovered vs Modeled**.

---

## High-Level Pipeline (Steps 1–6)

### Step 1) Company → Context Extraction
**Input:** company name
**Output:** structured context used to generate/expand keywords

**Implementation:**
- Find company website (search or simple heuristic; for prototype, allow manual override).
- Fetch homepage + about page text (light scraping / requests).
- Extract:
  - products/services
  - target audience
  - categories
  - brand terms (company name variants)

**Artifacts:**
- `company_profile.json`

---

### Step 2) Seed Query Generation (LLM)
**Input:** company_profile
**Output:** ~20–50 seed queries

**Prompt strategy:**
- Ask for mixed intent queries:
  - brand navigational (“gymshark store”, “gymshark return policy”)
  - product discovery (“best gymshark leggings”)
  - comparison (“gymshark vs nike leggings”)
  - informational (“is gymshark good quality”)
  - transactional (“gymshark discount code”, “gymshark student discount”)
  - troubleshooting (“gymshark login not working”)

**Output schema:**
- `{ query, intent, rationale, seed_type: 'llm' }`

---

### Step 3) Query Expansion (SERP / PAA)
**Input:** seed queries
**Output:** expanded long-tail, especially natural-language questions

**Sources (prototype):**
- People Also Ask / related questions via a SERP provider (or lightweight scraping if allowed)

**Notes:**
- Expansion is crucial because PAA captures question-shaped queries similar to AI-search prompts.

**Output schema:**
- `{ query, source: 'paa', parent_seed }`

---

### Step 4) Attach “Demand” Metrics (Volume / Importance)
**Input:** expanded query list
**Output:** each query enriched with demand proxies

**Preferred sources (choose based on feasibility/keys):**
1) **Google Ads Keyword Planner** (via Google Ads API) → avg monthly searches, competition, CPC
2) **Third-party keyword DB** (e.g., DataForSEO) → search volume, CPC, competition
3) Fallback (if no keys): use Google Trends-style relative interest, or rank by frequency across expansions

**Output schema:**
- `{ query, volume_monthly?, volume_range?, competition?, cpc?, geo, lang, source: 'estimated:<provider>' }`

---

### Step 5) Cluster into Topics + Rank
**Input:** enriched queries
**Output:** topics with ranked queries inside each topic

**Approach:**
- Normalize text (lowercase, strip punctuation, remove stopwords)
- Create embeddings for each query
- Cluster (k-means or hierarchical)
- Label cluster:
  - pick representative query OR
  - ask LLM: “Name this cluster in 2–4 words”

**Ranking:**
- Query score (example):
  - `query_score = w1*norm(volume) + w2*relevance + w3*intent_weight`
- Topic score (example):
  - `topic_score = sum(top N query volumes)`

**Relevance scoring (simple):**
- cosine similarity between query embedding and company profile embedding

---

### Step 6) Provenance + Confidence (Credibility Layer)
**Goal:** Make output auditable and honest.

**Provenance types:**
- `generated:llm` (seeded by LLM)
- `discovered:paa` (from People Also Ask)
- `estimated:google_ads` / `estimated:dataforseo` (volume estimates)
- `observed:gsc` / `observed:bing_wmt` (if customer connects later)

**Confidence heuristic (0–1):**
Start with 0.2
- +0.6 if observed in GSC/Bing (hard evidence)
- +0.2 if has volume metric from Ads/3P
- +0.1 if appears from multiple discovery sources
Cap at 1.0

**Output includes:**
- confidence per query
- confidence per topic (e.g., average of top queries)

---

## Output Contract (Recommended)
Return JSON that can be rendered into UI.

```json
{
  "company": "Gymshark",
  "geo": "US",
  "lang": "en",
  "generated_at": "2025-12-17",
  "topics": [
    {
      "topic": "Returns & refunds",
      "topic_score": 92,
      "confidence": 0.84,
      "top_queries": [
        {
          "query": "gymshark return policy",
          "intent": "informational",
          "volume_monthly": 18200,
          "sources": ["discovered:paa", "estimated:google_ads"],
          "confidence": 0.72
        }
      ]
    }
  ],
  "debug": {
    "seeds_count": 40,
    "expanded_count": 160,
    "volume_coverage_pct": 0.68
  }
}
```

---

## Minimal Architecture (Prototype-Friendly)

### Core modules
- `company_context.ts|py`
  - website discovery, text extraction, profile building
- `seed_generation.ts|py`
  - LLM prompt + structured output
- `serp_expand.ts|py`
  - PAA/related questions expansion
- `volume_enrich.ts|py`
  - keyword volume provider adapter(s)
- `cluster_rank.ts|py`
  - embeddings, clustering, ranking
- `output.ts|py`
  - provenance + confidence, final JSON

### Provider adapters (interfaces)
- `VolumeProvider.getMetrics(keywords[]) -> metrics[]`
- `ExpansionProvider.expand(seeds[]) -> queries[]`

---

## Implementation Notes (Best “Wow” Factors)
- **Provenance labels + confidence** (makes it feel real and trustworthy)
- **Topic clustering** (turns a keyword dump into a product)
- **Explainability**: show “why this ranked” (volume + relevance + intent)
- **Graceful fallbacks** when volume isn’t available

---

## 6-Hour Execution Plan (Suggested)
1) Build company context extractor + manual override
2) LLM seed query generator → JSON
3) PAA expansion → dedupe
4) Volume enrichment adapter (choose one provider; implement fallback)
5) Clustering + ranking
6) Final JSON + small CLI or minimal UI renderer

---

## Optional Enhancements (If time remains)
- Compare queries against competitor brands
- “Brand vs non-brand” separation
- Add “intent mix” summary (percent informational vs transactional)
- Export CSV

---

## Definition of Done
Given `company="Gymshark"`, system returns:
- 5–10 topic clusters
- each topic has 5–10 ranked queries
- each query includes provenance + confidence
- output is reproducible and debuggable

