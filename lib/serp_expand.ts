import axios from 'axios';
import { SeedQuery, ExpandedQuery } from '@/types';

/**
 * Step 3: Query Expansion (SERP / PAA)
 * Expands seed queries using People Also Ask and related questions via SerpAPI
 */

export async function expandQueries(
  seedQueries: SeedQuery[] | Array<{ query: string; intent?: string }>,
  geo: string = 'US',
  lang: string = 'en'
): Promise<ExpandedQuery[]> {
  const expanded: ExpandedQuery[] = [];

  // Start with seed queries as expanded queries
  seedQueries.forEach((seed) => {
    expanded.push({
      query: seed.query,
      source: 'llm',
      intent: seed.intent,
      geo,
      lang,
    });
  });

  // Expand each seed query using SerpAPI PAA
  if (!process.env.SERP_API_KEY) {
    console.warn('SERP_API_KEY not found, using fallback expansion');
    return expandQueriesFallback(seedQueries, geo, lang);
  }

  for (const seed of seedQueries) {
    try {
      const paaQueries = await fetchPeopleAlsoAsk(seed.query, geo, lang);

      paaQueries.forEach((paaQuery) => {
        expanded.push({
          query: paaQuery,
          source: 'paa',
          parent_seed: seed.query,
          intent: seed.intent,
          geo,
          lang,
        });
      });

      // Add small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`Error expanding query "${seed.query}":`, error);
      // Continue with other queries
    }
  }

  // Deduplicate and filter
  return deduplicateAndFilter(expanded);
}

async function fetchPeopleAlsoAsk(
  query: string,
  geo: string = 'US',
  lang: string = 'en'
): Promise<string[]> {
  if (!process.env.SERP_API_KEY) {
    return generateRelatedQuestions(query);
  }

  try {
    const response = await axios.get('https://serpapi.com/search', {
      params: {
        q: query,
        api_key: process.env.SERP_API_KEY,
        engine: 'google',
        gl: geo.toLowerCase(),
        hl: lang.toLowerCase(),
        num: 10, // Get more results
      },
      timeout: 10000,
    });

    const questions: string[] = [];

    // Extract People Also Ask questions
    const relatedQuestions = response.data?.related_questions || [];
    for (const item of relatedQuestions) {
      if (item.question) {
        questions.push(item.question);
      }
      // Some APIs nest questions in a questions array
      if (item.questions && Array.isArray(item.questions)) {
        for (const q of item.questions) {
          if (q.question) {
            questions.push(q.question);
          }
        }
      }
    }

    // Extract related searches (optional, for extra breadth)
    const relatedSearches = response.data?.related_searches || [];
    for (const search of relatedSearches) {
      if (search.query) {
        questions.push(search.query);
      }
    }

    // Filter and clean questions
    const cleaned = questions
      .map(q => cleanQuery(q))
      .filter(q => isValidQuery(q));

    console.log(`Found ${cleaned.length} PAA queries for "${query}"`);
    return cleaned;
  } catch (error: any) {
    console.error(`SerpAPI error for query "${query}":`, error.message);
    // Fallback to generated questions
    return generateRelatedQuestions(query);
  }
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

function cleanQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[.,;:!?]+$/, '') // Remove trailing punctuation
    .replace(/\s+/g, ' ') // Collapse repeated spaces
    .trim();
}

function isValidQuery(query: string): boolean {
  if (!query || query.length < 5) return false;

  // Must have at least 3 words
  const words = query.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 3) return false;

  // Filter out obvious non-queries
  const junkPatterns = [
    /^(the|a|an|and|or|but|in|on|at|to|for|of|with)$/i,
    /^[0-9]+$/,
  ];

  if (junkPatterns.some(pattern => pattern.test(query))) {
    return false;
  }

  return true;
}

function deduplicateAndFilter(queries: ExpandedQuery[]): ExpandedQuery[] {
  const seen = new Set<string>();
  const unique: ExpandedQuery[] = [];

  for (const query of queries) {
    const normalized = cleanQuery(query.query);

    if (!seen.has(normalized) && isValidQuery(normalized)) {
      seen.add(normalized);
      // Update query with cleaned version
      unique.push({
        ...query,
        query: normalized.charAt(0).toUpperCase() + normalized.slice(1), // Capitalize first letter
      });
    }
  }

  return unique;
}

function expandQueriesFallback(
  seedQueries: SeedQuery[] | Array<{ query: string; intent?: string }>,
  geo: string,
  lang: string
): ExpandedQuery[] {
  const expanded: ExpandedQuery[] = [];

  // Start with seed queries
  seedQueries.forEach((seed) => {
    expanded.push({
      query: seed.query,
      source: 'llm',
      intent: seed.intent,
      geo,
      lang,
    });
  });

  // Generate fallback questions
  for (const seed of seedQueries) {
    const relatedQuestions = generateRelatedQuestions(seed.query);
    relatedQuestions.forEach((paaQuery) => {
      expanded.push({
        query: paaQuery,
        source: 'paa',
        parent_seed: seed.query,
        intent: seed.intent,
        geo,
        lang,
      });
    });
  }

  return deduplicateAndFilter(expanded);
}

