import { NextRequest, NextResponse } from 'next/server';
import { extractCompanyContext } from '@/lib/company_context';

/**
 * Step 1 API endpoint: /api/steps/company-context
 * Extracts company context from website
 * 
 * POST /api/steps/company-context
 * Body: { company: string, website: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { company, website } = body;

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

    const profile = await extractCompanyContext(company, website);
    
    // Add debug info if scraping failed
    const response: any = { ...profile };
    if (!profile.extractedText || profile.extractedText.length === 0) {
      response.debug = {
        warning: 'No text extracted from website. This could be due to:',
        possibleReasons: [
          'Website requires JavaScript rendering (SPA)',
          'Website blocks automated requests',
          'Network/timeout issues',
          'Invalid or inaccessible URL'
        ],
        suggestion: 'Check server logs for detailed error messages'
      };
    }
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error extracting company context:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

