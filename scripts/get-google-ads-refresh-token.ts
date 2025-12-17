/**
 * Script to obtain Google Ads OAuth refresh token
 * 
 * Usage:
 * 1. Set environment variables in .env file:
 *    - GOOGLE_ADS_CLIENT_ID
 *    - GOOGLE_ADS_CLIENT_SECRET
 *    - GOOGLE_ADS_DEVELOPER_TOKEN
 * 
 * 2. Run: npm run get-refresh-token
 * 
 * 3. Visit the authorization URL printed in the console
 * 
 * 4. After authorization, you'll be redirected to a page showing an authorization code
 *    Copy the code and paste it when prompted
 * 
 * 5. The script will exchange the code for tokens and display your refresh token
 */

import * as readline from 'readline';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env file from project root
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config(); // Fallback to default .env loading
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function getRefreshToken() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  if (!clientId || !clientSecret) {
    console.error('Error: GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET must be set');
    process.exit(1);
  }

  // OAuth 2.0 scopes for Google Ads API
  const scopes = [
    'https://www.googleapis.com/auth/adwords',
  ].join(' ');

  // Redirect URI (must match what's configured in Google Cloud Console)
  // For local development, you can use http://localhost:3000/oauth/callback
  // Or use urn:ietf:wg:oauth:2.0:oob for out-of-band (manual copy-paste)
  const redirectUri = 'urn:ietf:wg:oauth:2.0:oob';

  // Step 1: Generate authorization URL
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('access_type', 'offline'); // Required to get refresh token
  authUrl.searchParams.set('prompt', 'consent'); // Force consent screen to ensure refresh token

  console.log('\n=== Google Ads OAuth Setup ===\n');
  console.log('⚠️  IMPORTANT: If you see "app is currently being tested" error:');
  console.log('   1. Go to: https://console.cloud.google.com/apis/credentials/consent');
  console.log('   2. Click on your OAuth client');
  console.log('   3. Scroll to "Test users" section');
  console.log('   4. Click "+ ADD USERS" and add your Google account email');
  console.log('   5. Save and try again\n');
  console.log('1. Visit this URL in your browser:');
  console.log('\n' + authUrl.toString() + '\n');
  console.log('2. Authorize the application');
  console.log('3. You will be redirected to a page showing an authorization code');
  console.log('4. Copy the entire code and paste it below\n');

  const authCode = await question('Enter the authorization code: ');

  if (!authCode || authCode.trim() === '') {
    console.error('Error: Authorization code is required');
    rl.close();
    process.exit(1);
  }

  // Step 2: Exchange authorization code for tokens
  try {
    console.log('\nExchanging authorization code for tokens...\n');

    const tokenResponse = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code: authCode.trim(),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    if (!refresh_token) {
      console.error('Error: No refresh token received. Make sure you:');
      console.error('  - Set access_type=offline in the authorization URL');
      console.error('  - Set prompt=consent to force the consent screen');
      console.error('  - Are authorizing for the first time (or revoked access)');
      rl.close();
      process.exit(1);
    }

    console.log('✅ Success! Here are your tokens:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('REFRESH TOKEN (save this!):');
    console.log(refresh_token);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Access Token (expires in ' + expires_in + ' seconds):');
    console.log(access_token);
    console.log('\n');

    if (developerToken) {
      console.log('Developer Token:');
      console.log(developerToken);
      console.log('\n');
    }

    console.log('Add these to your .env file:');
    console.log(`GOOGLE_ADS_REFRESH_TOKEN=${refresh_token}`);
    console.log(`GOOGLE_ADS_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_ADS_CLIENT_SECRET=${clientSecret}`);
    if (developerToken) {
      console.log(`GOOGLE_ADS_DEVELOPER_TOKEN=${developerToken}`);
    }
    console.log('\n');

  } catch (error: any) {
    console.error('Error exchanging authorization code:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('\nFull error response:', JSON.stringify(error.response.data, null, 2));
    }
    rl.close();
    process.exit(1);
  }

  rl.close();
}

getRefreshToken().catch((error) => {
  console.error('Unexpected error:', error);
  rl.close();
  process.exit(1);
});

