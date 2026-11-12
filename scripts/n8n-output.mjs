import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// n8n can emit runner logs both before and after --rawOutput JSON.
export function parseN8nOutput(output) {
  const start=output.search(/^\{\r?$/m);
  if(start<0)throw new Error("No formatted n8n execution JSON");
  let depth=0,quoted=false,escaped=false;
  for(let i=start;i<output.length;i++) {
    const c=output[i];
    if(quoted) {
      if(escaped)escaped=false;
      else if(c==='\\')escaped=true;
      else if(c==='"')quoted=false;
    } else if(c==='"')quoted=true;
    else if(c==='{')depth++;
    else if(c==='}'&&--depth===0) {
      const value=JSON.parse(output.slice(start,i+1));
      if(!value.data?.resultData)throw new Error("Missing n8n execution resultData");
      return value;
    }
  }
  throw new Error("Truncated n8n execution JSON");
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const expected={data:{resultData:{text:'braces } { and escaped " quote \\ end'}}};
  for(const newline of ['\n','\r\n'])assert.deepEqual(parseN8nOutput('Startup log\n'+JSON.stringify(expected,null,2).replaceAll('\n',newline)+'\nRegistered runner "JS Task Runner"\n'),expected);
  assert.throws(()=>parseN8nOutput('no JSON'));
  assert.throws(()=>parseN8nOutput('{\n"data": {'));
  assert.throws(()=>parseN8nOutput('{\n"other":true\n}'));
  console.log('PASS n8n execution JSON framing self-check');
}
