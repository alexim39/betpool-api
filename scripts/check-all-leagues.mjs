import axios from 'axios';

const apiKey = '6ee2a6180edc209615a407b619927a4523f48564';
const baseUrl = 'https://sports.bzzoiro.com/api/v2';

async function main() {
  // Try to get leagues list
  try {
    const res = await axios.get(`${baseUrl}/leagues/`, {
      headers: { Authorization: `Token ${apiKey}` },
      timeout: 10000
    });
    console.log('Leagues endpoint:', JSON.stringify(res.data).slice(0, 500));
  } catch(e) {
    console.log('Leagues endpoint error:', e.response?.status, e.message);
  }

  // Try the events endpoint without league filter
  console.log('\n--- Events without league filter ---');
  try {
    const res = await axios.get(`${baseUrl}/events/`, {
      headers: { Authorization: `Token ${apiKey}` },
      params: { status: 'notstarted', date_from: '2026-07-19', date_to: '2026-07-20' },
      timeout: 15000
    });
    const events = res.data?.results || [];
    console.log(`Total: ${events.length} events`);
    const leagues = {};
    for (const ev of events.slice(0, 20)) {
      const lid = ev.league?.id || ev.league_id || '?';
      const lname = ev.league?.name || ev.league_name || '?';
      if (!leagues[lid]) leagues[lid] = { name: lname, count: 0, hasOdds: false };
      leagues[lid].count++;
    }
    console.log('Leagues represented:');
    for (const [lid, info] of Object.entries(leagues)) {
      // Check if this league has odds for a fixture
      const fixtureId = events.find(e => (e.league?.id || e.league_id) == lid)?.id;
      let hasOdds = false;
      if (fixtureId) {
        try {
          const odds = await axios.get(`${baseUrl}/events/${fixtureId}/odds/comparison/`, {
            headers: { Authorization: `Token ${apiKey}` },
            timeout: 8000
          });
          const mk = odds.data?.markets ? Object.keys(odds.data.markets) : [];
          hasOdds = mk.length > 0;
        } catch(e) {}
      }
      console.log(`  League ${lid} (${info.name}): ${info.count} events, odds=${hasOdds}`);
    }
  } catch(e) {
    console.log('Events error:', e.response?.status, e.message);
  }
}

main().catch(e => console.error(e));
