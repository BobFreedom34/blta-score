// One-time helper: mints a Google OAuth refresh token for the Drive
// backup (see src/backup.js and .env.example). Run this yourself, once,
// on your own machine:
//
//   node scripts/get-drive-refresh-token.js <CLIENT_ID> <CLIENT_SECRET>
//
// It opens nothing on its own — it prints a Google URL for YOU to open in
// your own browser, where YOU log into your own Google account and click
// Allow (this script, and whoever is helping you run it, never sees your
// Google password — only Google's own login page does). Google then
// redirects your browser back to a tiny local server this script starts,
// which prints the refresh token to your terminal. Copy that value into
// Render's dashboard yourself as GOOGLE_OAUTH_REFRESH_TOKEN — this script
// does not (and cannot) do that step for you.
const http = require('http');
const { OAuth2Client } = require('google-auth-library');

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Usage: node scripts/get-drive-refresh-token.js <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const PORT = 53682; // arbitrary fixed loopback port; must match the redirect URI you added to the OAuth client
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

const client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  if (!code) {
    res.end('No ?code= in the request — check the console for errors.');
    return;
  }
  res.end('Done — you can close this tab and go back to your terminal.');
  server.close();

  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      console.error(
        '\nGoogle did not return a refresh token. This usually means you\'ve already\n' +
        'authorized this exact app before — go to https://myaccount.google.com/permissions,\n' +
        'remove access for this app, and run this script again.'
      );
      process.exit(1);
    }
    console.log('\n✅ Success! Your refresh token is:\n');
    console.log(tokens.refresh_token);
    console.log('\nCopy that value into Render as GOOGLE_OAUTH_REFRESH_TOKEN.');
  } catch (err) {
    console.error('\nFailed to exchange the code for tokens:', err.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces a refresh_token even on a repeat run
    scope: ['https://www.googleapis.com/auth/drive.file'],
  });
  console.log('\nOpen this URL in your browser and log into the Google account you want backups saved to:\n');
  console.log(authUrl);
  console.log('\nWaiting for you to finish the consent screen...');
});
