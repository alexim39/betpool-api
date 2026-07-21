import axios from 'axios';
import 'dotenv/config';

const apiKey = process.env.SPORTSAPI_KEY;
const baseUrl = process.env.SPORTSAPI_BASE_URL || 'https://sports.bzzoiro.com/api/v2';

async function main() {
  const events = await axios.get(`${baseUrl}/events/`, {
    headers: { Authorization: `Token ${apiKey}` },
    params: { status: 'notstarted', date_from: '2026-07-19', date_to: '2026-07-26', league: '1' },
    timeout: 15000,
  });
  const results = events.data?.results || [];
  console.log(`Found ${results.length} events`);
  for (let i = 0; i < Math.min(2, results.length); i++) {
    const ev = results[i];
    const homeName = ev.home_team?.name || ev.home_team;
    const awayName = ev.away_team?.name || ev.away_team;
    console.log(`\n--- Fixture ${ev.id}: ${homeName} vs ${awayName} ---`);

    const odds = await axios.get(`${baseUrl}/events/${ev.id}/odds/comparison/`, {
      headers: { Authorization: `Token ${apiKey}` },
      timeout: 15000,
    });
    const data = odds.data;
    console.log('Top-level keys:', Object.keys(data));

    if (data.markets && typeof data.markets === 'object') {
      console.log('Market codes found:', Object.keys(data.markets));
      for (const [code, mval] of Object.entries(data.markets)) {
        const isObj = typeof mval === 'object' && mval !== null;
        const isArr = Array.isArray(mval);
        console.log(`  ${code}: object=${isObj} array=${isArr}`);
        if (isObj && !isArr) {
          for (const [ok, ov] of Object.entries(mval).slice(0, 2)) {
            console.log(`    ${ok}:`, JSON.stringify(ov).slice(0, 250));
          }
        }
        if (isArr) {
          for (const item of mval.slice(0, 2)) {
            console.log(`    item:`, JSON.stringify(item).slice(0, 250));
          }
        }
      }
    } else {
      console.log('No markets object, checking comparison...');
      if (data.comparison) {
        console.log('Comparison:', JSON.stringify(data.comparison).slice(0, 500));
      }
    }
  }
}

main().catch(e => {
  console.error('Error:', e.response?.status, e.message);
  if (e.response?.data) console.error('Data:', JSON.stringify(e.response.data).slice(0, 500));
});
