import { execFileSync } from 'node:child_process';
import { cp,mkdir,readFile,writeFile } from 'node:fs/promises';
execFileSync(process.execPath,['node_modules/typescript/bin/tsc'],{stdio:'inherit'});
await mkdir('dist/client',{recursive:true});
await cp('client/public','dist/client',{recursive:true});
await cp('client/style.css','dist/client/style.css');
await writeFile('dist/client/index.html',(await readFile('client/index.html','utf8')).replace('/app.ts','/app.js'));
console.log('Built gateway and browser client.');
