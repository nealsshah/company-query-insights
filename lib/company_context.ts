import axios from 'axios';
import cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import OpenAI from 'openai';
import { CompanyProfile } from '@/types';
import { generateCacheKey, getCache, setCache } from './cache';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Cache duration: 7 days for company context (doesn't change often)
const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Step 1: Company → Context Extraction
 * Scrapes company website content and builds a structured profile
 */

export async function extractCompanyContext(
  companyName: string,
  website: string
): Promise<CompanyProfile> {
  // Normalize website URL
  let normalizedWebsite = website.trim();
  if (!normalizedWebsite.startsWith('http://') && !normalizedWebsite.startsWith('https://')) {
    normalizedWebsite = `https://${normalizedWebsite}`;
  }

  // Check cache first
  const cacheKey = generateCacheKey('company_context', companyName.toLowerCase(), normalizedWebsite);
  const cached = getCache<CompanyProfile>(cacheKey, CACHE_DURATION_MS);
  if (cached) {
    return cached;
  }

  // Scrape homepage and about page
  const extractedText = await scrapeCompanyPages(normalizedWebsite);

  // Extract structured information
  const profile: CompanyProfile = {
    name: companyName,
    website: normalizedWebsite,
    products: [],
    services: [],
    targetAudience: [],
    categories: [],
    brandTerms: [companyName.toLowerCase(), companyName],
    extractedText,
  };

  // Extract structured information using LLM
  if (extractedText && extractedText.length > 0) {
    try {
      const extracted = await extractStructuredInfoWithLLM(extractedText, companyName);
      profile.products = extracted.products;
      profile.services = extracted.services;
      profile.targetAudience = extracted.targetAudience;
      profile.categories = extracted.categories;
    } catch (error) {
      console.error('Error extracting structured info with LLM, using fallback:', error);
      // Fallback to pattern-based extraction if LLM fails
      profile.products = extractProducts(extractedText, companyName);
      profile.services = extractServices(extractedText);
      profile.targetAudience = extractTargetAudience(extractedText);
      profile.categories = extractCategories(extractedText);
    }
  }

  // Cache the result
  setCache(cacheKey, profile);

  return profile;
}

async function extractStructuredInfoWithLLM(
  extractedText: string,
  companyName: string
): Promise<{
  products: string[];
  services: string[];
  targetAudience: string[];
  categories: string[];
}> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not available');
  }

  // Truncate text if too long (to save tokens)
  const textToAnalyze = extractedText.length > 8000
    ? extractedText.substring(0, 8000) + '...'
    : extractedText;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a business analyst. Extract structured company information from website text. Return valid JSON only.',
        },
        {
          role: 'user',
          content: `Analyze the following website text for "${companyName}" and extract structured information.

Website text:
${textToAnalyze}

Extract and return JSON with these fields:
- products: array of specific product names/types mentioned (e.g., ["Leggings", "Sports Bras", "Gym Shorts"])
- services: array of services offered (e.g., ["Free Delivery", "Returns", "Customer Service"])
- targetAudience: array of target customer segments (e.g., ["Women", "Men", "Athletes", "Fitness Enthusiasts"])
- categories: array of business categories/industries (e.g., ["Activewear", "Athleisure", "Fitness Apparel"])

Only include items that are explicitly mentioned or clearly implied in the text. Be specific and accurate.

Return JSON format:
{
  "products": ["product1", "product2", ...],
  "services": ["service1", "service2", ...],
  "targetAudience": ["audience1", "audience2", ...],
  "categories": ["category1", "category2", ...]
}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from LLM');
    }

    const parsed = JSON.parse(content);

    return {
      products: Array.isArray(parsed.products) ? parsed.products.slice(0, 20) : [],
      services: Array.isArray(parsed.services) ? parsed.services.slice(0, 15) : [],
      targetAudience: Array.isArray(parsed.targetAudience) ? parsed.targetAudience.slice(0, 10) : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories.slice(0, 10) : [],
    };
  } catch (error) {
    console.error('Error in LLM extraction:', error);
    throw error;
  }
}

async function scrapeCompanyPages(website: string): Promise<string> {
  const urls = [
    website,
    `${website}/about`,
    `${website}/about-us`,
  ];

  const texts: string[] = [];
  const errors: string[] = [];

  // Try Puppeteer first (for JavaScript-rendered sites)
  let browser;
  try {
    console.log('Launching Puppeteer browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ],
    });

    console.log('Puppeteer browser launched successfully');

    for (const url of urls) {
      try {
        console.log(`Scraping ${url} with Puppeteer...`);
        const page = await browser.newPage();

        // Set a realistic user agent
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        // Wait for content to load - try multiple strategies
        try {
          await page.waitForSelector('body', { timeout: 5000 });
        } catch (e) {
          console.log('Body selector not found, continuing...');
        }

        // Wait a bit for dynamic content to load
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Extract text content with more aggressive selectors
        const pageText = await page.evaluate(() => {
          // Remove script and style elements
          const scripts = document.querySelectorAll('script, style, noscript, iframe');
          scripts.forEach(el => el.remove());

          // Get title
          const title = document.title || '';

          // Get meta tags
          const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
          const metaKeywords = document.querySelector('meta[name="keywords"]')?.getAttribute('content') || '';
          const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
          const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';

          // Try multiple selectors for main content
          const selectors = [
            'main',
            'article',
            '[role="main"]',
            '.main-content',
            '#main-content',
            '.content',
            '#content',
            '.page-content',
            'body'
          ];

          let main = '';
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent) {
              main = element.textContent;
              break;
            }
          }

          // If still no content, get all text from body
          if (!main || main.trim().length < 50) {
            main = document.body?.textContent || '';
          }

          return [title, ogTitle, metaDescription, metaKeywords, ogDescription, main]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        });

        await page.close();

        console.log(`Extracted ${pageText.length} characters from ${url}`);

        if (pageText && pageText.length > 0) {
          texts.push(pageText);
        } else {
          errors.push(`No text extracted from ${url}`);
        }
      } catch (error: any) {
        const errorMsg = error.message || 'Unknown error';
        errors.push(`Puppeteer error for ${url}: ${errorMsg}`);
        console.error(`Error scraping ${url} with Puppeteer:`, errorMsg);
      }
    }

    await browser.close();
    console.log('Puppeteer browser closed');
  } catch (puppeteerError: any) {
    console.error('Puppeteer launch failed, falling back to axios:', puppeteerError.message);
    console.error('Puppeteer error details:', puppeteerError);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore close errors
      }
    }

    // Fallback to axios + cheerio for non-JS sites
    for (const url of urls) {
      try {
        const response = await axios.get(url, {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
          },
          maxRedirects: 5,
        });

        if (!response.data || typeof response.data !== 'string') {
          errors.push(`Invalid response from ${url}`);
          continue;
        }

        const $ = cheerio.load(response.data);

        // Extract meta tags
        const metaDescription = $('meta[name="description"]').attr('content') || '';
        const metaKeywords = $('meta[name="keywords"]').attr('content') || '';
        const ogDescription = $('meta[property="og:description"]').attr('content') || '';
        const title = $('title').text() || '';

        $('script, style, noscript').remove();

        let mainContent = $('main').text() ||
          $('article').text() ||
          $('.content').text() ||
          $('#content').text() ||
          $('.main-content').text() ||
          $('body').text();

        const combinedText = [
          title,
          metaDescription,
          metaKeywords,
          ogDescription,
          mainContent
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

        if (combinedText.length > 0) {
          texts.push(combinedText);
        }
      } catch (error: any) {
        const errorMsg = error.response
          ? `HTTP ${error.response.status} for ${url}`
          : error.message || 'Unknown error';
        errors.push(errorMsg);
        console.error(`Error scraping ${url}:`, errorMsg);
      }
    }
  }

  const combinedText = texts.join(' ').substring(0, 10000);

  if (combinedText.length === 0 && errors.length > 0) {
    console.error('Scraping failed for all URLs:', errors);
  }

  return combinedText;
}

function extractProducts(text: string, companyName: string): string[] {
  const products: string[] = [];
  const lowerText = text.toLowerCase();

  // Common product patterns in e-commerce sites
  const productPatterns = [
    // Pattern: "Women's X", "Men's X", "X for Y"
    /\b(?:Women'?s|Men'?s|Unisex)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
    // Pattern: "X Collection", "X Line", "X Range"
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Collection|Line|Range)/gi,
    // Common product types
    /\b(Leggings|Sports Bras|Gym Shorts|Tank Tops|Hoodies|T-Shirts|Joggers|Sweatpants|Shorts|Tops|Bottoms|Accessories|Bags|Socks|Caps|Beanies|Underwear|Baselayers|Stringers)\b/gi,
    // Pattern: "Shop X" or "X Shop"
    /\b(?:Shop|Buy)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
  ];

  // Extract products using patterns
  for (const pattern of productPatterns) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      const product = match[1] || match[0];
      if (product && product.length > 2 && product.length < 50) {
        products.push(product.trim());
      }
    }
  }

  // Also look for capitalized product names (common in e-commerce)
  const capitalizedWords = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  for (const word of capitalizedWords) {
    // Filter out common non-product words
    const skipWords = ['Shop', 'Free', 'Delivery', 'Orders', 'Gift', 'Now', 'Get', 'Your', 'The', 'Our', 'With', 'For', 'And', 'Are', 'You', 'Can', 'This', 'That', 'Have', 'From'];
    if (!skipWords.some((skip: string) => word.includes(skip)) && word.length > 5 && word.length < 40) {
      products.push(word);
    }
  }

  return Array.from(new Set(products)).slice(0, 15);
}

function extractServices(text: string): string[] {
  const services: string[] = [];
  const lowerText = text.toLowerCase();

  // Common service patterns
  const servicePatterns = [
    /\b(Free\s+delivery|Free\s+shipping|Express\s+delivery|Standard\s+delivery|Returns|Refunds|Customer\s+service|Support|Warranty|Guarantee)\b/gi,
    /\b(Shipping|Delivery|Returns|Refunds|Exchanges|Customer Service|Support|Warranty)\b/gi,
  ];

  for (const pattern of servicePatterns) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      const service = match[0].trim();
      if (service && service.length > 3) {
        services.push(service);
      }
    }
  }

  // Look for service-related sentences
  const serviceKeywords = ['free delivery', 'free shipping', 'returns', 'refunds', 'customer service', 'support'];
  for (const keyword of serviceKeywords) {
    if (lowerText.includes(keyword)) {
      services.push(keyword.charAt(0).toUpperCase() + keyword.slice(1));
    }
  }

  return Array.from(new Set(services)).slice(0, 10);
}

function extractTargetAudience(text: string): string[] {
  const audiences: string[] = [];
  const lowerText = text.toLowerCase();

  // Common target audience patterns
  const audiencePatterns = [
    // "Women's", "Men's", "Unisex"
    /\b(Women'?s|Men'?s|Unisex|Kids'?|Children'?s)\b/gi,
    // "for athletes", "for bodybuilders", etc.
    /\bfor\s+([a-z]+(?:ers|ists|ers|ers))\b/gi,
    // Common audience terms
    /\b(Athletes|Bodybuilders|Fitness Enthusiasts|Gym Goers|Runners|Trainers|Athletes|Active People|Fitness Lovers)\b/gi,
  ];

  for (const pattern of audiencePatterns) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      const audience = match[1] || match[0];
      if (audience && audience.length > 2) {
        // Capitalize properly
        const capitalized = audience.split(' ').map((w: string) =>
          w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
        ).join(' ');
        audiences.push(capitalized);
      }
    }
  }

  // Look for explicit mentions
  if (lowerText.includes("women's") || lowerText.includes("womens")) {
    audiences.push("Women");
  }
  if (lowerText.includes("men's") || lowerText.includes("mens")) {
    audiences.push("Men");
  }
  if (lowerText.includes("athletes") || lowerText.includes("athlete")) {
    audiences.push("Athletes");
  }
  if (lowerText.includes("bodybuilders") || lowerText.includes("bodybuilder")) {
    audiences.push("Bodybuilders");
  }
  if (lowerText.includes("fitness enthusiasts") || lowerText.includes("fitness enthusiast")) {
    audiences.push("Fitness Enthusiasts");
  }
  if (lowerText.includes("gym goers") || lowerText.includes("gym-goers")) {
    audiences.push("Gym Goers");
  }

  return Array.from(new Set(audiences)).slice(0, 10);
}

function extractCategories(text: string): string[] {
  const categories: string[] = [];
  const lowerText = text.toLowerCase();

  // Common category patterns
  const categoryPatterns = [
    // "Workout Clothes", "Gym Clothes", "Activewear", etc.
    /\b(Workout\s+Clothes?|Gym\s+Clothes?|Activewear|Athleisure|Sportswear|Fitness\s+Apparel|Training\s+Clothes?|Exercise\s+Clothes?|Athletic\s+Wear)\b/gi,
    // Industry terms
    /\b(Fashion|Apparel|Clothing|Retail|E-commerce|Fitness|Sports|Athletics)\b/gi,
  ];

  for (const pattern of categoryPatterns) {
    const matches = Array.from(text.matchAll(pattern));
    for (const match of matches) {
      const category = match[0].trim();
      if (category && category.length > 3) {
        categories.push(category);
      }
    }
  }

  // Look for explicit category mentions
  if (lowerText.includes("activewear") || lowerText.includes("active wear")) {
    categories.push("Activewear");
  }
  if (lowerText.includes("athleisure")) {
    categories.push("Athleisure");
  }
  if (lowerText.includes("workout clothes") || lowerText.includes("workout clothing")) {
    categories.push("Workout Clothes");
  }
  if (lowerText.includes("gym clothes") || lowerText.includes("gym clothing")) {
    categories.push("Gym Clothes");
  }
  if (lowerText.includes("sportswear")) {
    categories.push("Sportswear");
  }
  if (lowerText.includes("fitness apparel")) {
    categories.push("Fitness Apparel");
  }

  return Array.from(new Set(categories)).slice(0, 10);
}

