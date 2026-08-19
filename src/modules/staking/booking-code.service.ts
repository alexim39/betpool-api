import crypto from 'crypto';
import { PodModel } from '../../models/pod.model';
import BookingCodeModel, { IBookingCode } from '../../models/booking-code.model';
import { UserModel } from '../../models/user.model';

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
  codeId: string;
  expiresAt: string;
  legs: BookingCodeLegView[];
  combinedMultiplier: number;
  legCount: number;
  creator?: { id: string; name: string } | null;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_TTL_HOURS = 48;

export function getMaxAccumulatorLegs(): number {
  return parseInt(process.env.MAX_ACCUMULATOR_LEGS || '5', 10);
}

/** Booking codes (shareable creator cards) allow far more legs than regular parlays. */
export function getMaxBookingCodeLegs(): number {
  return parseInt(process.env.MAX_BOOKING_CODE_LEGS || '30', 10);
}

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

const POD_SELECT_FIELDS = 'title homeTeam awayTeam league selection gainsMultiplier status stakingClosesAt matchDate currentExposure maxTotalExposure';

interface PodForCode {
  _id: any;
  title: string;
  homeTeam: string;
  awayTeam: string;
  league?: string;
  selection: string;
  gainsMultiplier: number;
  status: string;
  stakingClosesAt: Date;
  matchDate?: Date;
  currentExposure?: number;
  maxTotalExposure?: number;
}

export class BookingCodeService {
  async create(userId: string, podIds: string[]): Promise<BookingCodeView> {
    const maxLegs = getMaxBookingCodeLegs();
    const unique = [...new Set((podIds || []).map(p => String(p)).filter(Boolean))];

    if (unique.length < 2) {
      throw new Error('Booking codes require at least 2 selections');
    }
    if (unique.length > maxLegs) {
      throw new Error(`Booking codes support up to ${maxLegs} selections`);
    }

    const pods = await PodModel.find({ _id: { $in: unique } })
      .select(POD_SELECT_FIELDS)
      .lean() as unknown as PodForCode[];

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

    const matchKeys = new Set<string>();
    const duplicateMatches = pods.filter(p => {
      const key = `${p.homeTeam}|${p.awayTeam}|${p.matchDate || ''}`;
      if (matchKeys.has(key)) return true;
      matchKeys.add(key);
      return false;
    });
    if (duplicateMatches.length > 0) {
      throw new Error(`Cannot combine multiple selections from the same match: ${duplicateMatches.map(p => p.title).join(', ')}`);
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

    return this.toView(booking, pods);
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
      .lean() as unknown as PodForCode[];

    await BookingCodeModel.updateOne({ _id: booking._id }, { $inc: { usedCount: 1 } });

    return this.toView(booking, pods);
  }

  /** Read-only view used by the social feed — does not increment usage. */
  async view(code: string): Promise<BookingCodeView | null> {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^[A-Z2-9]{6,12}$/.test(normalized)) return null;
    const booking = await BookingCodeModel.findOne({ code: normalized });
    if (!booking) return null;
    const pods = await PodModel.find({ _id: { $in: booking.podIds } })
      .select(POD_SELECT_FIELDS)
      .lean() as unknown as PodForCode[];
    return this.toView(booking, pods);
  }

  async getCreatorByCode(code: string): Promise<string | null> {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) return null;
    const booking = await BookingCodeModel.findOne({ code: normalized }).select('userId').lean();
    return booking ? String(booking.userId) : null;
  }

  private async toView(booking: IBookingCode, pods: PodForCode[]): Promise<BookingCodeView> {
    const byId = new Map(pods.map(p => [String(p._id), p]));
    const now = new Date();

    const seenMatches = new Set<string>();
    const legs: BookingCodeLegView[] = [];
    for (const podId of booking.podIds) {
      const p = byId.get(podId);
      const snap = booking.legs.find(l => l.podId === podId);
      let leg: BookingCodeLegView;
      if (!p) {
        leg = {
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
      } else {
        leg = {
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
            (!p.matchDate || new Date(p.matchDate) > now) &&
            (p.currentExposure || 0) < (p.maxTotalExposure || 0),
          stakingClosesAt: new Date(p.stakingClosesAt).toISOString()
        };
      }

      const matchKey = `${leg.homeTeam}|${leg.awayTeam}|${p ? p.matchDate || '' : ''}`;
      if (seenMatches.has(matchKey)) continue;
      seenMatches.add(matchKey);
      legs.push(leg);
    }

    let creator: { id: string; name: string } | null = null;
    try {
      const user = await UserModel.findById(booking.userId).select('fullName').lean();
      if (user) creator = { id: String(user._id), name: (user as any).fullName || 'BetPool user' };
    } catch {
      creator = null;
    }

    return {
      code: booking.code,
      codeId: String(booking._id),
      expiresAt: booking.expiresAt.toISOString(),
      legs,
      combinedMultiplier: legs.reduce((acc, l) => acc * l.multiplier, 1),
      legCount: legs.length,
      creator
    };
  }
}

export const bookingCodeService = new BookingCodeService();
