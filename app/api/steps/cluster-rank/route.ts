import { NextRequest, NextResponse } from 'next/server';
import { clusterAndRank } from '@/lib/cluster_rank';
import { extractCompanyContext } from '@/lib/company_context';
import { EnrichedQuery, CompanyProfile } from '@/types';

/**
 * Step 5 API endpoint: /api/steps/cluster-rank
 * Clusters queries into topics and ranks them
 * 
 * POST /api/steps/cluster-rank
 * Body: { queries: EnrichedQuery[], companyProfile: CompanyProfile }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { queries, companyProfile, company, website } = body;

    if (!queries || !Array.isArray(queries)) {
      return NextResponse.json(
        { error: 'queries array is required' },
        { status: 400 }
      );
    }

    let profile: CompanyProfile;
    if (companyProfile) {
      profile = companyProfile;
    } else if (company && website) {
      profile = await extractCompanyContext(company, website);
    } else {
      return NextResponse.json(
        { error: 'Either companyProfile OR both company and website are required' },
        { status: 400 }
      );
    }

    const topics = await clusterAndRank(queries, profile);
    return NextResponse.json({ 
      topics, 
      count: topics.length,
      total_queries: queries.length
    });
  } catch (error) {
    console.error('Error clustering and ranking:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

