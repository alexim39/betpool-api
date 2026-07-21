import mongoose from 'mongoose';

async function main() {
  await mongoose.connect('mongodb://localhost:27017/investbetz');
  
  const pods = await mongoose.connection.collection('pods').find(
    { status: 'active' },
    { projection: { title: 1, homeTeam: 1, awayTeam: 1, matchDate: 1, stakingClosesAt: 1, opensAt: 1, currentExposure: 1, maxTotalExposure: 1, isLive: 1, createdAt: 1 } }
  ).sort({ createdAt: -1 }).toArray();

  console.log('Active pods count:', pods.length);
  console.log('Now:', new Date().toISOString());
  console.log('');
  pods.forEach((p: any) => {
    const now = new Date();
    const stakingOk = p.stakingClosesAt ? new Date(p.stakingClosesAt) >= now : false;
    const exposureOk = (p.currentExposure || 0) < (p.maxTotalExposure || 0);
    
    console.log('---');
    console.log('Title:', p.title);
    console.log('  matchDate:', p.matchDate ? new Date(p.matchDate).toISOString() : 'N/A');
    console.log('  stakingClosesAt:', p.stakingClosesAt ? new Date(p.stakingClosesAt).toISOString() : 'N/A');
    console.log('  opensAt:', p.opensAt ? new Date(p.opensAt).toISOString() : 'N/A');
    console.log('  exposure:', p.currentExposure, '/', p.maxTotalExposure);
    console.log('  Would appear in feed?', stakingOk && exposureOk ? 'YES' : 'NO');
    if (!stakingOk) console.log('  >> BLOCKED by stakingClosesAt');
    if (!exposureOk) console.log('  >> BLOCKED by exposure cap');
  });

  await mongoose.disconnect();
}

main().catch(console.error);
