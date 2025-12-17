import OpenAI from 'openai';
import { EnrichedQuery, QueryWithScore, Topic, CompanyProfile, QueryResult } from '@/types';
import { generateCacheKey, getCache, setCache } from './cache';

/**
 * Step 5: Topic Clustering + Ranking
 * Groups queries into topics using embeddings and clustering, then ranks them
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Cache duration: 30 days for embeddings (they don't change)
const EMBEDDING_CACHE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

interface NormalizedQuery extends EnrichedQuery {
  query_original: string;
  query_normalized: string;
}

interface QueryWithEmbedding extends NormalizedQuery {
  embedding?: number[];
}

interface ScoredQuery extends QueryWithEmbedding {
  volume_score: number;
  relevance_score: number;
  source_bonus: number;
  intent_weight: number;
  query_score: number;
  confidence: number;
}

interface ClusterResult {
  topic_id: string;
  queries: ScoredQuery[];
  centroid?: number[];
}

export async function clusterAndRank(
  enrichedQueries: EnrichedQuery[],
  companyProfile: CompanyProfile
): Promise<Topic[]> {
  console.log(`Starting cluster & rank for ${enrichedQueries.length} queries`);
  
  // Step 1: Normalize and dedupe queries
  const normalizedQueries = normalizeAndDedupe(enrichedQueries);
  console.log(`After normalization/dedupe: ${normalizedQueries.length} queries`);
  
  // Step 2: Create embeddings for queries
  const queriesWithEmbeddings = await createEmbeddings(normalizedQueries);
  
  // Step 3: Create embedding for company profile
  const companyEmbedding = await createCompanyProfileEmbedding(companyProfile);
  
  // Step 4: Calculate all scores for each query
  const scoredQueries = calculateQueryScores(queriesWithEmbeddings, companyEmbedding);
  
  // Step 5: Cluster queries into topics
  const clusters = clusterQueriesWithEmbeddings(scoredQueries);
  console.log(`Created ${clusters.length} clusters`);
  
  // Step 6: Label clusters and create final topic output
  const topics = await labelAndRankClusters(clusters);
  
  return topics;
}

/**
 * Step 1: Normalize + Dedupe
 */
function normalizeAndDedupe(queries: EnrichedQuery[]): NormalizedQuery[] {
  const seen = new Map<string, NormalizedQuery>();
  
  for (const query of queries) {
    const original = query.query;
    const normalized = normalizeQuery(original);
    
    // Skip empty queries
    if (!normalized) continue;
    
    // Dedupe by normalized form - keep the one with higher volume or first seen
    const existing = seen.get(normalized);
    if (!existing || (query.volume_monthly || 0) > (existing.volume_monthly || 0)) {
      seen.set(normalized, {
        ...query,
        query_original: original,
        query_normalized: normalized,
      });
    }
  }
  
  return Array.from(seen.values());
}

function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[?.!]+$/, '')           // Remove trailing punctuation
    .replace(/\s+/g, ' ')              // Collapse multiple spaces
    .replace(/(\b\w+\b)( \1\b)+/gi, '$1') // Remove consecutive duplicate words (e.g., "gymshark gymshark")
    .trim();
}

/**
 * Step 2: Compute Embeddings (with caching)
 */
async function createEmbeddings(queries: NormalizedQuery[]): Promise<QueryWithEmbedding[]> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('No OpenAI API key, skipping embeddings');
    return queries.map(q => ({ ...q }));
  }

  // Check which queries are already cached
  const results: QueryWithEmbedding[] = [];
  const uncachedQueries: NormalizedQuery[] = [];
  const uncachedIndices: number[] = [];

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const cacheKey = generateCacheKey('embedding', query.query_normalized);
    const cached = getCache<number[]>(cacheKey, EMBEDDING_CACHE_DURATION_MS);
    
    if (cached) {
      results.push({ ...query, embedding: cached });
    } else {
      uncachedQueries.push(query);
      uncachedIndices.push(i);
    }
  }

  console.log(`Embeddings: ${results.length} cached, ${uncachedQueries.length} to fetch`);

  if (uncachedQueries.length === 0) {
    return results;
  }

  try {
    // Batch embeddings for uncached queries
    const batchSize = 500;
    
    for (let i = 0; i < uncachedQueries.length; i += batchSize) {
      const batch = uncachedQueries.slice(i, i + batchSize);
      const texts = batch.map(q => q.query_normalized);
      
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });

      for (let j = 0; j < batch.length; j++) {
        const embedding = response.data[j]?.embedding || [];
        const query = batch[j];
        
        // Cache the embedding
        const cacheKey = generateCacheKey('embedding', query.query_normalized);
        setCache(cacheKey, embedding);
        
        results.push({ ...query, embedding });
      }
      
      // Small delay between batches
      if (i + batchSize < uncachedQueries.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`Created embeddings for ${uncachedQueries.length} new queries`);
    return results;
  } catch (error) {
    console.error('Error creating embeddings:', error);
    // Return what we have (cached + queries without embeddings)
    for (const query of uncachedQueries) {
      results.push({ ...query });
    }
    return results;
  }
}

async function createCompanyProfileEmbedding(profile: CompanyProfile): Promise<number[]> {
  if (!process.env.OPENAI_API_KEY) {
    return [];
  }

  // Create a comprehensive profile text for embedding
  const profileText = [
    profile.name,
    ...(profile.products || []),
    ...(profile.services || []),
    ...(profile.categories || []),
    ...(profile.targetAudience || []),
    profile.extractedText?.substring(0, 1000) || '',
  ].filter(Boolean).join(' ');

  // Check cache first
  const cacheKey = generateCacheKey('company_embedding', profile.name.toLowerCase(), profile.website);
  const cached = getCache<number[]>(cacheKey, EMBEDDING_CACHE_DURATION_MS);
  if (cached) {
    console.log(`Company embedding cache hit for ${profile.name}`);
    return cached;
  }

  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: profileText,
    });

    const embedding = response.data[0]?.embedding || [];
    
    // Cache the result
    setCache(cacheKey, embedding);
    
    return embedding;
  } catch (error) {
    console.error('Error creating company embedding:', error);
    return [];
  }
}

/**
 * Step 5: Scoring / Ranking
 */
function calculateQueryScores(
  queries: QueryWithEmbedding[],
  companyEmbedding: number[]
): ScoredQuery[] {
  // Calculate max volume for normalization
  const maxVolume = Math.max(...queries.map(q => q.volume_monthly || 0), 1);
  
  return queries.map(q => {
    // Volume score: log1p normalized (works even with has_volume=false)
    const volumeScore = q.has_volume && q.volume_monthly
      ? Math.log1p(q.volume_monthly) / Math.log1p(maxVolume)
      : 0; // No volume data -> 0 (we'll still keep the query, but it should rank lower by volume)
    
    // Relevance score: cosine similarity to company profile
    let relevanceScore = 0.5; // Default if no embeddings
    if (q.embedding && q.embedding.length > 0 && companyEmbedding.length > 0) {
      relevanceScore = cosineSimilarity(q.embedding, companyEmbedding);
      // Normalize to 0-1 range (cosine can be negative)
      relevanceScore = (relevanceScore + 1) / 2;
    }
    
    // Source bonus: +0.1 if discovered via PAA (real SERP data)
    const sourceBonus = q.source === 'paa' ? 1.0 : 0.0;
    
    // Intent weight
    const intentWeight = getIntentWeight(q.intent || 'informational');
    
    // IMPORTANT: Rank primarily by volume_monthly, per product requirement.
    // We keep a tiny tie-breaker to avoid totally flat ordering for identical volumes.
    const queryScore =
      volumeScore +
      0.0005 * relevanceScore +
      0.0002 * sourceBonus +
      0.0002 * intentWeight;
    
    // Calculate confidence
    const confidence = calculateQueryConfidence(q);

    return {
      ...q,
      volume_score: volumeScore,
      relevance_score: relevanceScore,
      source_bonus: sourceBonus,
      intent_weight: intentWeight,
      query_score: queryScore,
      confidence,
    };
  });
}

function getIntentWeight(intent: string): number {
  const weights: Record<string, number> = {
    transactional: 1.0,
    navigational: 0.9,
    comparison: 0.8,
    discovery: 0.7,
    informational: 0.6,
    troubleshooting: 0.5,
  };
  return weights[intent] || 0.5;
}

function calculateQueryConfidence(query: QueryWithEmbedding): number {
  let confidence = 0.2; // Base confidence
  
  // +0.2 if has_volume=true
  if (query.has_volume) {
    confidence += 0.2;
  }
  
  // +0.1 if source == "paa" (discovered from SERP)
  if (query.source === 'paa') {
    confidence += 0.1;
  }
  
  // +0.1 if intent is clear (transactional/navigational)
  const clearIntents = ['transactional', 'navigational'];
  if (query.intent && clearIntents.includes(query.intent)) {
    confidence += 0.1;
  }
  
  return Math.min(confidence, 1.0);
}

/**
 * Step 3: Cluster Queries into Topics
 * Uses embedding-based clustering when available, falls back to keyword-based
 */
function clusterQueriesWithEmbeddings(queries: ScoredQuery[]): ClusterResult[] {
  // Check if we have embeddings
  const hasEmbeddings = queries.some(q => q.embedding && q.embedding.length > 0);
  
  if (hasEmbeddings) {
    return clusterByEmbeddings(queries);
  } else {
    return clusterByKeywords(queries);
  }
}

/**
 * Agglomerative-style clustering using cosine distance
 */
function clusterByEmbeddings(queries: ScoredQuery[]): ClusterResult[] {
  const threshold = 0.25; // Cosine distance threshold for clustering
  const clusters: ClusterResult[] = [];
  const assigned = new Set<number>();
  
  // Sort by query_score descending to seed clusters with best queries
  const sortedIndices = queries
    .map((_, i) => i)
    .sort((a, b) => (queries[b].query_score || 0) - (queries[a].query_score || 0));
  
  for (const seedIdx of sortedIndices) {
    if (assigned.has(seedIdx)) continue;
    
    const seedQuery = queries[seedIdx];
    if (!seedQuery.embedding || seedQuery.embedding.length === 0) {
      // Handle query without embedding separately
      assigned.add(seedIdx);
      clusters.push({
        topic_id: `t${clusters.length + 1}`,
        queries: [seedQuery],
      });
      continue;
    }
    
    // Start new cluster with seed
    const clusterQueries: ScoredQuery[] = [seedQuery];
    assigned.add(seedIdx);
    
    // Find similar queries to add to cluster
  for (let i = 0; i < queries.length; i++) {
      if (assigned.has(i)) continue;
      
      const candidate = queries[i];
      if (!candidate.embedding || candidate.embedding.length === 0) continue;
      
      const similarity = cosineSimilarity(seedQuery.embedding, candidate.embedding);
      const distance = 1 - similarity;
      
      if (distance < threshold) {
        clusterQueries.push(candidate);
        assigned.add(i);
      }
    }
    
    // Calculate centroid
    const centroid = calculateCentroid(clusterQueries);
    
    clusters.push({
      topic_id: `t${clusters.length + 1}`,
      queries: clusterQueries,
      centroid,
    });
    
    // Limit to ~10 clusters for prototype
    if (clusters.length >= 15) break;
  }
  
  // Handle any remaining unassigned queries
  for (let i = 0; i < queries.length; i++) {
    if (!assigned.has(i)) {
      // Find closest existing cluster or create new one
      const query = queries[i];
      let bestCluster: ClusterResult | null = null;
      let bestSimilarity = -1;
      
      if (query.embedding && query.embedding.length > 0) {
        for (const cluster of clusters) {
          if (cluster.centroid) {
            const sim = cosineSimilarity(query.embedding, cluster.centroid);
            if (sim > bestSimilarity) {
              bestSimilarity = sim;
              bestCluster = cluster;
            }
          }
        }
      }
      
      if (bestCluster && bestSimilarity > 0.5) {
        bestCluster.queries.push(query);
      } else if (clusters.length < 15) {
        clusters.push({
          topic_id: `t${clusters.length + 1}`,
          queries: [query],
        });
      } else {
        // Add to largest cluster as fallback
        const largest = clusters.reduce((a, b) => a.queries.length > b.queries.length ? a : b);
        largest.queries.push(query);
      }
    }
  }
  
  return clusters;
}

function calculateCentroid(queries: ScoredQuery[]): number[] {
  const embeddings = queries
    .filter(q => q.embedding && q.embedding.length > 0)
    .map(q => q.embedding!);
  
  if (embeddings.length === 0) return [];
  
  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);
  
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += emb[i];
    }
  }
  
  for (let i = 0; i < dim; i++) {
    centroid[i] /= embeddings.length;
  }
  
  return centroid;
}

/**
 * Fallback: keyword-based clustering
 */
function clusterByKeywords(queries: ScoredQuery[]): ClusterResult[] {
  // Define topic keywords for rule-based clustering
  const topicKeywords: Record<string, string[]> = {
    'returns': ['return', 'refund', 'exchange', 'money back'],
    'shipping': ['shipping', 'delivery', 'ship', 'arrive', 'tracking', 'order'],
    'sizing': ['size', 'sizing', 'fit', 'small', 'large', 'tight', 'loose'],
    'discounts': ['discount', 'code', 'coupon', 'promo', 'sale', 'deal', 'black friday'],
    'stores': ['store', 'location', 'near me', 'where', 'buy', 'shop'],
    'quality': ['quality', 'worth', 'review', 'good', 'bad', 'compare', 'vs'],
    'products': ['leggings', 'shorts', 'shirt', 'hoodie', 'jacket', 'bra'],
    'account': ['account', 'login', 'password', 'sign in', 'app'],
  };
  
  const clusters: Map<string, ScoredQuery[]> = new Map();
  const unclustered: ScoredQuery[] = [];
  
  for (const query of queries) {
    const lowerQuery = query.query_normalized;
    let assigned = false;
    
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(kw => lowerQuery.includes(kw))) {
        if (!clusters.has(topic)) {
          clusters.set(topic, []);
        }
        clusters.get(topic)!.push(query);
        assigned = true;
        break;
      }
    }
    
    if (!assigned) {
      unclustered.push(query);
    }
  }
  
  // Convert to ClusterResult format
  const results: ClusterResult[] = [];
  let id = 1;
  
  clusters.forEach((clusterQueries) => {
    if (clusterQueries.length > 0) {
      results.push({
        topic_id: `t${id++}`,
        queries: clusterQueries,
      });
    }
  });
  
  // Add unclustered as "Other" topic if there are any
  if (unclustered.length > 0) {
    results.push({
      topic_id: `t${id}`,
      queries: unclustered,
    });
  }
  
  return results;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dotProduct / denominator : 0;
}

/**
 * Step 4 & 6: Label Each Topic + Pick Top Queries
 */
async function labelAndRankClusters(clusters: ClusterResult[]): Promise<Topic[]> {
  const topics: Topic[] = [];
  
  for (const cluster of clusters) {
    // Sort queries within cluster primarily by volume_monthly (desc), then by query_score
    cluster.queries.sort((a, b) => {
      const aVol = a.has_volume ? (a.volume_monthly || 0) : -1;
      const bVol = b.has_volume ? (b.volume_monthly || 0) : -1;
      if (bVol !== aVol) return bVol - aVol;
      return (b.query_score || 0) - (a.query_score || 0);
    });
    
    // Get top N queries for this topic
    const topQueries = cluster.queries.slice(0, 10);
    
    // Label the cluster
    const topicLabel = await labelCluster(topQueries);
    
    // Calculate topic score: sum of top 5 volumes (monthly searches)
    const top5 = cluster.queries.slice(0, 5);
    const topicScore = top5.reduce((sum, q) => sum + (q.volume_monthly || 0), 0);
    
    // Calculate volume coverage: queries with volume / total queries in topic
    const withVolume = cluster.queries.filter(q => q.has_volume).length;
    const volumeCoverage = cluster.queries.length > 0 
      ? withVolume / cluster.queries.length 
      : 0;
    
    // Average confidence across top queries
    const avgConfidence = topQueries.length > 0
      ? topQueries.reduce((sum, q) => sum + q.confidence, 0) / topQueries.length
      : 0.2;
    
    topics.push({
      topic_id: cluster.topic_id,
      topic: topicLabel,
      topic_score: topicScore,
      confidence: Math.round(avgConfidence * 100) / 100,
      volume_coverage: Math.round(volumeCoverage * 100) / 100,
      top_queries: topQueries.map(q => formatQueryResult(q)),
    });
  }
  
  // Sort topics by topic_score descending
  topics.sort((a, b) => b.topic_score - a.topic_score);
  
  // Return top 10 topics
  return topics.slice(0, 10);
}

function formatQueryResult(query: ScoredQuery): QueryResult {
  // Build sources array
  const sources: string[] = [];
  if (query.source === 'paa') {
    sources.push('discovered:paa');
  } else if (query.source === 'llm') {
    sources.push('generated:llm');
  }
  if (query.volume_provider) {
    sources.push(query.volume_provider);
  }
  
  return {
    query: query.query_original || query.query,
    intent: query.intent || 'informational',
    volume_monthly: query.volume_monthly,
    has_volume: query.has_volume || false,
    sources,
    confidence: Math.round(query.confidence * 100) / 100,
    query_score: Math.round(query.query_score * 100) / 100,
  };
}

async function labelCluster(queries: ScoredQuery[]): Promise<string> {
  if (queries.length === 0) {
    return 'Unnamed Topic';
  }
  
  // Try LLM labeling first
  if (process.env.OPENAI_API_KEY) {
    try {
      const queryTexts = queries.slice(0, 10).map(q => q.query_normalized).join('\n- ');
      
    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
            content: 'You are a topic labeling expert. Given a list of related search queries, provide a concise 2-4 word topic label that captures the common theme. Return ONLY the label, no other text or punctuation.',
        },
        {
          role: 'user',
            content: `These queries belong to the same topic:\n- ${queryTexts}\n\nTopic label:`,
        },
      ],
      temperature: 0.3,
        max_tokens: 15,
    });

      const label = response.choices[0]?.message?.content?.trim();
      if (label && label.length > 0 && label.length < 50) {
        return label;
      }
  } catch (error) {
      console.error('Error labeling cluster with LLM:', error);
    }
  }
  
  // Fallback: find most central query (closest to centroid) or highest scored
  // and extract a short label from it
  const topQuery = queries[0];
  return extractSimpleLabel(topQuery.query_normalized);
}

function extractSimpleLabel(query: string): string {
  // Remove common question words and stopwords
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 
    'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 
    'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 
    'might', 'must', 'can', 'this', 'that', 'these', 'those', 'what', 'how',
    'why', 'when', 'where', 'who', 'which', 'i', 'me', 'my', 'you', 'your'
  ]);
  
  const words = query
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w))
    .slice(0, 4);
  
  if (words.length === 0) {
    return query.split(/\s+/).slice(0, 3).join(' ');
  }
  
  // Capitalize first letter
  const label = words.join(' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}
