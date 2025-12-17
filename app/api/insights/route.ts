import { NextRequest, NextResponse } from 'next/server';
import { extractCompanyContext } from '@/lib/company_context';
import { generateSeedQueries } from '@/lib/seed_generation';
import { expandQueries } from '@/lib/serp_expand';
import { enrichWithVolume } from '@/lib/volume_enrich';
import { clusterAndRank } from '@/lib/cluster_rank';
import { addProvenanceAndConfidence } from '@/lib/output';
import { InsightsOutput } from '@/types';

/**
 * Main API endpoint: /api/insights
 * Orchestrates the full pipeline from company name to insights
 * 
 * POST /api/insights
 * Body: { company: string, website: string, geo?: string, lang?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { company, website, geo = 'US', lang = 'en' } = body;

    if (!company || typeof company !== 'string') {
      return NextResponse.json(
        { error: 'Company name is required' },
        { status: 400 }
      );
    }

    if (!website || typeof website !== 'string') {
      return NextResponse.json(
        { error: 'Website URL is required' },
        { status: 400 }
      );
    }

    // Step 1: Extract company context
    const companyProfile = await extractCompanyContext(company, website);

    // Step 2: Generate seed queries
    const seedQueries = await generateSeedQueries(companyProfile);

    // Step 3: Expand queries
    const expandedQueries = await expandQueries(seedQueries, geo, lang);

    // Step 4: Enrich with volume metrics
    const enrichedQueries = await enrichWithVolume(expandedQueries, geo, lang);

    // Step 5: Cluster and rank
    const topics = await clusterAndRank(enrichedQueries, companyProfile);

    // Step 6: Add provenance and confidence
    const output = addProvenanceAndConfidence(topics, enrichedQueries);
    output.company = company;
    output.geo = geo;
    output.lang = lang;
    output.debug.seeds_count = seedQueries.length;

    return NextResponse.json(output);
  } catch (error) {
    console.error('Error in insights pipeline:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

