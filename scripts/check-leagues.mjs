import mongoose from 'mongoose';
import 'dotenv/config';
import axios from 'axios';

const apiKey = '6ee2a6180edc209615a407b619927a4523f48564';
const baseUrl = 'https://sports.bzzoiro.com/api/v2';

async function main() {
  // Check what the /events/ endpoint returns for each league
  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  
  const leagues = ['1', '3', '4', '5', '6', '7', '8', '2'];
  
  for (const lid of leagues) {
    try {
      const res = await axios.get(`${baseUrl}/events/`, {
        headers: { Authorization: `Token ${apiKey}` },
        params: { status: 'notstarted', date_from: today, date_to: nextWeek, league: lid },
        timeout: 15000
      });
      const events = res.data?.results || [];
      console.log(`League ${lid}: ${events.length} events`);
      
      if (events.length > 0) {
        const ev = events[0];
        console.log(`  First: ${ev.id} ${ev.home_team?.name || ev.home_team} vs ${ev.away_team?.name || ev.away_team}`);
        
        // Check odds
        try {
          const odds = await axios.get(`${baseUrl}/events/${ev.id}/odds/comparison/`, {
            headers: { Authorization: `Token ${apiKey}` },
            timeout: 10000
          });
          const mk = odds.data?.markets ? Object.keys(odds.data.markets) : [];
          console.log(`  Odds markets: ${mk.length} -> ${mk.join(', ')}`);
        } catch(e) {
          console.log(`  Odds error: ${e.message}`);
        }
      }
    } catch(e) {
      console.log(`League ${lid}: ERROR ${e.response?.status || e.message}`);
    }
  }

  await mongoose.disconnect();
}

main().catch(e => console.error(e));
