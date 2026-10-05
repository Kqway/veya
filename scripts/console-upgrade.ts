import { loadMigrations } from '@/lib/db/migrations';
import { buildConsoleUpgrade } from '@/lib/db/console-upgrade';

try {
 if(process.argv.length>3 || (process.argv[2] && process.argv[2]!=='--verify')) throw new Error('Invalid option');
 const bundle=buildConsoleUpgrade(await loadMigrations());
 process.stdout.write(process.argv[2]==='--verify'?bundle.verify:bundle.upgrade);
} catch {
 console.error('Cannot generate release SQL. Use the verified20-migration source and optional --verify.');
 process.exitCode=1;
}
