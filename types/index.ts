// Core data types for the pipeline

export interface CompanyProfile {
  name: string;
  website?: string;
  products: string[];
  services: string[];
  targetAudience: string[];
  categories: string[];
  brandTerms: string[];
  extractedText?: string;
}

export interface SeedQuery {
  query: string;
  intent: 'navigational' | 'informational' | 'transactional' | 'comparison' | 'discovery' | 'troubleshooting';
  rationale: string;
  seed_type: 'llm';
}

export interface ExpandedQuery {
  query: string;
  source: 'paa' | 'llm';
  parent_seed?: string;
  intent?: string;
  geo?: string;
  lang?: string;
}

export interface VolumeMetrics {
  volume_monthly?: number;
  volume_range?: string;
  competition?: 'low' | 'medium' | 'high';
  cpc?: number;
  geo: string;
  lang: string;
  source: string;
}

export interface EnrichedQuery extends ExpandedQuery {
  volume_monthly?: number;
  volume_range?: string;
  competition?: 'low' | 'medium' | 'high';
  cpc?: number;
  geo: string;
  lang: string;
  volume_source?: string;
  volume_provider?: string;
  volume_source_query?: string; // The query variant that matched (if fallback was used)
  has_volume?: boolean;
}

export interface QueryWithScore extends EnrichedQuery {
  query_score: number;
  relevance_score: number;
  intent_weight: number;
  embedding?: number[];
}

export interface Topic {
  topic_id?: string;
  topic: string;
  topic_score: number;
  confidence: number;
  volume_coverage?: number;
  top_queries: QueryResult[];
}

export interface QueryResult {
  query: string;
  intent: string;
  volume_monthly?: number;
  has_volume?: boolean;
  sources: string[];
  confidence: number;
  query_score?: number;
}

export interface InsightsOutput {
  company: string;
  geo: string;
  lang: string;
  generated_at: string;
  topics: Topic[];
  debug: {
    seeds_count: number;
    expanded_count: number;
    volume_coverage_pct: number;
  };
}

export interface ProvenanceSource {
  type: 'generated:llm' | 'discovered:paa' | 'estimated:google_ads' | 'dataforseo:google_ads' | 'estimated:fallback' | 'observed:gsc' | 'observed:bing_wmt';
  confidence: number;
}

