import axios from 'axios';
import { CompanyProfile, EnrichedQuery } from '@/types';
import { generateCacheKey, getCache, setCache } from './cache';

// Cache duration: 7 days for SERP brand affinity results
const BRAND_AFFINITY_CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export type QueryType = 'brand_intent' | 'category_opportunity' | 'low_relevance';

export interface BrandAffinityFields {
  brand_affinity: number; // 0..1
  brand_domain_hit: boolean;
  brand_domain_rank: number | null; // 1-indexed
  brand_mention_count: number;
  query_type: QueryType;
  serp_checked_at: string; // ISO timestamp
}

export interface BrandAffinityOptions {
  geo?: string;
  lang?: string;
  serp_top_n?: number;
  max_queries?: number;
  brand_domains?: string[];
  brand_terms?: string[];
  category_opportunity_threshold?: number; // default 0.35
  min_delay_ms?: number; // default 200ms between SERP calls
}

function normalizeQuery(q: string): string {
  return (q || '')
    .toLowerCase()
    .trim()
    .replace(/[?.!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDomain(input: string): string {
  const raw = (input || '').trim().toLowerCase();
  const noProtocol = raw.replace(/^https?:\/\//, '');
  const noPath = noProtocol.split('/')[0] || '';
  const noWww = noPath.replace(/^www\./, '');
  return noWww;
}

function getHostnameFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function domainMatches(hostname: string, brandDomains: string[]): boolean {
  const host = normalizeDomain(hostname);
  return brandDomains.some((d) => {
    const dom = normalizeDomain(d);
    return host === dom || host.endsWith(`.${dom}`);
  });
}

function containsAnyTerm(text: string, terms: string[]): boolean {
  const lower = (text || '').toLowerCase();
  return terms.some((t) => t && lower.includes(t.toLowerCase()));
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function computeBrandAffinityScore(domainRank: number | null, mentionCount: number): number {
  const rankScore = domainRank ? 1 / Math.sqrt(Math.max(1, domainRank)) : 0;
  const mentionsScore = Math.min(1, mentionCount / 3);
  return clamp01(0.65 * rankScore + 0.35 * mentionsScore);
}

function classifyQuery(query: string, brandTerms: string[], brandAffinity: number, threshold: number): QueryType {
  const normalized = normalizeQuery(query);
  const isBrandIntent = brandTerms.some((t) => t && normalized.includes(t.toLowerCase()));
  if (isBrandIntent) return 'brand_intent';
  if (brandAffinity >= threshold) return 'category_opportunity';
  return 'low_relevance';
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSerpRaw(query: string, geo: string, lang: string, topN: number) {
  if (!process.env.SERP_API_KEY) {
    throw new Error('SERP_API_KEY not set');
  }

  const response = await axios.get('https://serpapi.com/search', {
    params: {
      q: query,
      api_key: process.env.SERP_API_KEY,
      engine: 'google',
      gl: geo.toLowerCase(),
      hl: lang.toLowerCase(),
      num: topN,
    },
    timeout: 15000,
  });

  return response.data;
}

function extractMentionTextBlocks(serp: any): string[] {
  const blocks: string[] = [];

  const answerBox = serp?.answer_box;
  if (answerBox) {
    blocks.push(answerBox?.title, answerBox?.snippet, answerBox?.answer, answerBox?.description);
  }

  const knowledgeGraph = serp?.knowledge_graph;
  if (knowledgeGraph) {
    blocks.push(knowledgeGraph?.title, knowledgeGraph?.description);
    if (Array.isArray(knowledgeGraph?.people_also_search_for)) {
      for (const item of knowledgeGraph.people_also_search_for) {
        blocks.push(item?.name);
      }
    }
  }

  const organic = Array.isArray(serp?.organic_results) ? serp.organic_results : [];
  for (const r of organic) {
    blocks.push(r?.title, r?.snippet);
    if (Array.isArray(r?.sitelinks?.inline)) {
      for (const sl of r.sitelinks.inline) {
        blocks.push(sl?.title, sl?.snippet);
      }
    }
  }

  return blocks.filter((x) => typeof x === 'string' && x.trim().length > 0);
}

function computeAffinityFromSerp(
  serp: any,
  brandDomains: string[],
  brandTerms: string[],
  topN: number
): Pick<BrandAffinityFields, 'brand_domain_hit' | 'brand_domain_rank' | 'brand_mention_count' | 'brand_affinity'> {
  const organic = Array.isArray(serp?.organic_results) ? serp.organic_results : [];

  let domainHit = false;
  let domainRank: number | null = null;
  let mentionCount = 0;

  for (let i = 0; i < Math.min(topN, organic.length); i++) {
    const r = organic[i];
    const position = typeof r?.position === 'number' ? r.position : i + 1;
    const linkHost = getHostnameFromUrl(r?.link);
    const isDomainMatch = linkHost ? domainMatches(linkHost, brandDomains) : false;

    const title = typeof r?.title === 'string' ? r.title : '';
    const snippet = typeof r?.snippet === 'string' ? r.snippet : '';
    const isTermMatch = containsAnyTerm(`${title}\n${snippet}`, brandTerms);

    if (isDomainMatch && domainRank === null) {
      domainHit = true;
      domainRank = position;
    }

    if (isDomainMatch || isTermMatch) {
      mentionCount += 1;
    }
  }

  // Also count mentions in answer box / knowledge graph, but don't inflate beyond topN too much:
  // we only use these for term presence signals, not for domain rank.
  const extraBlocks = extractMentionTextBlocks(serp);
  const extraTermHit = extraBlocks.some((b) => containsAnyTerm(b, brandTerms));
  if (extraTermHit && mentionCount === 0) {
    mentionCount = 1;
  }

  const brandAffinity = computeBrandAffinityScore(domainRank, mentionCount);
  return {
    brand_domain_hit: domainHit,
    brand_domain_rank: domainRank,
    brand_mention_count: mentionCount,
    brand_affinity: brandAffinity,
  };
}

export async function addBrandAffinityToQueries(
  queries: EnrichedQuery[],
  companyProfile: CompanyProfile,
  options: BrandAffinityOptions = {}
): Promise<EnrichedQuery[]> {
  const geo = options.geo || 'US';
  const lang = options.lang || 'en';
  const topN = options.serp_top_n ?? 10;
  const maxQueries = options.max_queries ?? 300;
  const threshold = options.category_opportunity_threshold ?? 0.35;
  const minDelayMs = options.min_delay_ms ?? 200;

  const brandDomains =
    (options.brand_domains && options.brand_domains.length > 0)
      ? options.brand_domains.map(normalizeDomain).filter(Boolean)
      : (companyProfile.website ? [normalizeDomain(companyProfile.website)] : []).filter(Boolean);

  const brandTerms =
    (options.brand_terms && options.brand_terms.length > 0)
      ? options.brand_terms.map((t) => (t || '').toLowerCase()).filter(Boolean)
      : (companyProfile.brandTerms || []).map((t) => (t || '').toLowerCase()).filter(Boolean);

  // If we don't have brand terms, we can still use domain hit, but classification won't be great.
  const safeBrandTerms = brandTerms.length > 0 ? brandTerms : [companyProfile.name.toLowerCase()];

  // Only run SERP checks on top N queries by volume_monthly (falling back to original order).
  const indexed = queries.map((q, idx) => ({ q, idx }));
  indexed.sort((a, b) => ((b.q.volume_monthly || 0) - (a.q.volume_monthly || 0)));
  const toCheck = indexed.slice(0, Math.min(maxQueries, indexed.length));

  const resultsByIndex = new Map<number, BrandAffinityFields>();

  // If SERP isn't configured, do a deterministic fallback (brand_intent only).
  if (!process.env.SERP_API_KEY) {
    const now = new Date().toISOString();
    for (const { q, idx } of indexed) {
      const brandAffinity = 0;
      resultsByIndex.set(idx, {
        brand_affinity: brandAffinity,
        brand_domain_hit: false,
        brand_domain_rank: null,
        brand_mention_count: 0,
        query_type: classifyQuery(q.query, safeBrandTerms, brandAffinity, threshold),
        serp_checked_at: now,
      });
    }
    return queries.map((q, i) => ({ ...q, ...resultsByIndex.get(i)! }));
  }

  for (let i = 0; i < toCheck.length; i++) {
    const { q, idx } = toCheck[i];
    const queryNorm = normalizeQuery(q.query);
    const cacheKey = generateCacheKey(
      'brand_affinity_serp',
      queryNorm,
      geo.toLowerCase(),
      lang.toLowerCase(),
      topN,
      brandDomains,
      safeBrandTerms
    );

    const cached = getCache<BrandAffinityFields>(cacheKey, BRAND_AFFINITY_CACHE_DURATION_MS);
    if (cached) {
      resultsByIndex.set(idx, cached);
      continue;
    }

    const serp = await fetchSerpRaw(q.query, geo, lang, topN);
    const affinity = computeAffinityFromSerp(serp, brandDomains, safeBrandTerms, topN);

    const checkedAt = new Date().toISOString();
    const brandAffinity = affinity.brand_affinity;
    const fields: BrandAffinityFields = {
      ...affinity,
      query_type: classifyQuery(q.query, safeBrandTerms, brandAffinity, threshold),
      serp_checked_at: checkedAt,
    };

    setCache(cacheKey, fields);
    resultsByIndex.set(idx, fields);

    // Avoid throttling
    if (i < toCheck.length - 1) {
      await sleep(minDelayMs);
    }
  }

  // For queries we didn't SERP-check, set to conservative defaults.
  const now = new Date().toISOString();
  for (const { q, idx } of indexed.slice(toCheck.length)) {
    const brandAffinity = 0;
    resultsByIndex.set(idx, {
      brand_affinity: brandAffinity,
      brand_domain_hit: false,
      brand_domain_rank: null,
      brand_mention_count: 0,
      query_type: classifyQuery(q.query, safeBrandTerms, brandAffinity, threshold),
      serp_checked_at: now,
    });
  }

  return queries.map((q, i) => ({
    ...q,
    ...resultsByIndex.get(i)!,
  }));
}


