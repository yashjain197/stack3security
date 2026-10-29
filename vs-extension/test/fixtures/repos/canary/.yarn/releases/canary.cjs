// INERT TEST FIXTURE: yarn would run this for any yarn command.
require('fs').writeFileSync(process.env.STACK3_CANARY, 'ran yarnPath');
