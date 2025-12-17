'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';

interface QueryResult {
  query: string;
  intent: string;
  volume_monthly?: number;
  has_volume?: boolean;
  sources: string[];
  confidence: number;
  query_score?: number;
}

interface Topic {
  topic_id?: string;
  topic: string;
  topic_score: number;
  confidence: number;
  volume_coverage?: number;
  top_queries: QueryResult[];
}

interface InsightsResult {
  company: string;
  geo: string;
  lang: string;
  generated_at: string;
  topics: Topic[];
  debug: {
    seeds_count: number;
    expanded_count: number;
    volume_coverage_pct: number;
  };
}

const PIPELINE_STEPS = [
  { id: 1, label: 'Scanning website', sublabel: 'Extracting company context', duration: 8000 },
  { id: 2, label: 'Generating queries', sublabel: 'Creating seed search terms', duration: 6000 },
  { id: 3, label: 'Expanding coverage', sublabel: 'Discovering related questions', duration: 15000 },
  { id: 4, label: 'Enriching data', sublabel: 'Fetching search volumes', duration: 10000 },
  { id: 5, label: 'Analyzing patterns', sublabel: 'Clustering into topics', duration: 8000 },
  { id: 6, label: 'Finalizing', sublabel: 'Calculating confidence scores', duration: 2000 },
];

export default function Home() {
  const [url, setUrl] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [results, setResults] = useState<InsightsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());

  // Simulate step progress during loading
  useEffect(() => {
    if (!isLoading) return;

    let stepIndex = 0;
    setCurrentStep(1);

    const advanceStep = () => {
      stepIndex++;
      if (stepIndex < PIPELINE_STEPS.length) {
        setCurrentStep(stepIndex + 1);
        setTimeout(advanceStep, PIPELINE_STEPS[stepIndex].duration);
      }
    };

    const timer = setTimeout(advanceStep, PIPELINE_STEPS[0].duration);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const extractCompanyName = (websiteUrl: string): string => {
    try {
      const hostname = new URL(websiteUrl).hostname;
      const parts = hostname.replace('www.', '').split('.');
      return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    } catch {
      return '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!url) return;

    // Validate URL
    let validUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      validUrl = 'https://' + url;
    }

    try {
      new URL(validUrl);
    } catch {
      setError('Please enter a valid URL');
      return;
    }

    const company = companyName || extractCompanyName(validUrl);
    if (!company) {
      setError('Please enter a company name');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);
    setCurrentStep(1);

    try {
      const response = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company,
          website: validUrl,
          geo: 'US',
          lang: 'en',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to generate insights');
      }

      const data = await response.json();
      setResults(data);

      // Expand first topic by default
      if (data.topics?.length > 0) {
        setExpandedTopics(new Set([data.topics[0].topic_id || '0']));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
      setCurrentStep(0);
    }
  };

  const toggleTopic = (topicId: string) => {
    setExpandedTopics(prev => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  };

  const formatVolume = (volume?: number): string => {
    if (!volume) return '—';
    if (volume >= 1000000) return `${(volume / 1000000).toFixed(1)}M`;
    if (volume >= 1000) return `${(volume / 1000).toFixed(1)}K`;
    return volume.toString();
  };

  function getIntentColor(intent: string): string {
    const colors: Record<string, string> = {
      transactional: '#1B5E20',   // forest
      navigational: '#2E7D32',    // green
      informational: '#556B2F',   // dark olive
      comparison: '#B45309',      // amber (no purple/blue)
      discovery: '#0F766E',       // deep teal-green
      troubleshooting: '#DC2626',
    };
    return colors[intent] || '#6B7280';
  }

  const intentBreakdown = useMemo(() => {
    if (!results) return [];

    const deduped = new Map<string, QueryResult>();
    for (const topic of results.topics || []) {
      for (const q of topic.top_queries || []) {
        if (!deduped.has(q.query)) deduped.set(q.query, q);
      }
    }

    const total = deduped.size || 1;
    const counts: Record<string, number> = {};
    deduped.forEach((q) => {
      const intent = (q.intent || 'unknown').toLowerCase();
      counts[intent] = (counts[intent] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([intent, count]) => ({
        intent,
        count,
        pct: count / total,
        color: getIntentColor(intent),
      }))
      .sort((a, b) => b.count - a.count);
  }, [results]);

  const getSourceLabel = (source: string): string => {
    if (source.includes('paa')) return 'PAA';
    if (source.includes('llm')) return 'AI';
    if (source.includes('dataforseo')) return 'Volume';
    return source;
  };

  const reset = () => {
    setResults(null);
    setUrl('');
    setCompanyName('');
    setError(null);
  };

  return (
    <main className={styles.main}>
      {/* Back button when showing results */}
      {results && (
        <div className={styles.backBar}>
          <button onClick={reset} className={styles.resetButton}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            New Search
          </button>
        </div>
      )}

      {/* Main Content */}
      {!isLoading && !results && (
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <h1 className={styles.title}>
              Discover what your customers<br />
              <span className={styles.highlight}>are searching for</span>
            </h1>
            <p className={styles.subtitle}>
              Enter a company website to uncover search query insights,
              trending topics, and customer intent patterns.
            </p>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Company Website</label>
                <div className={styles.inputWrapper}>
                  <span className={styles.inputIcon}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="www.example.com"
                    className={styles.input}
                    autoFocus
                  />
                </div>
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label}>
                  Company Name <span className={styles.optional}>(optional)</span>
                </label>
                <div className={styles.inputWrapper}>
                  <span className={styles.inputIcon}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Auto-detected from URL"
                    className={styles.input}
                  />
                </div>
              </div>

              {error && (
                <div className={styles.error}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                  {error}
                </div>
              )}

              <button type="submit" className={styles.submitButton} disabled={!url}>
                Generate Insights
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </form>


          </div>
        </section>
      )}

      {/* Loading State */}
      {isLoading && (
        <section className={styles.loading}>
          <div className={styles.loadingContent}>
            <div className={styles.spinnerContainer}>
              <div className={styles.spinnerOuter}></div>
              <div className={styles.spinnerInner}></div>
              <div className={styles.spinnerDot}></div>
            </div>

            <div className={styles.loadingText} key={currentStep}>
              <h2 className={styles.loadingTitle}>
                {PIPELINE_STEPS[currentStep - 1]?.label || 'Preparing'}
              </h2>
              <p className={styles.loadingSublabel}>
                {PIPELINE_STEPS[currentStep - 1]?.sublabel || 'Starting analysis'}
                <span className={styles.dots}>
                  <span>.</span><span>.</span><span>.</span>
                </span>
              </p>
            </div>

            <div className={styles.progressContainer}>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${(currentStep / PIPELINE_STEPS.length) * 100}%` }}
                />
              </div>
              <span className={styles.progressText}>
                Step {currentStep} of {PIPELINE_STEPS.length}
              </span>
            </div>

            {(() => {
              const completed = PIPELINE_STEPS.slice(
                Math.max(0, currentStep - 3),
                Math.max(0, currentStep - 1)
              );
              const active = PIPELINE_STEPS[currentStep - 1];
              const next = PIPELINE_STEPS[currentStep];

              return (
                <div className={styles.stepChips} aria-live="polite">
                  {completed.map((step, index) => (
                    <div
                      key={step.id}
                      className={styles.completedStep}
                      style={{ animationDelay: `${index * 0.08}s` }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                      <span>{step.label}</span>
                    </div>
                  ))}

                  {active && (
                    <div className={styles.activeStepChip} key={active.id}>
                      <span className={styles.activeDot} />
                      <span>{active.label}</span>
                    </div>
                  )}

                  {next && (
                    <div className={styles.nextStepChip} key={`next-${next.id}`}>
                      <span className={styles.nextLabel}>Up next:</span>
                      <span>{next.label}</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </section>
      )}

      {/* Results */}
      {results && (
        <section className={styles.results}>
          <div className={styles.resultsHeader}>
            <div className={styles.resultsTitle}>
              <h2>Search Insights for <span className={styles.companyName}>{results.company}</span></h2>
              <p className={styles.resultsMeta}>
                Generated on {results.generated_at} • {results.debug.expanded_count} queries analyzed • {Math.round(results.debug.volume_coverage_pct * 100)}% with volume data
              </p>
            </div>
          </div>

          <div className={styles.intentCard}>
            <div className={styles.intentHeader}>
              <h3 className={styles.intentTitle}>Intent breakdown</h3>
              <span className={styles.intentMeta}>
                Based on {intentBreakdown.reduce((sum, x) => sum + x.count, 0)} unique top queries
              </span>
            </div>

            <div className={styles.intentBars}>
              {intentBreakdown.map((row) => (
                <div key={row.intent} className={styles.intentRow}>
                  <div className={styles.intentRowLeft}>
                    <span
                      className={styles.intentSwatch}
                      style={{ backgroundColor: row.color }}
                    />
                    <span className={styles.intentName}>{row.intent}</span>
                  </div>

                  <div className={styles.intentRowRight}>
                    <div className={styles.intentBar}>
                      <div
                        className={styles.intentBarFill}
                        style={{
                          width: `${Math.round(row.pct * 100)}%`,
                          backgroundColor: row.color,
                        }}
                      />
                    </div>
                    <span className={styles.intentPct}>{Math.round(row.pct * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.topicsGrid}>
            {results.topics.map((topic, topicIndex) => {
              const isExpanded = expandedTopics.has(topic.topic_id || topicIndex.toString());
              const totalVolume = topic.top_queries.reduce((sum, q) => sum + (q.volume_monthly || 0), 0);

              return (
                <div
                  key={topic.topic_id || topicIndex}
                  className={`${styles.topicCard} animate-fade-in`}
                  style={{ animationDelay: `${topicIndex * 0.05}s` }}
                >
                  <button
                    className={styles.topicHeader}
                    onClick={() => toggleTopic(topic.topic_id || topicIndex.toString())}
                  >
                    <div className={styles.topicInfo}>
                      <div className={styles.topicRank}>#{topicIndex + 1}</div>
                      <div>
                        <h3 className={styles.topicName}>{topic.topic}</h3>
                        <div className={styles.topicStats}>
                          <span className={styles.stat}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 3v18h18" />
                              <path d="M18 9l-5 5-4-4-6 6" />
                            </svg>
                            {formatVolume(totalVolume)} searches/mo
                          </span>
                          <span className={styles.stat}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                            {topic.top_queries.length} queries
                          </span>
                          {topic.volume_coverage !== undefined && (
                            <span className={styles.stat}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 6v6l4 2" />
                              </svg>
                              {Math.round(topic.volume_coverage * 100)}% coverage
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <svg
                      className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`}
                      width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className={styles.topicContent}>
                      <div className={styles.queriesTable}>
                        <div className={styles.tableHeader}>
                          <span className={styles.colQuery}>Query</span>
                          <span className={styles.colIntent}>Intent</span>
                          <span className={styles.colVolume}>Volume</span>
                          <span className={styles.colScore}>Score</span>
                          <span className={styles.colSource}>Source</span>
                        </div>
                        {topic.top_queries.map((query, queryIndex) => (
                          <div
                            key={queryIndex}
                            className={styles.tableRow}
                          >
                            <span className={styles.colQuery}>
                              {query.query}
                            </span>
                            <span className={styles.colIntent}>
                              <span
                                className={styles.intentBadge}
                                style={{ backgroundColor: getIntentColor(query.intent) + '15', color: getIntentColor(query.intent) }}
                              >
                                {query.intent}
                              </span>
                            </span>
                            <span className={styles.colVolume}>
                              {query.has_volume ? (
                                <span className={styles.volumeValue}>{formatVolume(query.volume_monthly)}</span>
                              ) : (
                                <span className={styles.noVolume}>—</span>
                              )}
                            </span>
                            <span className={styles.colScore}>
                              <div className={styles.scoreBar}>
                                <div
                                  className={styles.scoreBarFill}
                                  style={{ width: `${(query.query_score || 0) * 100}%` }}
                                />
                              </div>
                              <span className={styles.scoreValue}>{((query.query_score || 0) * 100).toFixed(0)}</span>
                            </span>
                            <span className={styles.colSource}>
                              {query.sources.slice(0, 2).map((source, i) => (
                                <span key={i} className={styles.sourceBadge}>
                                  {getSourceLabel(source)}
                                </span>
                              ))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className={styles.debugInfo}>
            <h4>Pipeline Summary</h4>
            <div className={styles.debugStats}>
              <div className={styles.debugStat}>
                <span className={styles.debugLabel}>Seed Queries</span>
                <span className={styles.debugValue}>{results.debug.seeds_count}</span>
              </div>
              <div className={styles.debugStat}>
                <span className={styles.debugLabel}>Expanded Queries</span>
                <span className={styles.debugValue}>{results.debug.expanded_count}</span>
              </div>
              <div className={styles.debugStat}>
                <span className={styles.debugLabel}>Volume Coverage</span>
                <span className={styles.debugValue}>{Math.round(results.debug.volume_coverage_pct * 100)}%</span>
              </div>
              <div className={styles.debugStat}>
                <span className={styles.debugLabel}>Topics Generated</span>
                <span className={styles.debugValue}>{results.topics.length}</span>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

