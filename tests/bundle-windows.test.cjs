const {test}=require('node:test'),assert=require('node:assert/strict');
const {bundle,transientDownload}=require('../scripts/ci/bundle-windows.cjs');
test('installer download 504 is retried without another compilation',async()=>{
 const calls=[],waits=[];
 await bundle({run:async()=>{calls.push('bundle');return calls.length===1?{code:1,output:'Downloading NSIS\nfailed to bundle project: `http status: 504`'}:{code:0,output:'Bundled'};},sleep:async ms=>waits.push(ms),log:()=>{}});
 assert.deepEqual(calls,['bundle','bundle']);assert.deepEqual(waits,[10000]);
});
test('persistent network outage stops after four attempts with bounded backoff',async()=>{
 let calls=0;const waits=[];
 await assert.rejects(bundle({run:async()=>{calls++;return {code:1,output:'http status: 503'};},sleep:async ms=>waits.push(ms),log:()=>{}}),/bundling failed/);
 assert.equal(calls,4);assert.deepEqual(waits,[10000,20000,40000]);
});
test('installer script, missing tools, and integrity failures are not hidden by retries',async()=>{
 for(const output of ['makensis: Error in script on line 42','http status: 404','Downloading NSIS: hash mismatch','Downloading plugin: certificate verify failed']){
  let calls=0;
  await assert.rejects(bundle({run:async()=>{calls++;return {code:2,output};},sleep:async()=>assert.fail('Unexpected retry'),log:()=>{}}),error=>error.exitCode===2);
  assert.equal(calls,1);
 }
 await assert.rejects(bundle({run:async()=>{throw Error('ENOENT');},sleep:async()=>assert.fail('Unexpected retry'),log:()=>{}}),/ENOENT/);
});
test('a successful installer returns immediately and transient network diagnostics are recognized',async()=>{
 await bundle({run:async()=>({code:0,output:''}),sleep:async()=>assert.fail('Unexpected retry'),log:()=>{}});
 assert.equal(transientDownload('Downloading plugin: Connection reset (os error 10054)'),true);
 assert.equal(transientDownload('Downloading NSIS: operation timed out'),true);
 assert.equal(transientDownload('Installer script syntax error'),false);
});
