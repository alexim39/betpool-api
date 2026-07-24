import mongoose from 'mongoose';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runTransaction<T>(
  fn: (session: mongoose.ClientSession) => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (error: any) {
      await session.abortTransaction();
      if (error?.errorLabels?.includes('TransientTransactionError') && attempt < maxRetries - 1) {
        await sleep(Math.min(100 * Math.pow(2, attempt), 1000));
        lastError = error;
        continue;
      }
      throw error;
    } finally {
      session.endSession();
    }
  }
  throw lastError;
}
