// Node worker_threads adapter for the same Web Worker entry used by browsers.
import {parentPort} from 'node:worker_threads';
globalThis.self={postMessage:message=>parentPort.postMessage(message)};
await import('../assets/analysis-worker.js');
parentPort.on('message',data=>self.onmessage({data}));
