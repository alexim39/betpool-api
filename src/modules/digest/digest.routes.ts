import { Router } from 'express';
import { digestController } from './digest.controller';

const router = Router();

router.get('/unsubscribe/:userId/:token', digestController.unsubscribe);

export default router;