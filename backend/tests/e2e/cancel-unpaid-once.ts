import { cancelUnpaidOrders } from '../../src/cron/index.js';

const n = await cancelUnpaidOrders();
console.log(`UNPAID_CANCELLED=${n}`);
