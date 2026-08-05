import { Router } from 'express';
import { oraRecordController } from './orarecord.controller';
import { apiLimiter } from '../../middleware/rateLimit.middleware';

const router = Router();

router.get('/', apiLimiter, oraRecordController.getRecord.bind(oraRecordController));

export default router;
