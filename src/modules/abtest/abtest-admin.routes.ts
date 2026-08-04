import { Router } from 'express';
import { abtestController } from './abtest.controller';

const router = Router();

// Admin experiment management (mounted under /admin with auth+admin middleware)
router.post('/abtests', abtestController.upsert);
router.patch('/abtests/toggle', abtestController.toggle);
router.get('/abtests', abtestController.list);
router.get('/abtests/:key/summary', abtestController.summary);

export default router;