import axios from 'axios';
import { SeedQuery, ExpandedQuery } from '@/types';

/**
 * Step 3: Query Expansion (SERP / PAA)
 * Expands seed queries using People Also Ask and related questions
 */

export async function expandQueries(
  seedQueries: SeedQuery[]
): Promise<ExpandedQuery[]> {
  const expanded: ExpandedQuery[] = [];

  // Start with seed queries as expanded queries
  seedQueries.forEach((seed) => {
    expanded.push({
      query: seed.query,
      source: 'llm',
      intent: seed.intent,
    });
  });

  // Expand each seed query using PAA simulation
  // Note: In production, you'd use a SERP API like SerpAPI, DataForSEO, etc.
  for (const seed of seedQueries.slice(0, 10)) { // Limit to avoid rate limits
    try {
      const paaQueries = await fetchPeopleAlsoAsk(seed.query);
      paaQueries.forEach((paaQuery) => {
        expanded.push({
          query: paaQuery,
          source: 'paa',
          parent_seed: seed.query,
          intent: seed.intent,
        });
      });
    } catch (error) {
      console.error(`Error expanding query "${seed.query}":`, error);
      // Continue with other queries
    }
  }

  // Deduplicate
  return deduplicateQueries(expanded);
}

async function fetchPeopleAlsoAsk(query: string): Promise<string[]> {
  // Simulated PAA expansion
  // In production, use SerpAPI, DataForSEO, or similar service
  
  // For prototype: generate related questions based on query patterns
  const relatedQuestions = generateRelatedQuestions(query);
  
  // If you have a SERP API key, uncomment and use:
  /*
  if (process.env.SERP_API_KEY) {
    try {
      const response = await axios.get('https://serpapi.com/search', {
        params: {
          q: query,
          api_key: process.env.SERP_API_KEY,
          engine: 'google',
        },
      });
      
      const paa = response.data?.related_questions || [];
      return paa.map((q: any) => q.question || q.title).filter(Boolean);
    } catch (error) {
      console.error('SERP API error:', error);
    }
  }
  */

  return relatedQuestions;
}

function generateRelatedQuestions(query: string): string[] {
  const lowerQuery = query.toLowerCase();
  const questions: string[] = [];

  // Generate question variations
  const questionStarters = [
    'what is',
    'how to',
    'where to',
    'when does',
    'why is',
    'can you',
    'does',
    'is',
  ];

  // Extract key terms from query
  const keyTerms = lowerQuery
    .split(/\s+/)
    .filter((word) => word.length > 3 && !['the', 'and', 'for', 'with'].includes(word))
    .slice(0, 3);

  questionStarters.forEach((starter) => {
    if (keyTerms.length > 0) {
      questions.push(`${starter} ${keyTerms.join(' ')}`);
    }
  });

  // Add specific question patterns
  if (lowerQuery.includes('vs')) {
    questions.push(`which is better ${lowerQuery.replace('vs', 'or')}`);
  }

  if (lowerQuery.includes('best')) {
    questions.push(`what are the best ${lowerQuery.replace('best', '').trim()}`);
  }

  if (lowerQuery.includes('discount') || lowerQuery.includes('code')) {
    questions.push(`how to get ${lowerQuery}`);
    questions.push(`where to find ${lowerQuery}`);
  }

  return questions.slice(0, 5); // Limit to 5 per seed
}

function deduplicateQueries(queries: ExpandedQuery[]): ExpandedQuery[] {
  const seen = new Set<string>();
  const unique: ExpandedQuery[] = [];

  for (const query of queries) {
    const normalized = query.query.toLowerCase().trim();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(query);
    }
  }

  return unique;
}

