// INERT TEST FIXTURE for Stack3. If anything ever requires or runs this, the canary file appears.
require('fs').writeFileSync(process.env.STACK3_CANARY, 'ran index.js');
