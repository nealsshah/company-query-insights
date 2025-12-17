# Meridian Take-Home: Company Search Query Insights

A Next.js backend API that generates SEO insights for companies by analyzing search queries, clustering them into topics, and providing provenance and confidence scores.

## Features

- **Company Context Extraction**: Automatically finds and scrapes company websites
- **Seed Query Generation**: Uses LLM to generate diverse search queries
- **Query Expansion**: Expands queries using People Also Ask patterns
- **Volume Enrichment**: Adds search volume, CPC, and competition metrics
- **Topic Clustering**: Groups queries into meaningful topics using embeddings
- **Provenance & Confidence**: Tracks data sources and calculates confidence scores

## Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
```

Edit `.env` and add your API keys:
- `OPENAI_API_KEY` (required for LLM features)
- `SERP_API_KEY` (optional, for PAA expansion)
- `GOOGLE_ADS_API_KEY` (optional, for volume metrics)
- `DATAFORSEO_API_KEY` (optional, for volume metrics)

3. **Run the development server:**
```bash
npm run dev
```

The API will be available at `http://localhost:3000`

## API Endpoints

### Main Endpoint

**POST `/api/insights`**
Runs the full pipeline from company name to insights.

**Request:**
```json
{
  "company": "Gymshark",
  "website": "https://www.gymshark.com", // required
  "geo": "US", // optional, default: "US"
  "lang": "en" // optional, default: "en"
}
```

**Response:**
```json
{
  "company": "Gymshark",
  "geo": "US",
  "lang": "en",
  "generated_at": "2025-01-17",
  "topics": [
    {
      "topic": "Returns & refunds",
      "topic_score": 92000,
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

### Individual Step Endpoints (for testing)

**POST `/api/steps/company-context`**
Extracts company context from website.

**POST `/api/steps/seed-queries`**
Generates seed queries from company profile.

**POST `/api/steps/expand-queries`**
Expands seed queries using PAA.

**POST `/api/steps/enrich-volume`**
Enriches queries with volume metrics.

**POST `/api/steps/cluster-rank`**
Clusters queries into topics and ranks them.

**POST `/api/steps/provenance`**
Adds provenance and confidence scores.

## Testing with Postman

1. **Import the Postman collection:**
   - Import `postman_collection.json` into Postman
   - All endpoints are pre-configured with example requests

2. **Or test manually:**
   - Method: POST
   - URL: `http://localhost:3000/api/insights`
   - Headers: `Content-Type: application/json`
   - Body (raw JSON):
   ```json
   {
     "company": "Gymshark",
     "website": "https://www.gymshark.com"
   }
   ```

3. **Test individual steps** using the step endpoints in the collection or by calling them directly.

## Architecture

The pipeline consists of 6 steps:

1. **Company Context Extraction** (`lib/company_context.ts`)
   - Finds company website
   - Scrapes homepage and about page
   - Extracts products, services, categories

2. **Seed Query Generation** (`lib/seed_generation.ts`)
   - Uses OpenAI to generate diverse queries
   - Covers multiple intents (navigational, transactional, etc.)

3. **Query Expansion** (`lib/serp_expand.ts`)
   - Expands queries using People Also Ask patterns
   - Deduplicates results

4. **Volume Enrichment** (`lib/volume_enrich.ts`)
   - Adds search volume, CPC, competition
   - Supports multiple providers with fallbacks

5. **Clustering & Ranking** (`lib/cluster_rank.ts`)
   - Creates embeddings for queries
   - Clusters into topics
   - Ranks by volume and relevance

6. **Provenance & Confidence** (`lib/output.ts`)
   - Adds source labels
   - Calculates confidence scores

## Notes

- The system works without API keys but with reduced functionality (fallback modes)
- Volume metrics are estimated if no API keys are provided
- All endpoints return JSON and can be tested with Postman
- The system is designed to be transparent about data sources and confidence levels

# company-query-insights
