import { NextRequest, NextResponse } from 'next/server';
import { expandQueries } from '@/lib/serp_expand';
import { generateSeedQueries } from '@/lib/seed_generation';
import { extractCompanyContext } from '@/lib/company_context';
import { SeedQuery } from '@/types';

/**
 * Step 3 API endpoint: /api/steps/expand-queries
 * Expands seed queries using PAA and related questions via SerpAPI
 * 
 * POST /api/steps/expand-queries
 * Body: { 
 *   seedQueries?: Array<{ query: string, intent?: string }> | SeedQuery[],  // Optional - will run Step 2 if not provided
 *   company?: string,  // Required if seedQueries not provided
 *   website?: string,  // Required if seedQueries not provided
 *   companyProfile?: CompanyProfile,  // Alternative to company/website
 *   geo?: string, 
 *   lang?: string 
 * }
 * 
 * If seedQueries are not provided, Step 2 (and optionally Step 1) will be run automatically.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { seedQueries, company, website, companyProfile, geo = 'US', lang = 'en' } = body;

    let queriesToExpand: SeedQuery[] | Array<{ query: string; intent?: string }>;

    // If seedQueries provided, use them directly
    if (seedQueries && Array.isArray(seedQueries)) {
      // Validate that each item has at least a 'query' field
      for (const seed of seedQueries) {
        if (!seed.query || typeof seed.query !== 'string') {
          return NextResponse.json(
            { error: 'Each seed query must have a "query" field (string)' },
            { status: 400 }
          );
        }
      }
      queriesToExpand = seedQueries;
    } else {
      // Auto-run Step 2 (and optionally Step 1) to generate seed queries
      let profile;
      if (companyProfile) {
        profile = companyProfile;
      } else if (company && website) {
        // Run Step 1 to get company profile
        profile = await extractCompanyContext(company, website);
      } else {
        return NextResponse.json(
          {
            error: 'Either seedQueries OR (company + website) OR companyProfile must be provided'
          },
          { status: 400 }
        );
      }

      // Run Step 2 to generate seed queries
      queriesToExpand = await generateSeedQueries(profile);
    }

    const expandedQueries = await expandQueries(queriesToExpand, geo, lang);
    return NextResponse.json({
      queries: expandedQueries,
      count: expandedQueries.length,
      expanded_from: queriesToExpand.length,
      geo,
      lang,
      auto_generated_seeds: !seedQueries // Indicate if seeds were auto-generated
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

