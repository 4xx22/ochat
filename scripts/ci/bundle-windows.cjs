// Compile separately; only transient installer-download failures may retry.
const path=require('node:path'),{spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
function transientDownload(output){
 if(/hash (?:mismatch|verification failed)|certificate|checksum/i.test(output))return false;
 return /http status:\s*(?:408|429|500|502|503|504)\b/i.test(output)
  || /download[\s\S]*(?:connection reset|connection timed out|operation timed out|timed out|dns error|temporary failure in name resolution|os error 10054)/i.test(output);
}
function runBundle(){
 return new Promise((resolve,reject)=>{
  const cli=path.resolve(__dirname,'../../node_modules/@tauri-apps/cli/tauri.js');
  const child=spawn(process.execPath,[cli,'bundle','--bundles','nsis','--ci'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';
  for(const [stream,destination] of [[child.stdout,process.stdout],[child.stderr,process.stderr]])stream.on('data',chunk=>{destination.write(chunk);output=(output+chunk.toString()).slice(-65536);});
  child.once('error',reject);
  child.once('close',code=>resolve({code:code??1,output}));
 });
}
async function bundle({run=runBundle,sleep=delay,log=console.log}={}){
 for(let attempt=1;attempt<=4;attempt++){
  log(`Windows installer bundling: attempt ${attempt}/4`);
  const result=await run();
  if(result.code===0)return;
  if(attempt===4||!transientDownload(result.output)){
   const error=Error('Windows installer bundling failed; see the bundler output above.');
   error.exitCode=result.code||1;throw error;
  }
  const milliseconds=10000*2**(attempt-1);
  log(`::warning::Temporary installer download failure. Retrying bundling in ${milliseconds/1000}s without recompiling.`);
  await sleep(milliseconds);
 }
}
module.exports={bundle,transientDownload};
if(require.main===module)bundle().catch(error=>{console.error(error.message);process.exitCode=error.exitCode||1;});
