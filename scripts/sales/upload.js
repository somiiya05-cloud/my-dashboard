// 사용: node upload.js <out.json> <기대합계> <날짜...>
const rows=JSON.parse(require('fs').readFileSync(process.argv[2],'utf8'));
const EXPECT=Number(process.argv[3]);
const DATES=process.argv.slice(4);
const U='https://fwsszzjfjktliredmjcn.supabase.co', K='sb_publishable_uE-8s2DbZBUSs0z1uQ-nIA_za2Ah3uT';
const H={apikey:K,Authorization:'Bearer '+K};
const EX=new Set(['미니멀룸','글로리핏','라이프스타일마트','빠이러스','그로우뮤즈','PORKE.','명퉤','명퉤(해외)','잠비에','멜루션','코드니처','카카오선물하기(개인)','카카오톡스토어(법인)','카카오선물하기(개인)_폴크','명퉤 경주 황리단길 본점','공동구매(컨텐츠팀)','CONTENTS_DEAL']);
async function pull(q){const a=[];for(let o=0;;o+=1000){const r=await fetch(U+'/rest/v1/sales_transactions?'+q+'&order=id.asc',{headers:{...H,Range:o+'-'+(o+999)}});const j=await r.json();a.push(...j);if(j.length<1000)break;}return a;}
(async()=>{
  const all=await pull('select=vendor,product_name');
  const kv=new Set(all.map(r=>r.vendor)), kp=new Set(all.map(r=>r.product_name));
  const vm={}; rows.forEach(r=>{if(!vm[r.vendor])vm[r.vendor]={n:0,amt:0};vm[r.vendor].n++;vm[r.vendor].amt+=r.amount;});
  const newV=Object.keys(vm).filter(v=>!kv.has(v));
  console.log('기존에 없던 판매처: '+(newV.length?'':'없음'));
  newV.forEach(v=>console.log('   '+(EX.has(v)?'[제외] ':'[영업] ')+v.padEnd(20)+vm[v].n+'행  '+vm[v].amt.toLocaleString()+'원'));
  const pm={}; rows.forEach(r=>{if(!pm[r.product_name])pm[r.product_name]={n:0,amt:0,b:new Set()};pm[r.product_name].n++;pm[r.product_name].amt+=r.amount;pm[r.product_name].b.add(r.brand);});
  const newP=Object.keys(pm).filter(p=>!kp.has(p));
  console.log('기존에 없던 상품명: '+newP.length+'종');
  newP.sort((a,b)=>pm[b].n-pm[a].n).forEach(p=>console.log('   '+JSON.stringify(p).padEnd(34)+pm[p].n+'행  '+pm[p].amt.toLocaleString()+'원  brand='+[...pm[p].b].join(',')));

  console.log('\n중복 확인:');
  for(const d of DATES){
    const r=await fetch(U+'/rest/v1/sales_transactions?select=id&sale_date=eq.'+d,{headers:{...H,Prefer:'count=exact',Range:'0-0'}});
    const n=(r.headers.get('content-range')||'').split('/')[1];
    console.log('   '+d+' : '+n+'행');
    if(n!=='0'){console.log('❌ 이미 데이터가 있습니다. 중단합니다.');process.exit(1);}
  }

  let done=0;
  for(let i=0;i<rows.length;i+=500){
    const c=rows.slice(i,i+500);
    const r=await fetch(U+'/rest/v1/sales_transactions',{method:'POST',headers:{...H,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(c)});
    if(!r.ok){console.log('❌ HTTP '+r.status+' '+(await r.text()).slice(0,200)+'\n적재됨: '+done);process.exit(1);}
    done+=c.length; console.log('  ✔ '+done+' / '+rows.length);
  }
  const v=await pull('select=sale_date,vendor,brand,amount&sale_date=gte.'+DATES[0]+'&sale_date=lte.'+DATES[DATES.length-1]);
  const T=v.reduce((s,r)=>s+r.amount,0);
  console.log('\nDB 검증 → '+v.length+'행 / '+T.toLocaleString()+'원 '+(T===EXPECT?'✅ 일치':'❌ 기대 '+EXPECT.toLocaleString()));
  if(DATES.length>1){
    const m={}; v.forEach(r=>{if(!m[r.sale_date])m[r.sale_date]={n:0,a:0,t:0};m[r.sale_date].n++;m[r.sale_date].a+=r.amount;if(!EX.has(r.vendor))m[r.sale_date].t+=r.amount;});
    console.log('\n일자별:');
    Object.entries(m).sort().forEach(([d,x])=>console.log('   '+d+'  '+String(x.n).padStart(5)+'행  '+x.a.toLocaleString().padStart(12)+'원  (영업팀 '+x.t.toLocaleString()+'원)'));
  }
  console.log('영업팀: '+v.filter(r=>!EX.has(r.vendor)).reduce((s,r)=>s+r.amount,0).toLocaleString()+'원');
  console.log('브랜드 빈 행: '+v.filter(r=>!r.brand||!String(r.brand).trim()).length+'행');
})();
