import axios from 'axios';
import { ExpandedQuery, EnrichedQuery, VolumeMetrics } from '@/types';

/**
 * Step 4: Attach "Demand" Metrics (Volume / Importance)
 * Enriches queries with search volume, CPC, and competition data
 */

export interface VolumeProvider {
  getMetrics(keywords: string[], geo?: string, lang?: string): Promise<VolumeMetrics[]>;
}

export async function enrichWithVolume(
  queries: ExpandedQuery[],
  geo: string = 'US',
  lang: string = 'en'
): Promise<EnrichedQuery[]> {
  const keywords = queries.map((q) => q.query);
  
  // Try different volume providers in order
  let metrics: VolumeMetrics[] = [];
  
  if (process.env.GOOGLE_ADS_API_KEY) {
    metrics = await getGoogleAdsMetrics(keywords, geo, lang);
  } else if (process.env.DATAFORSEO_API_KEY) {
    metrics = await getDataForSEOMetrics(keywords, geo, lang);
  } else {
    // Fallback: estimate based on query characteristics
    metrics = estimateVolumeMetrics(keywords, geo, lang);
  }

  // Merge metrics with queries
  const enriched: EnrichedQuery[] = queries.map((query, index) => {
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
      geo: metric.geo,
      lang: metric.lang,
      volume_source: metric.source,
    };
  });

  return enriched;
}

async function getGoogleAdsMetrics(
  keywords: string[],
  geo: string,
  lang: string
): Promise<VolumeMetrics[]> {
  // Placeholder for Google Ads API integration
  // Requires Google Ads API setup and OAuth
  // For prototype, return estimated metrics
  return estimateVolumeMetrics(keywords, geo, lang);
}

async function getDataForSEOMetrics(
  keywords: string[],
  geo: string,
  lang: string
): Promise<VolumeMetrics[]> {
  // Placeholder for DataForSEO API integration
  // Example endpoint: https://api.dataforseo.com/v3/keywords_data/google_ads/keywords/live
  if (!process.env.DATAFORSEO_API_KEY) {
    return estimateVolumeMetrics(keywords, geo, lang);
  }

  try {
    // Note: This is a placeholder - actual implementation would use DataForSEO API
    // const response = await axios.post(
    //   'https://api.dataforseo.com/v3/keywords_data/google_ads/keywords/live',
    //   keywords.map(keyword => ({ keyword, location_code: 2840, language_code: 'en' })),
    //   {
    //     auth: {
    //       username: process.env.DATAFORSEO_API_KEY!,
    //       password: process.env.DATAFORSEO_PASSWORD || '',
    //     },
    //   }
    // );
    
    // For now, return estimated metrics
    return estimateVolumeMetrics(keywords, geo, lang);
  } catch (error) {
    console.error('DataForSEO API error:', error);
    return estimateVolumeMetrics(keywords, geo, lang);
  }
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
    
    // Estimate CPC (in cents)
    const cpc = volume > 1000 ? 150 + Math.random() * 100 : 50 + Math.random() * 50;
    
    return {
      volume_monthly: volume,
      volume_range: `${Math.floor(volume * 0.7)}-${Math.floor(volume * 1.3)}`,
      competition,
      cpc: Math.floor(cpc),
      geo,
      lang,
      source: 'estimated:fallback',
    };
  });
}

