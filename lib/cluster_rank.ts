import OpenAI from 'openai';
import { EnrichedQuery, QueryWithScore, Topic, CompanyProfile } from '@/types';

/**
 * Step 5: Cluster into Topics + Rank
 * Groups queries into topics using embeddings and clustering, then ranks them
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function clusterAndRank(
  enrichedQueries: EnrichedQuery[],
  companyProfile: CompanyProfile
): Promise<Topic[]> {
  // Step 1: Create embeddings for queries
  const queriesWithEmbeddings = await createEmbeddings(enrichedQueries);
  
  // Step 2: Create embedding for company profile
  const companyEmbedding = await createCompanyProfileEmbedding(companyProfile);
  
  // Step 3: Calculate relevance scores
  const queriesWithScores = calculateRelevanceScores(queriesWithEmbeddings, companyEmbedding);
  
  // Step 4: Cluster queries
  const clusters = clusterQueries(queriesWithScores);
  
  // Step 5: Label clusters and rank
  const topics = await labelAndRankClusters(clusters, queriesWithScores);
  
  return topics;
}

async function createEmbeddings(
  queries: EnrichedQuery[]
): Promise<QueryWithScore[]> {
  if (!process.env.OPENAI_API_KEY) {
    // Fallback: return queries without embeddings
    return queries.map((q) => ({
      ...q,
      query_score: 0,
      relevance_score: 0,
      intent_weight: getIntentWeight(q.intent || 'informational'),
    }));
  }

  try {
    const texts = queries.map((q) => q.query);
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });

    return queries.map((q, index) => ({
      ...q,
      embedding: response.data[index]?.embedding || [],
      query_score: 0,
      relevance_score: 0,
      intent_weight: getIntentWeight(q.intent || 'informational'),
    }));
  } catch (error) {
    console.error('Error creating embeddings:', error);
    return queries.map((q) => ({
      ...q,
      query_score: 0,
      relevance_score: 0,
      intent_weight: getIntentWeight(q.intent || 'informational'),
    }));
  }
}

async function createCompanyProfileEmbedding(
  profile: CompanyProfile
): Promise<number[]> {
  if (!process.env.OPENAI_API_KEY) {
    return [];
  }

  const profileText = [
    profile.name,
    ...profile.products,
    ...profile.services,
    ...profile.categories,
    profile.extractedText?.substring(0, 500) || '',
  ].join(' ');

  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: profileText,
    });

    return response.data[0]?.embedding || [];
  } catch (error) {
    console.error('Error creating company embedding:', error);
    return [];
  }
}

function calculateRelevanceScores(
  queries: QueryWithScore[],
  companyEmbedding: number[]
): QueryWithScore[] {
  if (companyEmbedding.length === 0) {
    // No embedding available, use volume-based scoring
    return queries.map((q) => ({
      ...q,
      relevance_score: normalizeVolume(q.volume_monthly || 0),
    }));
  }

  return queries.map((q) => {
    let relevance = 0;
    
    if (q.embedding && q.embedding.length > 0) {
      relevance = cosineSimilarity(q.embedding, companyEmbedding);
    } else {
      // Fallback to volume-based
      relevance = normalizeVolume(q.volume_monthly || 0);
    }

    // Calculate query score
    const volumeScore = normalizeVolume(q.volume_monthly || 0);
    const queryScore = 0.4 * volumeScore + 0.4 * relevance + 0.2 * q.intent_weight;

    return {
      ...q,
      relevance_score: relevance,
      query_score: queryScore,
    };
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeVolume(volume: number): number {
  // Normalize to 0-1 scale (assuming max volume of 100k)
  return Math.min(volume / 100000, 1);
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

function clusterQueries(queries: QueryWithScore[]): QueryWithScore[][] {
  // Simple clustering based on query similarity
  // For prototype: use keyword-based clustering
  // In production, use k-means on embeddings
  
  const clusters: QueryWithScore[][] = [];
  const used = new Set<number>();
  
  for (let i = 0; i < queries.length; i++) {
    if (used.has(i)) continue;
    
    const cluster = [queries[i]];
    used.add(i);
    
    // Find similar queries
    const keywords1 = extractKeywords(queries[i].query);
    
    for (let j = i + 1; j < queries.length; j++) {
      if (used.has(j)) continue;
      
      const keywords2 = extractKeywords(queries[j].query);
      const similarity = calculateKeywordSimilarity(keywords1, keywords2);
      
      if (similarity > 0.3) { // Threshold for clustering
        cluster.push(queries[j]);
        used.add(j);
      }
    }
    
    clusters.push(cluster);
  }
  
  // Sort clusters by total volume
  clusters.sort((a, b) => {
    const volumeA = a.reduce((sum, q) => sum + (q.volume_monthly || 0), 0);
    const volumeB = b.reduce((sum, q) => sum + (q.volume_monthly || 0), 0);
    return volumeB - volumeA;
  });
  
  return clusters.slice(0, 10); // Top 10 clusters
}

function extractKeywords(query: string): string[] {
  const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those']);
  
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopwords.has(word));
}

function calculateKeywordSimilarity(keywords1: string[], keywords2: string[]): number {
  const set1 = new Set(keywords1);
  const set2 = new Set(keywords2);
  
  const intersection = keywords1.filter((k) => set2.has(k)).length;
  const union = new Set([...keywords1, ...keywords2]).size;
  
  return union > 0 ? intersection / union : 0;
}

async function labelAndRankClusters(
  clusters: QueryWithScore[][],
  allQueries: QueryWithScore[]
): Promise<Topic[]> {
  const topics: Topic[] = [];
  
  for (const cluster of clusters) {
    // Sort queries within cluster by score
    cluster.sort((a, b) => (b.query_score || 0) - (a.query_score || 0));
    
    // Label cluster
    const topicLabel = await labelCluster(cluster);
    
    // Calculate topic score (sum of top N query volumes)
    const topQueries = cluster.slice(0, 5);
    const topicScore = topQueries.reduce((sum, q) => sum + (q.volume_monthly || 0), 0);
    
    // Calculate average confidence (will be set in provenance step)
    const avgConfidence = 0.7; // Placeholder
    
    topics.push({
      topic: topicLabel,
      topic_score: topicScore,
      confidence: avgConfidence,
      top_queries: topQueries.map((q) => ({
        query: q.query,
        intent: q.intent || 'informational',
        volume_monthly: q.volume_monthly,
        sources: [],
        confidence: 0.7,
        query_score: q.query_score,
      })),
    });
  }
  
  return topics;
}

async function labelCluster(cluster: QueryWithScore[]): Promise<string> {
  if (!process.env.OPENAI_API_KEY || cluster.length === 0) {
    // Fallback: use first query as label
    return cluster[0]?.query.split(/\s+/).slice(0, 3).join(' ') || 'Unnamed Topic';
  }

  const queries = cluster.slice(0, 5).map((q) => q.query).join(', ');
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a topic labeling expert. Return only a 2-4 word topic label, no other text.',
        },
        {
          role: 'user',
          content: `These queries belong to the same topic: ${queries}\n\nProvide a concise 2-4 word topic label:`,
        },
      ],
      temperature: 0.3,
      max_tokens: 10,
    });

    return response.choices[0]?.message?.content?.trim() || 'Unnamed Topic';
  } catch (error) {
    console.error('Error labeling cluster:', error);
    return cluster[0]?.query.split(/\s+/).slice(0, 3).join(' ') || 'Unnamed Topic';
  }
}

