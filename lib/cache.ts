import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const CACHE_DIR = path.join(process.cwd(), '.cache');

// Ensure cache directory exists
function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

// Generate a hash key from input parameters
export function generateCacheKey(prefix: string, ...args: any[]): string {
  const hash = crypto.createHash('md5').update(JSON.stringify(args)).digest('hex');
  return `${prefix}_${hash}`;
}

// Get cached data if it exists and is not expired
export function getCache<T>(key: string, maxAgeMs: number = 24 * 60 * 60 * 1000): T | null {
  ensureCacheDir();
  const filePath = path.join(CACHE_DIR, `${key}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const age = Date.now() - stats.mtimeMs;
      
      // Check if cache is still valid
      if (age < maxAgeMs) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(data);
        console.log(`Cache HIT for ${key}`);
        return parsed as T;
      } else {
        console.log(`Cache EXPIRED for ${key} (age: ${Math.round(age / 1000 / 60)} min)`);
      }
    }
  } catch (error) {
    console.warn(`Cache read error for ${key}:`, error);
  }
  
  return null;
}

// Save data to cache
export function setCache<T>(key: string, data: T): void {
  ensureCacheDir();
  const filePath = path.join(CACHE_DIR, `${key}.json`);
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Cache SET for ${key}`);
  } catch (error) {
    console.warn(`Cache write error for ${key}:`, error);
  }
}

// Clear all cache or specific prefix
export function clearCache(prefix?: string): void {
  ensureCacheDir();
  
  try {
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      if (!prefix || file.startsWith(prefix)) {
        fs.unlinkSync(path.join(CACHE_DIR, file));
      }
    }
    console.log(`Cache cleared${prefix ? ` for prefix: ${prefix}` : ''}`);
  } catch (error) {
    console.warn('Cache clear error:', error);
  }
}

