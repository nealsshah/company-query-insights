import { NextRequest, NextResponse } from 'next/server';
import { expandQueries } from '@/lib/serp_expand';
import { SeedQuery } from '@/types';

/**
 * Step 3 API endpoint: /api/steps/expand-queries
 * Expands seed queries using PAA and related questions
 * 
 * POST /api/steps/expand-queries
 * Body: { seedQueries: SeedQuery[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { seedQueries } = body;

    if (!seedQueries || !Array.isArray(seedQueries)) {
      return NextResponse.json(
        { error: 'seedQueries array is required' },
        { status: 400 }
      );
    }

    const expandedQueries = await expandQueries(seedQueries);
    return NextResponse.json({ 
      queries: expandedQueries, 
      count: expandedQueries.length,
      expanded_from: seedQueries.length
    });
  } catch (error) {
    console.error('Error expanding queries:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

