import axios from 'axios';

const apiKey = '6ee2a6180edc209615a407b619927a4523f48564';
const baseUrl = 'https://sports.bzzoiro.com/api/v2';

async function main() {
  // Fetch all leagues with pagination
  let url = `${baseUrl}/leagues/`;
  let allLeagues = [];
  while (url) {
    const res = await axios.get(url, {
      headers: { Authorization: `Token ${apiKey}` },
      timeout: 10000
    });
    allLeagues = allLeagues.concat(res.data.results || []);
    url = res.data.next;
  }
  console.log(`Total leagues: ${allLeagues.length}`);
  console.log('\nAll active leagues:');
  for (const l of allLeagues) {
    console.log(`  ID ${String(l.id).padStart(3)}: ${l.name} (${l.country}) active=${l.is_active}`);
  }
}

main().catch(e => console.error(e.response?.status, e.message, e.response?.data?.toString().slice(0, 300)));
