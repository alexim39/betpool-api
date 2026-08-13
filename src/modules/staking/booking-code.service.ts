import crypto from 'crypto';
import { PodModel } from '../../models/pod.model';
import BookingCodeModel from '../../models/booking-code.model';

export interface BookingCodeLegView {
  podId: string;
  homeTeam: string;
  awayTeam: string;
  selection: string;
  multiplier: number;
  league?: string;
  status: string;
  available: boolean;
  stakingClosesAt: string | null;
}

export interface BookingCodeView {
  code: string;
  expiresAt: string;
  legs: BookingCodeLegView[];
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_TTL_HOURS = 48;

export function getMaxAccumulatorLegs(): number {
  return parseInt(process.env.MAX_ACCUMULATOR_LEGS || '5', 10);
}

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

const POD_SELECT_FIELDS = 'title homeTeam awayTeam league selection gainsMultiplier status stakingClosesAt currentExposure maxTotalExposure';

export class BookingCodeService {
  async create(userId: string, podIds: string[]): Promise<BookingCodeView> {
    const maxLegs = getMaxAccumulatorLegs();
    const unique = [...new Set((podIds || []).map(p => String(p)).filter(Boolean))];

    if (unique.length < 2) {
      throw new Error('Booking codes require at least 2 selections');
    }
    if (unique.length > maxLegs) {
      throw new Error(`Booking codes support up to ${maxLegs} selections`);
    }

    const pods = await PodModel.find({ _id: { $in: unique } })
      .select(POD_SELECT_FIELDS)
      .lean() as unknown as Array<{
        _id: any;
        title: string;
        homeTeam: string;
        awayTeam: string;
        league?: string;
        selection: string;
        gainsMultiplier: number;
        status: string;
        stakingClosesAt: Date;
        currentExposure?: number;
        maxTotalExposure?: number;
      }>;

    if (pods.length !== unique.length) {
      throw new Error('One or more selections no longer exist');
    }

    const now = new Date();
    const unavailable = pods.filter(p =>
      p.status !== 'active' ||
      new Date(p.stakingClosesAt) <= now ||
      (p.currentExposure || 0) >= (p.maxTotalExposure || 0)
    );
    if (unavailable.length > 0) {
      throw new Error(`One or more selections are no longer available: ${unavailable.map(p => p.title).join(', ')}`);
    }

    let code = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateCode();
      const exists = await BookingCodeModel.exists({ code: candidate });
      if (!exists) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new Error('Could not generate a unique booking code, please retry');
    }

    const expiresAt = new Date(Date.now() + CODE_TTL_HOURS * 60 * 60 * 1000);
    const booking = await BookingCodeModel.create({
      code,
      userId,
      podIds: unique,
      legs: pods.map(p => ({
        podId: String(p._id),
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        selection: p.selection,
        multiplier: p.gainsMultiplier,
        league: p.league
      })),
      expiresAt,
      usedCount: 0
    });

    return {
      code: booking.code,
      expiresAt: booking.expiresAt.toISOString(),
      legs: pods.map(p => ({
        podId: String(p._id),
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        selection: p.selection,
        multiplier: p.gainsMultiplier,
        league: p.league,
        status: p.status,
        available: true,
        stakingClosesAt: new Date(p.stakingClosesAt).toISOString()
      }))
    };
  }

  async redeem(code: string): Promise<BookingCodeView> {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^[A-Z2-9]{6,12}$/.test(normalized)) {
      throw new Error('Invalid booking code format');
    }

    const booking = await BookingCodeModel.findOne({ code: normalized });
    if (!booking) {
      throw new Error('Booking code not found');
    }
    if (new Date(booking.expiresAt) < new Date()) {
      throw new Error('Booking code has expired');
    }

    const pods = await PodModel.find({ _id: { $in: booking.podIds } })
      .select(POD_SELECT_FIELDS)
      .lean() as unknown as Array<{
        _id: any;
        title: string;
        homeTeam: string;
        awayTeam: string;
        league?: string;
        selection: string;
        gainsMultiplier: number;
        status: string;
        stakingClosesAt: Date;
        currentExposure?: number;
        maxTotalExposure?: number;
      }>;

    const byId = new Map(pods.map(p => [String(p._id), p]));
    const now = new Date();

    const legs: BookingCodeLegView[] = booking.podIds.map(podId => {
      const p = byId.get(podId);
      const snap = booking.legs.find(l => l.podId === podId);
      if (!p) {
        return {
          podId,
          homeTeam: snap?.homeTeam || '—',
          awayTeam: snap?.awayTeam || '—',
          selection: snap?.selection || '',
          multiplier: snap?.multiplier || 1,
          league: snap?.league,
          status: 'unavailable',
          available: false,
          stakingClosesAt: null
        };
      }
      return {
        podId,
        homeTeam: p.homeTeam,
        awayTeam: p.awayTeam,
        selection: p.selection,
        multiplier: p.gainsMultiplier,
        league: p.league,
        status: p.status,
        available:
          p.status === 'active' &&
          new Date(p.stakingClosesAt) > now &&
          (p.currentExposure || 0) < (p.maxTotalExposure || 0),
        stakingClosesAt: new Date(p.stakingClosesAt).toISOString()
      };
    });

    await BookingCodeModel.updateOne({ _id: booking._id }, { $inc: { usedCount: 1 } });

    return {
      code: booking.code,
      expiresAt: booking.expiresAt.toISOString(),
      legs
    };
  }
}

export const bookingCodeService = new BookingCodeService();