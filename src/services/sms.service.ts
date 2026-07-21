import axios from 'axios';

const BULKSMS_API_URL_HOST = 'www.bulksmsnigeria.com';
const BULKSMS_TOKEN = process.env.BULKSMS_API_TOKEN || '';
const BULKSMS_FROM = process.env.BULKSMS_SENDER_ID || 'betpool';

const formatPhone = (phone: string): string => {
  let cleaned = String(phone || '').replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  if (cleaned.startsWith('0')) cleaned = '234' + cleaned.slice(1);
  else if (cleaned.length === 10 && /^[789]\d/.test(cleaned)) cleaned = '234' + cleaned;
  else if (cleaned.length < 11 && !cleaned.startsWith('234')) cleaned = '234' + cleaned;
  return cleaned;
};

export const sendSms = async (to: string, message: string, options: { apiToken?: string; from?: string; gateway?: string; customerReference?: string } = {}): Promise<any> => {
  const numbers = String(to).split(',').map(n => formatPhone(n.trim())).filter(Boolean).join(',');
  if (!numbers) throw new Error('No valid recipient phone number.');

  const token = options.apiToken || BULKSMS_TOKEN;
  const from = options.from || BULKSMS_FROM;
  const ref = options.customerReference || `MSP${Date.now()}`;

  let lastError = '';

  // Strategy 1: v2 API with api_token in body
  try {
    const resp = await axios.post(`https://${BULKSMS_API_URL_HOST}/api/v2/sms`, {
      body: message, from, to: numbers, api_token: token,
      gateway: options.gateway || '0',
      customer_reference: ref,
    }, { headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 15000 });
    const data = resp.data;
    if (data?.status === 'success') return data;
    lastError = `v1: status=${data?.status} message=${data?.message || ''}`;
  } catch (e: any) {
    lastError = `v1 error: ${e.message}${e.response?.data ? ' ' + JSON.stringify(e.response.data).slice(0, 100) : ''}`;
  }

  // Strategy 2: v2 API with Bearer token header
  try {
    const resp = await axios.post(`https://${BULKSMS_API_URL_HOST}/api/v2/sms`, {
      body: message, from, to: numbers, gateway: options.gateway || '0', customer_reference: ref,
    }, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'Content-Type': 'application/json' }, timeout: 15000 });
    const data = resp.data;
    if (data?.status === 'success') return data;
    lastError = `v2: status=${data?.status} message=${data?.message || ''}`;
  } catch (e: any) {
    lastError = `v2 error: ${e.message}${e.response?.data ? ' ' + JSON.stringify(e.response.data).slice(0, 100) : ''}`;
  }

  // Strategy 3: v1 API
  try {
    const resp = await axios.get(`https://${BULKSMS_API_URL_HOST}/api/v1/sms/create`, {
      params: { api_token: token, from, to: numbers, body: message, gateway: options.gateway || '0' },
      timeout: 15000,
    });
    const data = resp.data;
    if (data?.status === 'success') return data;
    lastError = `v3: status=${data?.status} message=${data?.message || ''}`;
  } catch (e: any) {
    lastError = `v3 error: ${e.message}${e.response?.data ? ' ' + JSON.stringify(e.response.data).slice(0, 100) : ''}`;
  }

  throw new Error(`SMS failed. Last error: ${lastError}. Generate a new token at https://${BULKSMS_API_URL_HOST}/dashboard/api`);
};

export const sendBulkSms = async (recipients: (string | { phone: string })[], message: string, options: { apiToken?: string; from?: string; gateway?: string } = {}): Promise<any> => {
  const phones = recipients.map(r => formatPhone(typeof r === 'string' ? r : r.phone)).filter(Boolean);
  if (!phones.length) throw new Error('No valid recipient phone numbers provided.');
  return sendSms(phones.join(','), message, { ...options, customerReference: `MSPBULK${Date.now()}` });
};
