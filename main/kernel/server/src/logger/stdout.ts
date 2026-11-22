// main/kernel/server/src/logger/stdout.ts

// stdout belongs to the process, so whether its reader is still there is process state.
let state: 'idle' | 'open' | 'closed' = 'idle';

// As pino's destination did, a reader that goes away (`| head`, a dead log shipper) ends the
// writes and not the process. Any other stdout error stays fatal, as it is with no listener.
function onError(err: NodeJS.ErrnoException): void {
  if (err.code !== 'EPIPE') throw err;
  state = 'closed';
}

/** Writes one log line to stdout, and nothing once its reader has gone. */
export function writeLine(line: string): void {
  if (state === 'closed') return;
  if (state === 'idle') {
    process.stdout.on('error', onError);
    state = 'open';
  }
  process.stdout.write(`${line}\n`);
}
