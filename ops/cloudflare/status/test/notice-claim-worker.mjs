import { parentPort, workerData } from 'node:worker_threads';
import { SqlD1 } from './notice-sql-fixture.mjs';
import { NoticeDeliveryStore } from '../lib/notice-delivery-store.mjs';

const db = new SqlD1(workerData.file);
parentPort.postMessage('ready');
parentPort.once('message', async () => {
  try {
    const store = new NoticeDeliveryStore(db, () => workerData.now);
    parentPort.postMessage({lease: await store.acquire(workerData.token)});
  } catch (error) { parentPort.postMessage({error: error.message}); }
  finally { db.raw.close(); parentPort.close(); }
});
