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
    const { queries, geo = 'US', lang = 'en' } = body;

    if (!queries || !Array.isArray(queries)) {
      return NextResponse.json(
        { error: 'queries array is required' },
        { status: 400 }
      );
    }

    const enrichedQueries = await enrichWithVolume(queries, geo, lang);
    return NextResponse.json({ 
      queries: enrichedQueries, 
      count: enrichedQueries.length,
      volume_coverage: enrichedQueries.filter(q => q.volume_monthly !== undefined).length / enrichedQueries.length
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

