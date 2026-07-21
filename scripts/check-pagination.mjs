import axios from 'axios';

const apiKey = '6ee2a6180edc209615a407b619927a4523f48564';
const baseUrl = 'https://sports.bzzoiro.com/api/v2';

async function main() {
  // Check if events endpoint supports pagination
  const res = await axios.get(`${baseUrl}/events/`, {
    headers: { Authorization: `Token ${apiKey}` },
    params: { status: 'notstarted', date_from: '2026-07-19', date_to: '2026-07-20' },
    timeout: 15000
  });
  const data = res.data;
  console.log('Events response keys:', Object.keys(data));
  console.log('count:', data.count);
  console.log('next:', data.next);
  console.log('previous:', data.previous);
  console.log('results:', data.results?.length);

  // Check if limit/offset params work
  if (data.count > data.results?.length) {
    console.log('\nTrying page 2...');
    const res2 = await axios.get(`${baseUrl}/events/`, {
      headers: { Authorization: `Token ${apiKey}` },
      params: { status: 'notstarted', date_from: '2026-07-19', date_to: '2026-07-20', limit: 50, offset: 50 },
      timeout: 15000
    });
    const data2 = res2.data;
    console.log('Page 2 results:', data2.results?.length);
    console.log('Page 2 next:', data2.next);
    if (data2.results?.length > 0) {
      const ev = data2.results[0];
      console.log('First fixture page 2:', ev.id, ev.home_team?.name || ev.home_team, 'vs', ev.away_team?.name || ev.away_team);
    }
  }

  // Get ALL events and find how many have odds
  console.log('\nScanning all events for odds...');
  let allEvents = [];
  let url = `${baseUrl}/events/?status=notstarted&date_from=2026-07-19&date_to=2026-07-26`;
  while (url) {
    console.log('Fetching:', url.slice(0, 120));
    const r = await axios.get(url, {
      headers: { Authorization: `Token ${apiKey}` },
      timeout: 15000
    });
    allEvents = allEvents.concat(r.data.results || []);
    url = r.data.next;
  }
  console.log(`Total events: ${allEvents.length}`);

  // Check first 20 for odds
  let withOdds = 0;
  for (let i = 0; i < Math.min(allEvents.length, 50); i++) {
    const ev = allEvents[i];
    try {
      const odds = await axios.get(`${baseUrl}/events/${ev.id}/odds/comparison/`, {
        headers: { Authorization: `Token ${apiKey}` },
        timeout: 8000
      });
      const mk = odds.data?.markets ? Object.keys(odds.data.markets) : [];
      if (mk.length > 0) {
        withOdds++;
        if (withOdds <= 3) {
          console.log(`  ${ev.id}: ${ev.home_team?.name || ev.home_team} vs ${ev.away_team?.name || ev.away_team} -> ${mk.join(', ')}`);
        }
      }
    } catch(e) {}
  }
  console.log(`${withOdds}/${Math.min(allEvents.length, 50)} fixtures have odds`);
}

main().catch(e => console.error(e.response?.status, e.message));
