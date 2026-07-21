import axios from 'axios';
import 'dotenv/config';

const API = `http://localhost:8383/api`;

async function main() {
  // Login as admin
  const loginRes = await axios.post(`${API}/auth/login/email/request`, {
    email: 'admin@betpool.tech'
  });
  console.log('Login request:', loginRes.data);

  // We need the OTP code - let's check if there's a different auth approach
  // Try the PIN login
  console.log('\nTrying PIN login...');
  try {
    const pinRes = await axios.post(`${API}/auth/login/pin`, {
      email: 'admin@betpool.tech',
      pin: '1234' // common default
    });
    console.log('PIN login:', pinRes.data);
    if (pinRes.data?.token) {
      console.log('Got token!');
      await triggerSync(pinRes.data.token);
    }
  } catch (e) {
    console.log('PIN login failed:', e.response?.status, e.response?.data);
  }
}

async function triggerSync(token) {
  const headers = { Authorization: `Bearer ${token}` };
  
  // Sync with 2 days ahead
  console.log('\nTriggering sync (2 days ahead)...');
  const syncRes = await axios.post(`${API}/admin/pods/sync`, 
    { daysAhead: 2 },
    { headers }
  );
  console.log('Sync result:', JSON.stringify(syncRes.data, null, 2));
}

main().catch(e => console.error(e.response?.status, e.response?.data || e.message));
