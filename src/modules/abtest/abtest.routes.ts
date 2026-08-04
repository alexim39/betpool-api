import { Router } from 'express';
import { abtestController } from './abtest.controller';

const router = Router();

// User-facing: which variant am I in?
router.get('/assignment', abtestController.assignment);

export default router;