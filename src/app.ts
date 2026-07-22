import express from 'express';
import bodyParser from 'body-parser';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import routes from './routes';
import { errorHandler } from './middleware/error.middleware';

dotenv.config({ path: './.env' });

class App {
  public app: express.Application;

  constructor() {
    this.app = express();
    this.config();
    this.routes();
    this.mongoSetup();
  }

  private config(): void {
    this.app.set('trust proxy', 1);
    const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4200,http://localhost:4201,http://localhost:4300,https://betpool.tech,http://betpool.tech,https://www.betpool.tech').split(',');
    this.app.use(cors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true
    }));
    this.app.use((req, res, next) => {
      if (req.method === 'OPTIONS') return next();
      if (process.env.NODE_ENV === 'production' && !req.secure && req.get('X-Forwarded-Proto') !== 'https') {
        return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
      }
      next();
    });
    this.app.use(helmet());
    this.app.use(bodyParser.urlencoded({ extended: false }));
    this.app.use(bodyParser.json({ limit: '10kb' }));
  }

  private routes(): void {
    this.app.use('/api', routes);
    this.app.use(errorHandler);
  }

  private mongoSetup(): void {
    const mongoUri = (() => {
      if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');
      return process.env.MONGODB_URI;
    })();

    mongoose.connect(mongoUri, {
      maxPoolSize: parseInt(process.env.MONGO_POOL_SIZE || '10'),
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    })
      .then(() => console.log('MongoDB connected'))
      .catch((error) => console.error('MongoDB connection error:', error));
  }
}

export default new App().app;
