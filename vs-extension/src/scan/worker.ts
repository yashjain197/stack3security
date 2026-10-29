import { parentPort } from 'node:worker_threads';
import { scanJob, type ScanJob } from './scanJob';

parentPort?.once('message', (job: ScanJob) => {
  scanJob(job).then(
    (result) => parentPort?.postMessage({ ok: true, result }),
    () => parentPort?.postMessage({ ok: false }),
  );
});
