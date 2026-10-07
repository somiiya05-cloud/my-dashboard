// xlsx(압축해제 폴더) → 2차원 배열 JSON. 자체닫힘 셀(<c ... />)을 정확히 건너뛰는 게 핵심.
const fs=require('fs');
const dir=process.argv[2];
const ssPath=dir+'/xl/sharedStrings.xml';
const strings=[];
if(fs.existsSync(ssPath)){
  const ss=fs.readFileSync(ssPath,'utf8');
  for(const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)){
    let t=''; for(const tm of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t+=tm[1];
    strings.push(t.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"));
  }
}
const sh=fs.readFileSync(dir+'/xl/worksheets/'+(process.argv[3]||'sheet1.xml'),'utf8');
const colIdx=s=>{let n=0;for(const c of s)n=n*26+(c.charCodeAt(0)-64);return n-1;};
const rows=[];
for(const rm of sh.matchAll(/<row[^>]*?\sr="(\d+)"[^>]*?>([\s\S]*?)<\/row>/g)){
  const r=+rm[1], arr=[];
  for(const cm of rm[2].matchAll(/<c\s+r="([A-Z]+)\d+"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)){
    const ci=colIdx(cm[1]), attr=cm[2], self=cm[3]==='/>', inner=cm[4]||'';
    if(self){arr[ci]='';continue;}
    const tm=/t="([^"]+)"/.exec(attr), type=tm?tm[1]:'n'; let v='';
    if(type==='inlineStr'){const im=/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner); v=im?im[1]:'';}
    else{const vm=/<v>([\s\S]*?)<\/v>/.exec(inner); if(vm){v=vm[1]; if(type==='s')v=strings[+v];}}
    arr[ci]=typeof v==='string'?v.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'):v;
  }
  rows[r]=arr;
}
const out=[]; for(let i=1;i<rows.length;i++) out.push((rows[i]||[]).map(x=>x===undefined?'':x));
fs.writeFileSync(process.argv[4]||'sheet.json',JSON.stringify(out));
console.log('행수: '+out.length);
console.log('\n=== 헤더 (1-based) ===');
(out[0]||[]).forEach((h,i)=>console.log('  '+String(i+1).padStart(2)+': '+h));
console.log('\n=== 데이터 2행 ===');
for(const i of [1,2]) if(out[i]) console.log('  ',JSON.stringify(out[i]));
