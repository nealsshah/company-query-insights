import { Topic, QueryResult, InsightsOutput, EnrichedQuery } from '@/types';

/**
 * Step 6: Provenance + Confidence (Credibility Layer)
 * Adds provenance labels and confidence scores to queries and topics
 */

export function addProvenanceAndConfidence(
  topics: Topic[],
  enrichedQueries: EnrichedQuery[]
): InsightsOutput {
  // Add provenance and confidence to each query
  const topicsWithProvenance = topics.map((topic) => {
    const queriesWithProvenance = topic.top_queries.map((query) => {
      const enriched = enrichedQueries.find((eq) => eq.query === query.query);
      const sources = getProvenanceSources(enriched);
      const confidence = calculateConfidence(enriched, sources);

      return {
        ...query,
        sources,
        confidence,
      };
    });

    // Calculate topic confidence (average of top queries)
    const topicConfidence = queriesWithProvenance.length > 0
      ? queriesWithProvenance.reduce((sum, q) => sum + q.confidence, 0) / queriesWithProvenance.length
      : 0.5;

    return {
      ...topic,
      confidence: topicConfidence,
      top_queries: queriesWithProvenance,
    };
  });

  return {
    company: '', // Will be set by caller
    geo: 'US',
    lang: 'en',
    generated_at: new Date().toISOString().split('T')[0],
    topics: topicsWithProvenance,
    debug: {
      seeds_count: 0, // Will be set by caller
      expanded_count: enrichedQueries.length,
      volume_coverage_pct: calculateVolumeCoverage(enrichedQueries),
    },
  };
}

function getProvenanceSources(enriched?: EnrichedQuery): string[] {
  if (!enriched) return ['generated:llm'];

  const sources: string[] = [];

  // Check source type
  if (enriched.source === 'llm') {
    sources.push('generated:llm');
  } else if (enriched.source === 'paa') {
    sources.push('discovered:paa');
  }

  // Check volume source
  if (enriched.volume_source) {
    if (enriched.volume_source.includes('google_ads')) {
      sources.push('estimated:google_ads');
    } else if (enriched.volume_source.includes('dataforseo')) {
      sources.push('estimated:dataforseo');
    } else if (enriched.volume_source.includes('fallback')) {
      sources.push('estimated:fallback');
    }
  }

  // Remove duplicates
  return Array.from(new Set(sources));
}

function calculateConfidence(
  enriched: EnrichedQuery | undefined,
  sources: string[]
): number {
  let confidence = 0.2; // Base confidence

  // +0.6 if observed in GSC/Bing (hard evidence)
  // Note: Not implemented in prototype, but structure is here
  if (sources.some((s) => s.includes('observed'))) {
    confidence += 0.6;
  }

  // +0.2 if has volume metric from Ads/3P
  if (sources.some((s) => s.includes('estimated:google_ads') || s.includes('estimated:dataforseo'))) {
    confidence += 0.2;
  } else if (sources.some((s) => s.includes('estimated:fallback'))) {
    confidence += 0.1; // Lower confidence for fallback estimates
  }

  // +0.1 if appears from multiple discovery sources
  const discoverySources = sources.filter((s) => 
    s.includes('discovered') || s.includes('generated')
  );
  if (discoverySources.length > 1) {
    confidence += 0.1;
  }

  // Cap at 1.0
  return Math.min(confidence, 1.0);
}

function calculateVolumeCoverage(enrichedQueries: EnrichedQuery[]): number {
  const withVolume = enrichedQueries.filter((q) => q.volume_monthly !== undefined).length;
  return enrichedQueries.length > 0 ? withVolume / enrichedQueries.length : 0;
}

