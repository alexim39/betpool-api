import mongoose from 'mongoose';

async function main() {
  await mongoose.connect('mongodb://localhost:27017/investbetz');
  
  const now = new Date();
  
  // Fix pods with status 'active' or 'published' that have past or missing stakingClosesAt
  const pods = await mongoose.connection.collection('pods').find({
    status: { $in: ['active', 'published'] },
    $or: [
      { stakingClosesAt: { $lt: now } },
      { stakingClosesAt: null },
      { stakingClosesAt: { $exists: false } }
    ]
  }).toArray();

  console.log(`Found ${pods.length} pods with past/missing stakingClosesAt:`);

  let updated = 0;
  for (const pod of pods) {
    let newClose: Date;
    const matchDate = pod.matchDate ? new Date(pod.matchDate) : null;

    if (matchDate && matchDate > now) {
      newClose = matchDate;
    } else {
      newClose = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    await mongoose.connection.collection('pods').updateOne(
      { _id: pod._id },
      { $set: { stakingClosesAt: newClose } }
    );

    console.log(`  ${pod.title || pod.homeTeam + ' vs ' + pod.awayTeam}: stakingClosesAt → ${newClose.toISOString()}`);
    updated++;
  }

  console.log(`\nUpdated ${updated} pods. Restart the API server to clear the cache.`);
  await mongoose.disconnect();
}

main().catch(console.error);
