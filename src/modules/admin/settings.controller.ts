import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../../middleware/auth.middleware';
import { getOrCreateSettings, SettingsModel } from './settings.model';

export class SettingsController {
  async get(req: AuthRequest, res: Response): Promise<void> {
    try {
      const settings = await getOrCreateSettings();
      res.json({ success: true, data: { reserveAmount: settings.reserveAmount } });
    } catch (error) {
      console.error('Settings get error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch settings' });
    }
  }

  async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { reserveAmount } = req.body;
      if (reserveAmount === undefined || reserveAmount < 0) {
        res.status(400).json({ success: false, message: 'Invalid reserveAmount' });
        return;
      }
      let settings = await getOrCreateSettings();
      settings.reserveAmount = Math.floor(reserveAmount);
      settings.updatedBy = new mongoose.Types.ObjectId(req.user!.userId);
      await settings.save();
      res.json({ success: true, data: { reserveAmount: settings.reserveAmount } });
    } catch (error) {
      console.error('Settings update error:', error);
      res.status(500).json({ success: false, message: 'Failed to update settings' });
    }
  }
}

export const settingsController = new SettingsController();

