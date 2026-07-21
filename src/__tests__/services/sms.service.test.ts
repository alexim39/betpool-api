import axios from 'axios';
import { sendSms, sendBulkSms } from '../../services/sms.service';

jest.mock('axios');
const mockAxios = axios as jest.Mocked<typeof axios>;

describe('SmsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('formatPhone (internal)', () => {
    it('should format 10-digit Nigerian mobile number starting with 70', async () => {
      mockAxios.post.mockResolvedValue({ data: { status: 'success' } });
      await sendSms('7012345678', 'test');
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('sms'),
        expect.objectContaining({ to: '2347012345678' }),
        expect.any(Object)
      );
    });

    it('should format 10-digit Nigerian mobile number starting with 80', async () => {
      mockAxios.post.mockResolvedValue({ data: { status: 'success' } });
      await sendSms('8012345678', 'test');
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('sms'),
        expect.objectContaining({ to: '2348012345678' }),
        expect.any(Object)
      );
    });

    it('should keep 234-prefixed numbers as-is', async () => {
      mockAxios.post.mockResolvedValue({ data: { status: 'success' } });
      await sendSms('2347012345678', 'test');
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('sms'),
        expect.objectContaining({ to: '2347012345678' }),
        expect.any(Object)
      );
    });

    it('should strip + from international format', async () => {
      mockAxios.post.mockResolvedValue({ data: { status: 'success' } });
      await sendSms('+2347012345678', 'test');
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('sms'),
        expect.objectContaining({ to: '2347012345678' }),
        expect.any(Object)
      );
    });

    it('should strip non-numeric characters from phone', async () => {
      mockAxios.post.mockResolvedValue({ data: { status: 'success' } });
      await sendSms(' 070-1234-5678 ', 'test');
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('sms'),
        expect.objectContaining({ to: '07012345678' }),
        expect.any(Object)
      );
    });
  });

  describe('sendSms', () => {
    it('should throw if no valid recipients', async () => {
      await expect(sendSms('', 'test')).rejects.toThrow('No valid recipient phone number.');
    });

    it('should succeed with strategy 1 (v2 api_token in body)', async () => {
      mockAxios.post.mockResolvedValue({ data: { status: 'success' } });

      const result = await sendSms('2347012345678', 'Hello', {
        apiToken: 'test-token',
        from: 'testpool'
      });

      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxios.post).toHaveBeenCalledWith(
        'https://www.bulksmsnigeria.com/api/v2/sms',
        expect.objectContaining({
          body: 'Hello',
          to: '2347012345678',
          api_token: 'test-token',
          from: 'testpool'
        }),
        expect.objectContaining({
          headers: expect.objectContaining({ 'Accept': 'application/json' })
        })
      );
      expect(result).toEqual({ status: 'success' });
    });

    it('should fallback to strategy 2 when strategy 1 fails', async () => {
      mockAxios.post
        .mockRejectedValueOnce(new Error('Strategy 1 failed'))
        .mockResolvedValueOnce({ data: { status: 'success' } });

      const result = await sendSms('2347012345678', 'Hello');

      expect(mockAxios.post).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ status: 'success' });
    });

    it('should fallback to strategy 3 (v1 GET) when strategies 1 and 2 fail', async () => {
      mockAxios.post
        .mockRejectedValueOnce(new Error('Strategy 1 failed'))
        .mockRejectedValueOnce(new Error('Strategy 2 failed'));
      mockAxios.get.mockResolvedValue({ data: { status: 'success' } });

      const result = await sendSms('2347012345678', 'Hello');

      expect(mockAxios.post).toHaveBeenCalledTimes(2);
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/sms/create'),
        expect.objectContaining({
          params: expect.objectContaining({
            to: '2347012345678',
            body: 'Hello'
          })
        })
      );
      expect(result).toEqual({ status: 'success' });
    });

    it('should throw when all strategies fail', async () => {
      mockAxios.post.mockRejectedValue(new Error('Failed'));
      mockAxios.get.mockRejectedValue(new Error('Failed'));

      await expect(sendSms('2347012345678', 'Hello')).rejects.toThrow(
        'Failed to send SMS'
      );
    });
  });

  describe('sendBulkSms', () => {
    it('should send to multiple string recipients', async () => {
      mockAxios.post.mockResolvedValue({ data: { status: 'success' } });

      const result = await sendBulkSms(
        ['2347012345678', '2348098765432'],
        'Bulk message'
      );

      expect(result).toEqual({ status: 'success' });
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('sms'),
        expect.objectContaining({
          to: '2347012345678,2348098765432'
        }),
        expect.any(Object)
      );
    });

    it('should send to object recipients with phone property', async () => {
      mockAxios.post.mockResolvedValue({ data: { status: 'success' } });

      await sendBulkSms(
        [{ phone: '7012345678' }, { phone: '8023456789' }],
        'Bulk message'
      );

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('sms'),
        expect.objectContaining({
          to: '2347012345678,2348023456789'
        }),
        expect.any(Object)
      );
    });

    it('should throw if no valid recipients provided', async () => {
      await expect(sendBulkSms([], 'test')).rejects.toThrow(
        'No valid recipient phone numbers provided.'
      );
    });

    it('should filter out invalid recipients', async () => {
      mockAxios.post.mockResolvedValue({ data: { status: 'success' } });

      await sendBulkSms(['2347012345678', ''], 'test');

      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('sms'),
        expect.objectContaining({ to: '2347012345678' }),
        expect.any(Object)
      );
    });
  });
});
