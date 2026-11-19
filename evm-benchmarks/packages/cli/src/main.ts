import {bench} from './bench.ts';

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'bench') {
  await bench(rest);
  process.exit(0); // workers/timers must not keep the process alive
} else if (cmd === 'report') {
  console.error('not implemented'); // Task 8
  process.exit(1);
} else {
  console.error('usage: main.ts bench|report');
  process.exit(1);
}
