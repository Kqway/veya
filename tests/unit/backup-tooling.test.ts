import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {afterEach,expect,it} from 'vitest';
const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
function fixture(){const directory=mkdtempSync(join(tmpdir(),'veya-backup-test-'));directories.push(directory);return directory;}
function command(script:string,archive:string,env:Record<string,string|undefined>={}){
 try{return{code:0,output:execFileSync('bash',[resolve('scripts',script),archive],{env:{...process.env,...env},encoding:'utf8',stdio:['ignore','pipe','pipe']})};}
 catch(error){const result=error as {status:number;stdout:Buffer;stderr:Buffer};return{code:result.status,output:String(result.stdout)+String(result.stderr)};}
}
it('refuses overwriting an existing backup and leaves its contents unchanged',()=>{
 const archive=join(fixture(),'backup.dump');writeFileSync(archive,'original');
 const result=command('backup.sh',archive,{PGSERVICE:'test'});
 expect(result.code).toBe(1);expect(result.output).toContain('new absolute archive path');expect(readFileSync(archive,'utf8')).toBe('original');
});
it('omits private tool diagnostics on backup failure and leaves no published archive',()=>{
 const directory=fixture(),archive=join(directory,'backup.dump');
 writeFileSync(join(directory,'pg_dump'),'#!/bin/sh\necho "postgres://secret:password private body" >&2\nexit 1\n',{mode:0o700});
 const result=command('backup.sh',archive,{PGSERVICE:'test',PATH:`${directory}:${process.env.PATH}`});
 expect(result.code).toBe(1);expect(result.output).toContain('Backup failed');expect(result.output).not.toMatch(/secret|password|private body/);expect(existsSync(archive)).toBe(false);
});
it('requires an explicit named restore destination and does not accept connection-string arguments',()=>{
 const archive=join(fixture(),'backup.dump');writeFileSync(archive,'archive');
 const result=command('restore.sh',archive,{RESTORE_PGSERVICE:'postgres://secret:password@production/db'});
 expect(result.code).toBe(1);expect(result.output).toContain('Restore requires RESTORE_PGSERVICE');expect(result.output).not.toContain('password');
});
it('refuses a populated restore destination before invoking restore',()=>{
 const directory=fixture(),archive=join(directory,'backup.dump');writeFileSync(archive,'archive');
 writeFileSync(join(directory,'psql'),'#!/bin/sh\necho 1\n',{mode:0o700});
 const result=command('restore.sh',archive,{RESTORE_PGSERVICE:'isolated',PATH:`${directory}:${process.env.PATH}`});
 expect(result.code).toBe(1);expect(result.output).toContain('Restore refused');
});
