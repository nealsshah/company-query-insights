import { NextRequest, NextResponse } from 'next/server';
import { generateSeedQueries } from '@/lib/seed_generation';
import { extractCompanyContext } from '@/lib/company_context';

/**
 * Step 2 API endpoint: /api/steps/seed-queries
 * Generates seed queries from company profile
 * 
 * POST /api/steps/seed-queries
 * Body: { company: string, website: string } OR { companyProfile: CompanyProfile }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { company, website, companyProfile } = body;

    let profile;
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

    const seedQueries = await generateSeedQueries(profile);
    return NextResponse.json({ queries: seedQueries, count: seedQueries.length });
  } catch (error) {
    console.error('Error generating seed queries:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

