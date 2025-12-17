import OpenAI from 'openai';
import { CompanyProfile, SeedQuery } from '@/types';
import { generateCacheKey, getCache, setCache } from './cache';

/**
 * Step 2: Seed Query Generation (LLM)
 * Uses LLM to generate diverse seed queries based on company profile
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Cache duration: 7 days for seed queries
const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export async function generateSeedQueries(
  companyProfile: CompanyProfile
): Promise<SeedQuery[]> {
  // Check cache first
  const cacheKey = generateCacheKey('seed_queries', companyProfile.name.toLowerCase(), companyProfile.website);
  const cached = getCache<SeedQuery[]>(cacheKey, CACHE_DURATION_MS);
  if (cached) {
    return cached;
  }

  if (!process.env.OPENAI_API_KEY) {
    // Fallback: return basic queries if no API key
    const fallback = generateFallbackQueries(companyProfile);
    setCache(cacheKey, fallback);
    return fallback;
  }

  const prompt = buildSeedPrompt(companyProfile);

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an SEO expert that generates diverse search queries. Return valid JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      const fallback = generateFallbackQueries(companyProfile);
      setCache(cacheKey, fallback);
      return fallback;
    }

    const parsed = JSON.parse(content);
    const queries = parsed.queries || generateFallbackQueries(companyProfile);
    
    // Cache the result
    setCache(cacheKey, queries);
    
    return queries;
  } catch (error) {
    console.error('Error generating seed queries:', error);
    const fallback = generateFallbackQueries(companyProfile);
    setCache(cacheKey, fallback);
    return fallback;
  }
}

function buildSeedPrompt(profile: CompanyProfile): string {
  return `Generate 12-20 diverse search queries related to "${profile.name}".

Company context:
- Products: ${profile.products.join(', ') || 'Not specified'}
- Services: ${profile.services.join(', ') || 'Not specified'}
- Target Audience: ${profile.targetAudience.join(', ') || 'Not specified'}
- Categories: ${profile.categories.join(', ') || 'Not specified'}
- Website: ${profile.website || 'Not found'}

Generate queries with mixed intents:
1. Brand navigational (e.g., "${profile.name.toLowerCase()} store", "${profile.name.toLowerCase()} return policy")
2. Product discovery (e.g., "best ${profile.name.toLowerCase()} leggings")
3. Comparison (e.g., "${profile.name.toLowerCase()} vs nike")
4. Informational (e.g., "is ${profile.name.toLowerCase()} good quality")
5. Transactional (e.g., "${profile.name.toLowerCase()} discount code", "${profile.name.toLowerCase()} student discount")
6. Troubleshooting (e.g., "${profile.name.toLowerCase()} login not working")

Return JSON in this exact format:
{
  "queries": [
    {
      "query": "the search query text",
      "intent": "one of: navigational, informational, transactional, comparison, discovery, troubleshooting",
      "rationale": "brief explanation of why this query is relevant"
    }
  ]
}`;
}

function generateFallbackQueries(profile: CompanyProfile): SeedQuery[] {
  const companyLower = profile.name.toLowerCase();
  const baseQueries: SeedQuery[] = [
    {
      query: `${companyLower} store`,
      intent: 'navigational',
      rationale: 'Direct brand search',
      seed_type: 'llm',
    },
    {
      query: `${companyLower} return policy`,
      intent: 'informational',
      rationale: 'Common customer service query',
      seed_type: 'llm',
    },
    {
      query: `best ${companyLower} products`,
      intent: 'discovery',
      rationale: 'Product discovery intent',
      seed_type: 'llm',
    },
    {
      query: `${companyLower} vs competitors`,
      intent: 'comparison',
      rationale: 'Comparison shopping intent',
      seed_type: 'llm',
    },
    {
      query: `${companyLower} discount code`,
      intent: 'transactional',
      rationale: 'Deal-seeking intent',
      seed_type: 'llm',
    },
    {
      query: `is ${companyLower} good quality`,
      intent: 'informational',
      rationale: 'Quality assessment query',
      seed_type: 'llm',
    },
    {
      query: `${companyLower} customer service`,
      intent: 'navigational',
      rationale: 'Support-related query',
      seed_type: 'llm',
    },
    {
      query: `${companyLower} reviews`,
      intent: 'informational',
      rationale: 'Review-seeking intent',
      seed_type: 'llm',
    },
  ];

  // Add product-specific queries if available
  if (profile.products.length > 0) {
    profile.products.slice(0, 5).forEach((product) => {
      baseQueries.push({
        query: `${companyLower} ${product}`,
        intent: 'discovery',
        rationale: `Product-specific search for ${product}`,
        seed_type: 'llm',
      });
    });
  }

  return baseQueries;
}

