import request from 'supertest';
import app from '../../app';

jest.mock('../../models/otp.model');
jest.mock('../../models/user.model');
jest.mock('../../models/wallet.model');
jest.mock('../../models/transaction.model');
jest.mock('../../models/stake.model');
jest.mock('../../models/pod.model');
jest.mock('../../services/sms.service');
jest.mock('bcryptjs');
jest.mock('mongoose', () => {
  const actualMongoose = jest.requireActual('mongoose');
  const mock = Object.create(Object.getPrototypeOf(actualMongoose));
  return Object.assign(mock, actualMongoose, {
    connect: jest.fn().mockResolvedValue(undefined)
  });
});

const MockUserModel = require('../../models/user.model').UserModel;
const MockOtpModel = require('../../models/otp.model').OtpModel;
const MockPodModel = require('../../models/pod.model').PodModel;

describe('API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/health', () => {
    it('should return 200 with API info', async () => {
      const res = await request(app).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('BetPool API');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('dbStatus');
    });
  });

  describe('POST /api/auth/signup/request', () => {
    it('should return 400 if phone is missing', async () => {
      const res = await request(app)
        .post('/api/auth/signup/request')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/signup/complete', () => {
    it('should return 400 if fields missing', async () => {
      const res = await request(app)
        .post('/api/auth/signup/complete')
        .send({ phone: '08031234567' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 if PIN not 6 digits', async () => {
      const res = await request(app)
        .post('/api/auth/signup/complete')
        .send({ phone: '08031234567', fullName: 'Test', pin: '123' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/login/verify', () => {
    it('should return 400 if fields missing', async () => {
      const res = await request(app)
        .post('/api/auth/login/verify')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Protected routes', () => {
    it('should return 401 for GET /api/auth/profile without token', async () => {
      const res = await request(app).get('/api/auth/profile');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('No token provided');
    });

    it('should return 401 for GET /api/wallet/balance without token', async () => {
      const res = await request(app).get('/api/wallet/balance');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 for invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/pods/feed', () => {
    it('should return 500 when pod service errors', async () => {
      MockPodModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockRejectedValue(new Error('DB error'))
          })
        })
      });

      const res = await request(app).get('/api/pods/feed');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });
});
