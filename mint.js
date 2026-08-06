const jwt = require('jsonwebtoken');
const fs = require('fs');
const secret = fs.readFileSync('.env','utf8').match(/^JWT_SECRET=(.+)$/m)[1].trim();
const token = jwt.sign({ userId: '6a636f7e56d229889e187565', role: 'admin' }, secret, { expiresIn: '5m' });
console.log(token);
