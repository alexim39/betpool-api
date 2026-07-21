import axios from 'axios';

const apiKey = '6ee2a6180edc209615a407b619927a4523f48564';
const baseUrl = 'https://sports.bzzoiro.com/api/v2';

async function main() {
  // Check what league fixture 214533 (has odds) belongs to
  const oddsRes = await axios.get(`${baseUrl}/events/214533/odds/comparison/`, {
    headers: { Authorization: `Token ${apiKey}` },
    timeout: 10000
  });
  const d = oddsRes.data;
  console.log('Fixture 214533 odds:');
  console.log('  league_id:', d.league_id);
  console.log('  league_name:', d.league_name);
  console.log('  markets:', Object.keys(d.markets || {}));

  // Check fixture 216384
  const oddsRes2 = await axios.get(`${baseUrl}/events/216384/odds/comparison/`, {
    headers: { Authorization: `Token ${apiKey}` },
    timeout: 10000
  });
  const d2 = oddsRes2.data;
  console.log('\nFixture 216384 odds:');
  console.log('  league_id:', d2.league_id);
  console.log('  league_name:', d2.league_name);
  console.log('  markets:', Object.keys(d2.markets || {}));

  // Check fixture 211651 (had odds)
  const oddsRes3 = await axios.get(`${baseUrl}/events/211651/odds/comparison/`, {
    headers: { Authorization: `Token ${apiKey}` },
    timeout: 10000
  });
  const d3 = oddsRes3.data;
  console.log('\nFixture 211651 odds:');
  console.log('  league_id:', d3.league_id);
  console.log('  league_name:', d3.league_name);
  console.log('  markets:', Object.keys(d3.markets || {}));

  // Try the events endpoint with more specific params
  console.log('\n--- Searching for actual league 1 fixtures ---');
  const evRes = await axios.get(`${baseUrl}/events/`, {
    headers: { Authorization: `Token ${apiKey}` },
    params: { status: 'notstarted', date_from: '2026-07-19', date_to: '2026-07-20', league: '1' },
    timeout: 15000
  });
  const events = evRes.data?.results || [];
  console.log(`Returned ${events.length} events`);
  // Check leagues of returned events
  const leagues = new Set();
  for (const ev of events.slice(0, 10)) {
    const lid = ev.league?.id || ev.league_id || '?';
    const lname = ev.league?.name || ev.league_name || '?';
    leagues.add(`${lid}:${lname}`);
    console.log(`  ${ev.id}: league=${lid} ${lname} | ${ev.home_team?.name || ev.home_team} vs ${ev.away_team?.name || ev.away_team}`);
  }
  console.log('Unique leagues in response:', [...leagues]);
}

main().catch(e => console.error('Error:', e.response?.status, e.message));
