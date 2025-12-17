# Add Brand Affinity Scoring via SERP (Step 5.5)

## Why this exists

Right now, topic clusters can float **generic high-volume category queries** (e.g., “workout clothes men”) to the top, which doesn’t actually tell us what people search **about the brand** (Gymshark).

We need a *brand relevance gate* that answers:

> “For this query, does Gymshark (or its domain) actually show up in search results?”

This doc tells you exactly how to implement that.

---

## Goal

For every query in our enriched list, compute a **brand_affinity_score** using a SERP provider (we already use SerpApi for PAA).

Then, use this score to:

* separate output into **Brand Intent** vs **Category Opportunities**
* prevent generic queries from ranking high unless Gymshark is actually present in results

---

## Inputs

* `company_name`: e.g. `"Gymshark"`
* `brand_domains`: list of domains we consider “the brand”

  * start with: `["gymshark.com"]`
  * optional add: country domains/subdomains if relevant
* `brand_terms`: list of strings to match in titles/snippets

  * start with: `["gymshark"]` (lowercased)
* `queries[]`: output from Step 4 (each item has `query`, `intent`, optional `volume_monthly`, `source`, etc.)
* config: `geo` (US), `lang` (en), `serp_top_n` (e.g., 10)

---

## Approach (Low SERP Credits): Domain Keyword Rankings (Preferred)

Serp-per-query is expensive and cannot be batched. Instead of checking SERP for every query, compute brand affinity by asking:

> “What keywords does the brand domain already rank for, and at what position?”

### Provider

Use DataForSEO **Labs** (or equivalent provider) to pull organic keyword rankings for the brand domain.

### High-level flow

1. Fetch a large list of organic keywords for `brand_domains[0]` (e.g., `gymshark.com`) for a chosen geo/lang.
2. Build a lookup map: `keyword_normalized -> best_position` (lowest numeric rank).
3. For each query in our list:

   * if query matches a ranked keyword (exact normalized match, optionally fuzzy later):

     * set `brand_domain_hit=true`
     * set `brand_domain_rank=best_position`
     * compute `brand_affinity` from rank
   * else:

     * `brand_domain_hit=false`
     * `brand_domain_rank=null`
     * `brand_affinity=0`

This gives a scalable, cheap “does the brand show up?” signal without burning SERP credits.

---

## DataForSEO endpoint (Domain -> organic keywords)

Use the DataForSEO Labs endpoint that returns **organic keywords for a target domain** in a location/language.

Implementation notes:

* Request the maximum keyword count you can afford (e.g., top 1k–10k keywords).
* Include the position/rank field in the response.
* Cache the entire response keyed by `domain+geo+lang+date`.

---

## What to compute per query

### 1) Presence signals

Parse the SERP response and compute:

**A) domain_hit**

* `domain_hit = 1` if any organic result’s domain is in `brand_domains`
* `domain_hit = 0` otherwise

**B) domain_rank**

* if `domain_hit=1`, set `domain_rank` = rank position (1-indexed) of the first matching result
* else `domain_rank = null`

**C) term_hit**

* `term_hit = 1` if brand_terms appear in any:

  * result title
  * result snippet
  * sitelinks (if present)
  * featured snippet / knowledge panel text (if present)
* else `term_hit = 0`

**D) mention_count**

* count how many results in top N include:

  * brand domain match OR brand term match

---

## Brand affinity score (0..1)

Compute a stable, explainable score.

Recommended scoring:

1. **Rank-based score** (only if domain appears):

* if domain appears at rank r:

  * `rank_score = 1 / sqrt(r)`
* else `rank_score = 0`

2. **Mentions score**

* `mentions_score = min(1, mention_count / 3)`  (cap at 1 once brand appears 3+ times)

3. **Combine**

* `brand_affinity = 0.65*rank_score + 0.35*mentions_score`

Notes:

* This makes a #1 ranking worth a lot, but still gives credit if Gymshark is referenced in the SERP even if the domain isn’t ranking.

---

## Classification

After computing `brand_affinity`:

**Brand Intent bucket**

* if query contains any `brand_terms` (e.g. includes "gymshark")

  * label as `query_type = "brand_intent"`

**Category Opportunity bucket**

* else if `brand_affinity >= 0.35` (tuneable)

  * label as `query_type = "category_opportunity"`

**Discard / low relevance**

* else

  * label as `query_type = "low_relevance"` and exclude from top output

---

## Use it in ranking

Update query ranking so generic queries cannot dominate just due to high volume.

Suggested:

* `final_query_score = base_query_score * (0.25 + 0.75*brand_affinity)`

Where `base_query_score` is your existing score from Step 5 (volume + relevance + intent).

This ensures:

* brand_intent queries still rank well (they’ll often also have high affinity)
* category queries only rank high if Gymshark appears in SERP

---

## Output fields to add

Add these fields to each query object:

```json
{
  "brand_affinity": 0.72,
  "brand_domain_hit": true,
  "brand_domain_rank": 2,
  "brand_mention_count": 3,
  "query_type": "category_opportunity"
}
```

For debugging, also store:

* `serp_checked_at`
* optional: `serp_provider_request_id`

---

## Caching (critical)

SERP calls cost time and money.

Cache by:

* `geo + lang + normalized_query`

Store the computed affinity fields so you don’t re-query SERP when re-running clustering/UI.

---

## Performance plan

* Only run SERP affinity on the top **N queries** after Step 4 (e.g., 200–400).
* Rate limit to avoid provider throttling.

---

## Definition of done

Given a company (Gymshark), the system can:

1. compute brand_affinity per query via SERP
2. classify queries into brand_intent vs category_opportunity
3. re-rank topics so generic queries do not dominate unless Gymshark shows up in SERP
4. expose debug fields (rank, mentions) to explain why a query is considered relevant
