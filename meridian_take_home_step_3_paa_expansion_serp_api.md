# Step 3: Expand Seed Queries via People Also Ask (SerpApi)

## Goal
Turn your **seed queries** (from Step 2) into a larger set of **real, question-shaped queries** that:
- reflect how people naturally ask things (good proxy for AI-search phrasing)
- broaden coverage beyond what the LLM initially guessed

---

## Inputs
- `seed_queries[]`: ~10–20 queries
- `company_name` (optional for context)
- config: `geo` (e.g., US), `lang` (e.g., en)

---

## What to Do
1) **For each seed query**, call SerpApi Google Search endpoint.
2) Parse out:
   - **People Also Ask questions** (often labeled `related_questions`)
   - optionally: **related searches** (if you want extra breadth)
3) Create new query candidates:
   - store the question text as a query
   - keep provenance: `source = "discovered:paa"`
   - keep lineage: `parent_seed = <seed query>`
4) **Dedupe aggressively**:
   - lowercase
   - trim whitespace
   - remove trailing punctuation
   - collapse repeated spaces
5) **Filter out junk**:
   - too short (e.g., < 3 words)
   - obvious non-queries
   - unrelated brand collisions

---

## Output
- `expanded_queries[]` (typically 3–10 per seed, so 30–150 total)

Recommended schema:
```json
{
  "query": "does gymshark run small",
  "source": "discovered:paa",
  "parent_seed": "gymshark sizing",
  "geo": "US",
  "lang": "en"
}
```

---

## Fallbacks (If PAA is sparse)
- Run a second pass using:
  - the **top PAA questions** as new queries (1 hop deeper, optional)
  - OR append brand modifiers: `"<brand> + returns"`, `"<brand> + sizing"`, etc.

---

## Done Criteria
- You can produce a clean `expanded_queries[]` list where every item has:
  - a query string
  - provenance (`discovered:paa`)
  - linkage to a seed (`parent_seed`)
  - deduped + filtered

Next step after this: **Step 4 (volume enrichment)** attaches demand metrics to rank these queries.
