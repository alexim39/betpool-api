import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import 'dotenv/config';

const MONGODB_URI = (() => { if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required'); return process.env.MONGODB_URI; })();

const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true, trim: true },
  fullName: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, lowercase: true, trim: true, maxlength: 255, sparse: true },
  pinHash: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  phoneVerified: { type: Boolean, default: false },
  kycVerified: { type: Boolean, default: false },
  kycData: { bvn: String, nin: String, dob: String, address: String },
  referralCode: { type: String, uppercase: true, length: 6 },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isActive: { type: Boolean, default: true },
  isSuspended: { type: Boolean, default: false },
  lastLoginAt: Date,
}, { timestamps: true });

const walletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance: { type: Number, default: 0 },
  bonusBalance: { type: Number, default: 0 },
  lockedBalance: { type: Number, default: 0 },
  totalDeposits: { type: Number, default: 0 },
  totalWithdrawals: { type: Number, default: 0 },
}, { timestamps: true });

const UserModel = mongoose.model('User', userSchema);
const WalletModel = mongoose.model('Wallet', walletSchema);

function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

async function createAdmin() {
  const email = 'admin@betpool.tech';
  const phone = '+2349062537816';
  const fullName = 'Alex Admin';
  const pin = '2042';

  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  const existing = await UserModel.findOne({ $or: [{ email }, { phone }] });
  if (existing) {
    console.log(`User already exists (${existing.role}). Updating role to admin and pin...`);
    existing.role = 'admin';
    existing.pinHash = await bcrypt.hash(pin, 10);
    await existing.save();
    console.log(`User ${existing.email || existing.phone} is now admin with PIN ${pin}.`);
    await mongoose.disconnect();
    return;
  }

  const pinHash = await bcrypt.hash(pin, 10);
  const referralCode = generateReferralCode();

  const user = await UserModel.create({
    phone,
    fullName,
    email,
    pinHash,
    referralCode,
    role: 'admin',
    phoneVerified: true,
    isActive: true,
    isSuspended: false,
  });

  await WalletModel.create({
    userId: user._id,
    balance: 0,
    bonusBalance: 0,
    lockedBalance: 0,
  });

  console.log(`Admin created successfully:`);
  console.log(`  Email:   ${email}`);
  console.log(`  Phone:   ${phone}`);
  console.log(`  Name:    ${fullName}`);
  console.log(`  PIN:     ${pin}`);
  console.log(`  Role:    admin`);
  console.log(`  Referral: ${referralCode}`);
  console.log(`  Wallet:  created with 0 balance`);

  await mongoose.disconnect();
  console.log('Done.');
}

createAdmin().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
