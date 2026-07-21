import axios from 'axios';
import 'dotenv/config';

const apiKey = process.env.SPORTSAPI_KEY;
const baseUrl = process.env.SPORTSAPI_BASE_URL || 'https://sports.bzzoiro.com/api/v2';

async function main() {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  console.log(`Searching ${today}..${tomorrow}`);

  const evRes = await axios.get(`${baseUrl}/events/`, {
    headers: { Authorization: `Token ${apiKey}` },
    params: { status: 'notstarted', date_from: today, date_to: tomorrow },
    timeout: 15000,
  });
  const results = evRes.data?.results || [];
  console.log(`Fixtures today/tomorrow: ${results.length}`);

  if (results.length === 0) {
    console.log('No fixtures found for today/tomorrow.');
    return;
  }

  for (let i = 0; i < Math.min(3, results.length); i++) {
    const ev = results[i];
    const home = ev.home_team?.name || ev.home_team;
    const away = ev.away_team?.name || ev.away_team;
    console.log(`\n--- ${ev.id}: ${home} vs ${away} ---`);

    const oddsRes = await axios.get(`${baseUrl}/events/${ev.id}/odds/comparison/`, {
      headers: { Authorization: `Token ${apiKey}` },
      timeout: 15000,
    });
    const data = oddsRes.data;
    console.log('Keys:', Object.keys(data));

    if (data.markets && typeof data.markets === 'object') {
      const codes = Object.keys(data.markets);
      console.log(`Market codes (${codes.length}):`, codes);
      for (const code of codes) {
        const mv = data.markets[code];
        const isArr = Array.isArray(mv);
        console.log(`  ${code}: ${typeof mv} arr=${isArr}`);
        const items = isArr ? mv : (typeof mv === 'object' && mv !== null ? Object.values(mv) : []);
        for (const item of items.slice(0, 2)) {
          if (typeof item === 'object' && item !== null) {
            console.log(`    outcome: ${item.outcome || '?'} | name: ${item.outcome_name || '?'} | best_odds: ${item.best_odds || '?'}`);
          } else {
            console.log(`    value: ${item}`);
          }
        }
      }
    } else {
      console.log('markets is not an object');
      if (data.comparison) {
        console.log('comparison available, type:', typeof data.comparison, Array.isArray(data.comparison));
      }
    }
  }
}

main().catch(e => {
  console.error('Error:', e.response?.status, e.message);
  if (e.response?.data) console.error(JSON.stringify(e.response.data).slice(0, 500));
});
