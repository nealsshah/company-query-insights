import { NextRequest, NextResponse } from 'next/server';
import { addProvenanceAndConfidence } from '@/lib/output';
import { Topic, EnrichedQuery } from '@/types';

/**
 * Step 6 API endpoint: /api/steps/provenance
 * Adds provenance and confidence to topics
 * 
 * POST /api/steps/provenance
 * Body: { topics: Topic[], queries: EnrichedQuery[], company: string, geo?: string, lang?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topics, queries, company, geo = 'US', lang = 'en' } = body;

    if (!topics || !Array.isArray(topics)) {
      return NextResponse.json(
        { error: 'topics array is required' },
        { status: 400 }
      );
    }

    if (!queries || !Array.isArray(queries)) {
      return NextResponse.json(
        { error: 'queries array is required' },
        { status: 400 }
      );
    }

    if (!company) {
      return NextResponse.json(
        { error: 'company name is required' },
        { status: 400 }
      );
    }

    const output = addProvenanceAndConfidence(topics, queries);
    output.company = company;
    output.geo = geo;
    output.lang = lang;

    return NextResponse.json(output);
  } catch (error) {
    console.error('Error adding provenance:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

