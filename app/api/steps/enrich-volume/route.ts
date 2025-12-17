import { NextRequest, NextResponse } from 'next/server';
import { enrichWithVolume } from '@/lib/volume_enrich';
import { ExpandedQuery } from '@/types';

/**
 * Step 4 API endpoint: /api/steps/enrich-volume
 * Enriches queries with volume metrics
 * 
 * POST /api/steps/enrich-volume
 * Body: { queries: ExpandedQuery[], geo?: string, lang?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { queries, geo = 'US', lang = 'en' } = body;

    // Handle case where user passes the expand-queries response directly
    // (which has a nested structure: { queries: [...], count: ... })
    if (body.queries && Array.isArray(body.queries) && body.queries.length > 0) {
      // Check if first item is actually a query object or if it's nested
      const firstItem = body.queries[0];
      if (firstItem && typeof firstItem === 'object' && 'queries' in firstItem) {
        // This is the expand-queries response structure - extract the actual queries
        queries = firstItem.queries;
      } else {
        queries = body.queries;
      }
    }

    if (!queries || !Array.isArray(queries)) {
      return NextResponse.json(
        { error: 'queries array is required' },
        { status: 400 }
      );
    }

    // Validate that queries are in the correct format
    if (queries.length > 0 && !queries[0].query) {
      return NextResponse.json(
        { error: 'Each query must have a "query" field' },
        { status: 400 }
      );
    }

    const enrichedQueries = await enrichWithVolume(queries, geo, lang);
    const withVolume = enrichedQueries.filter(q => q.has_volume).length;
    const volumeCoverage = enrichedQueries.length > 0 ? withVolume / enrichedQueries.length : 0;

    return NextResponse.json({
      queries: enrichedQueries,
      count: enrichedQueries.length,
      volume_coverage: volumeCoverage,
      with_volume: withVolume,
      without_volume: enrichedQueries.length - withVolume,
      provider: enrichedQueries[0]?.volume_provider || 'unknown'
    });
  } catch (error) {
    console.error('Error enriching with volume:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

