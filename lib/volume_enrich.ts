import axios, { AxiosError } from 'axios';
import { ExpandedQuery, EnrichedQuery, VolumeMetrics } from '@/types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Step 4: Attach "Demand" Metrics (Volume / Importance)
 * Enriches queries with search volume, CPC, and competition data using DataForSEO API
 */

interface DataForSEOResult {
  keyword: string;
  search_volume?: number;
  cpc?: number;
  competition?: number;
  competition_level?: string;
}

interface CacheEntry {
  keyword_normalized: string;
  volume_monthly: number | null;
  competition: string | null;
  cpc_usd: number | null;
  has_volume: boolean;
  volume_provider: string;
  fetched_at: string;
  geo: string;
  lang: string;
}

// In-memory cache for the session + file-based persistence
const volumeCache = new Map<string, CacheEntry>();
const CACHE_FILE_PATH = path.join(process.cwd(), '.volume-cache.json');

// Load cache from file on module init
function loadCacheFromFile(): void {
  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      const data = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
      const entries: CacheEntry[] = JSON.parse(data);
      entries.forEach(entry => {
        const key = getCacheKey(entry.keyword_normalized, entry.geo, entry.lang);
        volumeCache.set(key, entry);
      });
      console.log(`Loaded ${entries.length} cached volume entries`);
    }
  } catch (error) {
    console.warn('Failed to load volume cache:', error);
  }
}

// Save cache to file
function saveCacheToFile(): void {
  try {
    const entries = Array.from(volumeCache.values());
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(entries, null, 2));
  } catch (error) {
    console.warn('Failed to save volume cache:', error);
  }
}

// Load cache on startup
loadCacheFromFile();

function getCacheKey(keyword: string, geo: string, lang: string): string {
  return `dataforseo:${geo}:${lang}:${normalizeKeyword(keyword)}`;
}

function normalizeKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')     // Normalize whitespace
    .trim();
}

/**
 * Sanitize keyword for DataForSEO API - removes characters that cause API rejection
 * DataForSEO doesn't accept: commas, certain special characters
 */
function sanitizeKeywordForAPI(keyword: string): string {
  return keyword
    .replace(/,/g, ' ')        // Replace commas with spaces
    .replace(/[^\w\s\-']/g, '') // Keep only word chars, spaces, hyphens, apostrophes
    .replace(/\s+/g, ' ')       // Normalize whitespace
    .trim();
}

export async function enrichWithVolume(
  queries: ExpandedQuery[],
  geo: string = 'US',
  lang: string = 'en'
): Promise<EnrichedQuery[]> {
  // Validate inputs
  if (!queries || !Array.isArray(queries)) {
    throw new Error('queries must be a non-empty array');
  }

  if (!geo || typeof geo !== 'string') {
    geo = 'US';
  }

  if (!lang || typeof lang !== 'string') {
    lang = 'en';
  }

  // Try DataForSEO first
  if (hasDataForSEOCredentials()) {
    try {
      return await enrichWithDataForSEO(queries, geo, lang);
    } catch (error: any) {
      console.error('DataForSEO API error, falling back:', error?.message || error);
      // Fall through to fallback
    }
  } else {
    console.warn('DataForSEO credentials not found (DATA4SEO_API_KEY), using fallback estimation');
  }

  // Fallback to estimated metrics
  return enrichWithFallback(queries, geo, lang);
}

function hasDataForSEOCredentials(): boolean {
  return !!(process.env.DATA4SEO_USERNAME && process.env.DATA4SEO_PASSWORD);
}

function getDataForSEOAuth(): { username: string; password: string } {
  // DataForSEO uses Basic Auth with username (login email) and password (API password)
  const username = process.env.DATA4SEO_USERNAME || '';
  const password = process.env.DATA4SEO_PASSWORD || '';

  return { username, password };
}

async function enrichWithDataForSEO(
  queries: ExpandedQuery[],
  geo: string,
  lang: string
): Promise<EnrichedQuery[]> {
  const auth = getDataForSEOAuth();

  // Extract unique keywords and check cache
  const keywordMap = new Map<string, ExpandedQuery[]>();
  const uncachedKeywords: string[] = [];
  const cachedResults = new Map<string, CacheEntry>();

  for (const query of queries) {
    const keyword = query.query;
    const normalized = normalizeKeyword(keyword);
    const cacheKey = getCacheKey(keyword, geo, lang);

    // Group queries by normalized keyword
    if (!keywordMap.has(normalized)) {
      keywordMap.set(normalized, []);
    }
    keywordMap.get(normalized)!.push(query);

    // Check cache
    const cached = volumeCache.get(cacheKey);
    if (cached) {
      cachedResults.set(normalized, cached);
    } else if (!uncachedKeywords.includes(keyword)) {
      uncachedKeywords.push(keyword);
    }
  }

  console.log(`Volume enrichment: ${cachedResults.size} cached, ${uncachedKeywords.length} to fetch`);

  // Fetch uncached keywords from DataForSEO in batches
  const freshResults = new Map<string, CacheEntry>();

  if (uncachedKeywords.length > 0) {
    // Limit to top N queries to save budget (200-700 recommended)
    const keywordsToFetch = uncachedKeywords.slice(0, 500);

    if (uncachedKeywords.length > 500) {
      console.warn(`Limiting DataForSEO fetch to 500 keywords (${uncachedKeywords.length} requested)`);
    }

    // Batch requests (DataForSEO supports up to 700 keywords per request for search_volume endpoint)
    const batchSize = 500;

    for (let i = 0; i < keywordsToFetch.length; i += batchSize) {
      const batch = keywordsToFetch.slice(i, i + batchSize);

      try {
        const batchResults = await fetchDataForSEOBatch(batch, geo, lang, auth);

        // Process results and add to cache
        for (const result of batchResults) {
          const normalized = normalizeKeyword(result.keyword);
          const cacheEntry: CacheEntry = {
            keyword_normalized: normalized,
            volume_monthly: result.search_volume ?? null,
            competition: result.competition_level || mapCompetitionValue(result.competition),
            cpc_usd: result.cpc ?? null,
            has_volume: result.search_volume !== undefined && result.search_volume !== null,
            volume_provider: 'dataforseo:google_ads',
            fetched_at: new Date().toISOString(),
            geo,
            lang,
          };

          freshResults.set(normalized, cacheEntry);

          // Add to cache
          const cacheKey = getCacheKey(result.keyword, geo, lang);
          volumeCache.set(cacheKey, cacheEntry);
        }

        // Also mark keywords that weren't in the response as having no volume
        for (const keyword of batch) {
          const normalized = normalizeKeyword(keyword);
          if (!freshResults.has(normalized)) {
            const cacheEntry: CacheEntry = {
              keyword_normalized: normalized,
              volume_monthly: null,
              competition: null,
              cpc_usd: null,
              has_volume: false,
              volume_provider: 'dataforseo:google_ads',
              fetched_at: new Date().toISOString(),
              geo,
              lang,
            };
            freshResults.set(normalized, cacheEntry);
            const cacheKey = getCacheKey(keyword, geo, lang);
            volumeCache.set(cacheKey, cacheEntry);
          }
        }

        // Rate limit between batches
        if (i + batchSize < keywordsToFetch.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error: any) {
        console.error(`DataForSEO batch error:`, error?.message);
        // Continue with next batch
      }
    }

    // Save cache after fetching
    saveCacheToFile();
  }

  // Merge cached and fresh results with original queries
  const enriched: EnrichedQuery[] = [];

  for (const query of queries) {
    const normalized = normalizeKeyword(query.query);
    const metrics = freshResults.get(normalized) || cachedResults.get(normalized);

    if (metrics) {
      enriched.push({
        ...query,
        volume_monthly: metrics.volume_monthly ?? undefined,
        competition: mapCompetition(metrics.competition),
        cpc: metrics.cpc_usd ?? undefined,
        geo,
        lang,
        volume_provider: metrics.volume_provider,
        has_volume: metrics.has_volume,
      });
    } else {
      // No metrics found - try fallback variants
      const fallbackMetrics = await tryFallbackVariants(query.query, geo, lang, auth, freshResults, cachedResults);

      enriched.push({
        ...query,
        volume_monthly: fallbackMetrics?.volume_monthly ?? undefined,
        competition: fallbackMetrics ? mapCompetition(fallbackMetrics.competition) : undefined,
        cpc: fallbackMetrics?.cpc_usd ?? undefined,
        geo,
        lang,
        volume_provider: fallbackMetrics?.volume_provider || 'dataforseo:google_ads',
        volume_source_query: fallbackMetrics?.keyword_normalized !== normalized ? fallbackMetrics?.keyword_normalized : undefined,
        has_volume: fallbackMetrics?.has_volume || false,
      });
    }
  }

  return enriched;
}

async function fetchDataForSEOBatch(
  keywords: string[],
  geo: string,
  lang: string,
  auth: { username: string; password: string }
): Promise<DataForSEOResult[]> {
  const locationName = getLocationName(geo);
  const languageName = getLanguageName(lang);

  // Sanitize keywords and create mapping back to originals
  const sanitizedToOriginal = new Map<string, string>();
  const sanitizedKeywords: string[] = [];

  for (const keyword of keywords) {
    const sanitized = sanitizeKeywordForAPI(keyword);
    if (sanitized.length > 0) {
      sanitizedKeywords.push(sanitized);
      // Map sanitized back to original (use first occurrence if duplicates)
      if (!sanitizedToOriginal.has(sanitized.toLowerCase())) {
        sanitizedToOriginal.set(sanitized.toLowerCase(), keyword);
      }
    }
  }

  if (sanitizedKeywords.length === 0) {
    console.warn('No valid keywords after sanitization');
    return [];
  }

  const payload = [
    {
      keywords: sanitizedKeywords,
      location_name: locationName,
      language_name: languageName,
    }
  ];

  console.log(`Fetching DataForSEO metrics for ${sanitizedKeywords.length} keywords (${locationName}, ${languageName})`);

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(
        'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live',
        payload,
        {
          auth: {
            username: auth.username,
            password: auth.password,
          },
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 60000, // 60 second timeout for large batches
        }
      );

      // Parse DataForSEO response
      const results: DataForSEOResult[] = [];

      if (response.data?.tasks) {
        for (const task of response.data.tasks) {
          if (task.status_code === 20000 && task.result) {
            for (const item of task.result) {
              // Map back to original keyword if we have a mapping
              const originalKeyword = sanitizedToOriginal.get(item.keyword?.toLowerCase()) || item.keyword;
              results.push({
                keyword: originalKeyword,
                search_volume: item.search_volume,
                cpc: item.cpc,
                competition: item.competition,
                competition_level: item.competition_level,
              });
            }
          } else if (task.status_code !== 20000) {
            console.warn(`DataForSEO task warning: ${task.status_message}`);
          }
        }
      }

      console.log(`DataForSEO returned ${results.length} results for ${keywords.length} keywords`);
      return results;

    } catch (error: any) {
      lastError = error;

      const status = error?.response?.status;
      const isRetryable = status === 429 || status >= 500;

      if (isRetryable && attempt < maxRetries) {
        const backoff = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.warn(`DataForSEO request failed (${status}), retrying in ${backoff}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }

      console.error(`DataForSEO API error:`, error?.response?.data || error?.message);
      throw error;
    }
  }

  throw lastError || new Error('DataForSEO request failed after retries');
}

async function tryFallbackVariants(
  query: string,
  geo: string,
  lang: string,
  auth: { username: string; password: string },
  freshResults: Map<string, CacheEntry>,
  cachedResults: Map<string, CacheEntry>
): Promise<CacheEntry | null> {
  // Generate simplified variants of the query
  const variants = generateQueryVariants(query);

  // Check if any variant is already in our results
  for (const variant of variants.slice(1)) { // Skip first (original) variant
    const normalized = normalizeKeyword(variant);
    const existing = freshResults.get(normalized) || cachedResults.get(normalized);
    if (existing && existing.has_volume) {
      return existing;
    }
  }

  // Don't make additional API calls for variants - too expensive
  // Just return null and the query will be marked as no volume
  return null;
}

function generateQueryVariants(query: string): string[] {
  if (!query || typeof query !== 'string') {
    return [];
  }

  const variants: string[] = [query]; // Try exact first

  // Remove trailing punctuation/question marks
  let cleaned = query.replace(/[.,;:!?]+$/, '').trim();
  if (cleaned && cleaned !== query) {
    variants.push(cleaned);
  }

  if (!cleaned) {
    return variants;
  }

  // Drop leading question words
  const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'does', 'do', 'is', 'are', 'can', 'will'];
  const lowerCleaned = cleaned.toLowerCase();

  for (const word of questionWords) {
    if (lowerCleaned.startsWith(word + ' ')) {
      const withoutQuestion = cleaned.substring(word.length + 1).trim();
      if (withoutQuestion.length > 0) {
        variants.push(withoutQuestion);
      }
    }
  }

  // Create short noun phrase (take first 2-3 meaningful words after removing question words)
  const words = cleaned.split(/\s+/).filter(w => {
    if (!w || w.length === 0) return false;
    const lower = w.toLowerCase();
    return !questionWords.includes(lower) &&
      !['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with'].includes(lower) &&
      w.length > 2;
  });

  if (words.length > 2) {
    variants.push(words.slice(0, 3).join(' '));
  }

  // Remove duplicates while preserving order
  return Array.from(new Set(variants));
}

function mapCompetitionValue(competition?: number): string | null {
  if (competition === undefined || competition === null) return null;
  if (competition < 0.33) return 'LOW';
  if (competition < 0.67) return 'MEDIUM';
  return 'HIGH';
}

function mapCompetition(competition?: string | null): 'low' | 'medium' | 'high' | undefined {
  if (!competition) return undefined;

  const lower = competition.toLowerCase();
  if (lower.includes('low') || lower === 'low') return 'low';
  if (lower.includes('high') || lower === 'high') return 'high';
  return 'medium';
}

function getLocationName(geo: string): string {
  const locationMap: Record<string, string> = {
    'US': 'United States',
    'GB': 'United Kingdom',
    'CA': 'Canada',
    'AU': 'Australia',
    'DE': 'Germany',
    'FR': 'France',
    'ES': 'Spain',
    'IT': 'Italy',
    'NL': 'Netherlands',
    'SE': 'Sweden',
    'JP': 'Japan',
    'BR': 'Brazil',
    'MX': 'Mexico',
    'IN': 'India',
  };

  return locationMap[geo.toUpperCase()] || 'United States';
}

function getLanguageName(lang: string): string {
  const languageMap: Record<string, string> = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'nl': 'Dutch',
    'sv': 'Swedish',
    'ja': 'Japanese',
    'zh': 'Chinese',
  };

  return languageMap[lang.toLowerCase()] || 'English';
}

function enrichWithFallback(
  queries: ExpandedQuery[],
  geo: string,
  lang: string
): Promise<EnrichedQuery[]> {
  const keywords = queries.map((q) => q.query);
  const metrics = estimateVolumeMetrics(keywords, geo, lang);

  return Promise.resolve(queries.map((query, index) => {
    const metric = metrics[index] || {
      geo,
      lang,
      source: 'estimated:fallback',
    };

    return {
      ...query,
      volume_monthly: metric.volume_monthly,
      volume_range: metric.volume_range,
      competition: metric.competition,
      cpc: metric.cpc,
      geo: query.geo || geo,
      lang: query.lang || lang,
      volume_provider: metric.source,
      has_volume: !!metric.volume_monthly,
    };
  }));
}

function estimateVolumeMetrics(
  keywords: string[],
  geo: string,
  lang: string
): VolumeMetrics[] {
  // Fallback: estimate volume based on query characteristics
  return keywords.map((keyword) => {
    const lowerKeyword = keyword.toLowerCase();

    // Heuristic: brand queries tend to have higher volume
    const isBrandQuery = lowerKeyword.split(/\s+/).some(
      (word) => word.length > 4 && !['the', 'and', 'for', 'with', 'best', 'how', 'what'].includes(word)
    );

    // Heuristic: question queries have moderate volume
    const isQuestion = lowerKeyword.startsWith('what') ||
      lowerKeyword.startsWith('how') ||
      lowerKeyword.startsWith('why') ||
      lowerKeyword.includes('?');

    // Heuristic: transactional queries have higher volume
    const isTransactional = lowerKeyword.includes('buy') ||
      lowerKeyword.includes('discount') ||
      lowerKeyword.includes('price') ||
      lowerKeyword.includes('code');

    // Estimate volume (simplified)
    let volume = 100; // Base volume
    if (isBrandQuery) volume *= 10;
    if (isTransactional) volume *= 5;
    if (isQuestion) volume *= 2;

    // Add some randomness to make it more realistic
    volume = Math.floor(volume * (0.5 + Math.random()));

    // Estimate competition
    let competition: 'low' | 'medium' | 'high' = 'medium';
    if (volume > 1000) competition = 'high';
    if (volume < 100) competition = 'low';

    // Estimate CPC (in USD)
    const cpc = volume > 1000 ? 1.5 + Math.random() : 0.5 + Math.random() * 0.5;

    return {
      volume_monthly: volume,
      volume_range: `${Math.floor(volume * 0.7)}-${Math.floor(volume * 1.3)}`,
      competition,
      cpc: Math.round(cpc * 100) / 100,
      geo,
      lang,
      source: 'estimated:fallback',
    };
  });
}
