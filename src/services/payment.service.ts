import axios from 'axios';
import crypto from 'crypto';
import { walletService } from './wallet.service';

export interface PaystackInitResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export interface BankAccount {
  accountNumber: string;
  bankCode: string;
  accountName?: string;
}

export interface WithdrawalResponse {
  success: boolean;
  reference: string;
  message: string;
}

export class PaymentService {
  private paystackBase = 'https://api.paystack.co';

  private get paystackSecret(): string {
    return process.env.PAYSTACK_SECRET_KEY || '';
  }

  private get paystackWebhookSecret(): string {
    return process.env.PAYSTACK_WEBHOOK_SECRET || '';
  }

  verifyPaystackWebhookSignature(payload: any, signature: string): boolean {
    const hash = crypto.createHmac('sha256', this.paystackWebhookSecret).update(JSON.stringify(payload)).digest('hex');
    return hash === signature;
  }

  async initializePaystackDeposit(
    email: string,
    amount: number,
    reference: string,
    callbackUrl: string,
    metadata: Record<string, any> = {}
  ): Promise<PaystackInitResponse> {
    const secret = this.paystackSecret;
    if (!secret) {
      throw new Error('Paystack not configured');
    }

    const response = await axios.post<PaystackInitResponse>(
      `${this.paystackBase}/transaction/initialize`,
      {
        email,
        amount: amount * 100,
        reference,
        callback_url: callbackUrl,
        currency: 'NGN',
        metadata
      },
      {
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  }

  async verifyPaystackTransaction(reference: string): Promise<{
    status: string;
    amount: number;
    paidAt: Date;
    channel: string;
    customer: { email: string };
  } | null> {
    const secret = this.paystackSecret;
    if (!secret) {
      throw new Error('Paystack not configured');
    }

    try {
      const response = await axios.get(
        `${this.paystackBase}/transaction/verify/${reference}`,
        { headers: { Authorization: `Bearer ${secret}` } }
      );

      if (response.data.status && response.data.data.status === 'success') {
        const data = response.data.data;
        return {
          status: data.status,
          amount: data.amount / 100,
          paidAt: new Date(data.paid_at),
          channel: data.channel,
          customer: { email: data.customer.email }
        };
      }
      return null;
    } catch (error) {
      console.error('Paystack verification failed:', error);
      return null;
    }
  }

  async resolveBankAccount(accountNumber: string, bankCode: string): Promise<{ accountName: string } | null> {
    const secret = this.paystackSecret;
    if (!secret) return null;

    try {
      const response = await axios.get(
        `${this.paystackBase}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
        { headers: { Authorization: `Bearer ${secret}` } }
      );

      if (response.data.status) {
        return { accountName: response.data.data.account_name };
      }
      return null;
    } catch (error) {
      console.error('Account resolution failed:', error);
      return null;
    }
  }

  async listBanks(): Promise<{ code: string; name: string }[]> {
    const paystackSecret = this.paystackSecret;
    if (paystackSecret) {
      try {
        const response = await axios.get(
          `${this.paystackBase}/bank`,
          { headers: { Authorization: `Bearer ${paystackSecret}` } }
        );
        return response.data.data.map((b: any) => ({ code: b.code, name: b.name }));
      } catch { }
    }
    return [];
  }

  async initiateWithdrawal(
    userId: string,
    amount: number,
    account: BankAccount,
    reference: string
  ): Promise<WithdrawalResponse> {
    const secret = this.paystackSecret;
    if (!secret) {
      return { success: false, reference, message: 'Payment provider not configured' };
    }

    const walletResult = await walletService.getBalance(userId);
    if (walletResult.available < amount) {
      return { success: false, reference, message: 'Insufficient balance' };
    }

    try {
      const response = await axios.post(
        `${this.paystackBase}/transfer`,
        {
          source: 'balance',
          amount: amount * 100,
          reference,
          recipient: await this.createTransferRecipient(account.accountName || 'User', account.accountNumber, account.bankCode),
          reason: 'BetPool withdrawal'
        },
        { headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' } }
      );

      if (response.data.status && response.data.data.status === 'pending') {
        return { success: true, reference, message: 'Withdrawal initiated' };
      }
      return { success: false, reference, message: response.data.message || 'Withdrawal failed' };
    } catch (error: any) {
      return { success: false, reference, message: error.response?.data?.message || 'Withdrawal failed' };
    }
  }

  async createTransferRecipient(name: string, accountNumber: string, bankCode: string): Promise<string> {
    const secret = this.paystackSecret;
    const response = await axios.post(
      `${this.paystackBase}/transferrecipient`,
      {
        type: 'nuban',
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN'
      },
      { headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' } }
    );

    return response.data.data.recipient_code;
  }

  async verifyBvn(bvn: string): Promise<{ firstName: string; lastName: string; dob: string; mobile: string } | null> {
    if (!/^\d{11}$/.test(bvn)) return null;
    const secret = this.paystackSecret;
    if (!secret) return null;
    try {
      const response = await axios.get(`${this.paystackBase}/bank/resolve_bvn/${bvn}`, {
        headers: { Authorization: `Bearer ${secret}` }
      });
      if (response.data.status) {
        return {
          firstName: response.data.data.first_name,
          lastName: response.data.data.last_name,
          dob: response.data.data.dob,
          mobile: response.data.data.mobile_number
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async verifyNin(nin: string): Promise<{ firstName: string; lastName: string; mobile: string } | null> {
    if (!/^\d{11}$/.test(nin)) return null;
    const secret = this.paystackSecret;
    if (!secret) return null;
    try {
      const response = await axios.get(`${this.paystackBase}/nin/verify/${nin}`, {
        headers: { Authorization: `Bearer ${secret}` }
      });
      if (response.data.status) {
        return {
          firstName: response.data.data.first_name,
          lastName: response.data.data.last_name,
          mobile: response.data.data.mobile_number
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  handlePaystackWebhook(payload: any): { reference: string; status: string; amount: number } | null {
    if (payload.event === 'charge.success' && payload.data.status === 'success') {
      return {
        reference: payload.data.reference,
        status: 'success',
        amount: payload.data.amount / 100
      };
    }
    if (payload.event === 'transfer.success') {
      return {
        reference: payload.data.reference,
        status: 'success',
        amount: payload.data.amount / 100
      };
    }
    if (payload.event === 'transfer.failed') {
      return {
        reference: payload.data.reference,
        status: 'failed',
        amount: payload.data.amount / 100
      };
    }
    return null;
  }

}

export const paymentService = new PaymentService();
