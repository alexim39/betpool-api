import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth.middleware';
import { FeaturedBannerModel } from '../models/featured-banner.model';
import { chatWithOra } from '../services/ai.service';

export class FeaturedBannerController {
  async getActive(req: AuthRequest, res: Response): Promise<void> {
    try {
      const now = new Date();
      const banners = await FeaturedBannerModel.find({
        isActive: true,
        $and: [
          { $or: [{ startsAt: { $exists: false } }, { startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gte: now } }] },
        ],
      }).sort({ displayOrder: 1, createdAt: -1 }).lean();

      res.json({ success: true, data: banners });
    } catch (error) {
      console.error('FeaturedBanner getActive error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch banners' });
    }
  }

  async adminList(req: AuthRequest, res: Response): Promise<void> {
    try {
      const banners = await FeaturedBannerModel.find()
        .populate('createdBy', 'phone fullName')
        .sort({ createdAt: -1 })
        .lean();
      res.json({ success: true, data: banners });
    } catch (error) {
      console.error('FeaturedBanner adminList error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch banners' });
    }
  }

  async create(req: AuthRequest, res: Response): Promise<void> {
    try {
      const {
        title, subtitle, description, ctaLabel, ctaLink,
        emoji, gradientStart, gradientEnd, isActive,
        startsAt, expiresAt, displayOrder
      } = req.body;

      if (!title || !title.trim()) {
        res.status(400).json({ success: false, message: 'Title is required' });
        return;
      }

      const banner = await FeaturedBannerModel.create({
        title: title.trim(),
        subtitle: subtitle?.trim() || '',
        description: description?.trim() || '',
        ctaLabel: ctaLabel?.trim() || 'Bet Now',
        ctaLink: ctaLink?.trim() || '/home',
        emoji: emoji || '🔥',
        gradientStart: gradientStart || '#E8B923',
        gradientEnd: gradientEnd || '#FF6B35',
        isActive: isActive !== undefined ? isActive : true,
        startsAt: startsAt || undefined,
        expiresAt: expiresAt || undefined,
        displayOrder: displayOrder || 0,
        createdBy: new mongoose.Types.ObjectId(req.user!.userId),
      });

      res.status(201).json({ success: true, data: banner });
    } catch (error) {
      console.error('FeaturedBanner create error:', error);
      res.status(500).json({ success: false, message: 'Failed to create banner' });
    }
  }

  async update(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const update: Record<string, any> = {};

      const fields = [
        'title', 'subtitle', 'description', 'ctaLabel', 'ctaLink',
        'emoji', 'gradientStart', 'gradientEnd', 'isActive',
        'startsAt', 'expiresAt', 'displayOrder'
      ];

      for (const field of fields) {
        if (req.body[field] !== undefined) {
          update[field] = req.body[field];
        }
      }

      if (update.title !== undefined && !update.title.trim()) {
        res.status(400).json({ success: false, message: 'Title cannot be empty' });
        return;
      }

      const banner = await FeaturedBannerModel.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true });
      if (!banner) {
        res.status(404).json({ success: false, message: 'Banner not found' });
        return;
      }

      res.json({ success: true, data: banner });
    } catch (error) {
      console.error('FeaturedBanner update error:', error);
      res.status(500).json({ success: false, message: 'Failed to update banner' });
    }
  }

  async remove(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const banner = await FeaturedBannerModel.findByIdAndDelete(id);
      if (!banner) {
        res.status(404).json({ success: false, message: 'Banner not found' });
        return;
      }
      res.json({ success: true, message: 'Banner deleted' });
    } catch (error) {
      console.error('FeaturedBanner delete error:', error);
      res.status(500).json({ success: false, message: 'Failed to delete banner' });
    }
  }

  async generateDescription(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { title, subtitle } = req.body;
      if (!title || !title.trim()) {
        res.status(400).json({ success: false, message: 'Title is required' });
        return;
      }

      const messages = [
        {
          role: 'user' as const,
          content: `Write a short, enticing promotional description (max 2 sentences, under 200 characters total) for a featured game banner on BetPool with the title "${title}"${subtitle ? ` and subtitle "${subtitle}"` : ''}. The description should highlight the benefit of using BetPool's pool betting feature — where users pool stakes together for better returns, and if the pod loses they get their stake refunded. Make it captivating, use emojis naturally, and create urgency. Do NOT use markdown or quotes. Return ONLY the description text.`
        }
      ];

      const result = await chatWithOra(messages, req.user?.userId);
      res.json({ success: true, data: { description: result.content } });
    } catch (error) {
      console.error('FeaturedBanner generateDescription error:', error);
      res.status(500).json({ success: false, message: 'Failed to generate description' });
    }
  }
}

export const featuredBannerController = new FeaturedBannerController();
