import { NextRequest, NextResponse } from 'next/server';
import { extractCompanyContext } from '@/lib/company_context';
import { addBrandAffinityToQueries } from '@/lib/brand_affinity';
import { CompanyProfile, EnrichedQuery } from '@/types';

/**
 * Step 5.5 API endpoint: /api/steps/brand-affinity
 * Adds brand affinity scoring via SERP to enriched queries.
 *
 * POST /api/steps/brand-affinity
 * Body: {
 *   queries: EnrichedQuery[],
 *   companyProfile?: CompanyProfile,
 *   company?: string,
 *   website?: string,
 *   geo?: string,
 *   lang?: string,
 *   serp_top_n?: number,
 *   max_queries?: number,
 *   brand_domains?: string[],
 *   brand_terms?: string[],
 *   category_opportunity_threshold?: number
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      queries,
      companyProfile,
      company,
      website,
      geo = 'US',
      lang = 'en',
      serp_top_n = 10,
      max_queries = 300,
      brand_domains,
      brand_terms,
      category_opportunity_threshold = 0.35,
    } = body;

    if (!queries || !Array.isArray(queries)) {
      return NextResponse.json({ error: 'queries array is required' }, { status: 400 });
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

    const updated = await addBrandAffinityToQueries(queries as EnrichedQuery[], profile, {
      geo,
      lang,
      serp_top_n,
      max_queries,
      brand_domains,
      brand_terms,
      category_opportunity_threshold,
    });

    return NextResponse.json({
      queries: updated,
      count: updated.length,
      checked_count: Math.min(max_queries, updated.length),
      geo,
      lang,
      serp_top_n,
    });
  } catch (error) {
    console.error('Error computing brand affinity:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}


