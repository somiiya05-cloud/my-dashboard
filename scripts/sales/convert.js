// 매출DB(Layout A) → sales_transactions CSV. 사용: node convert.js <sheet.json> <out.csv> <out.json>
const fs=require('fs');
const R=JSON.parse(fs.readFileSync(process.argv[2],'utf8')).slice(1);
const CSV=process.argv[3], OUT=process.argv[4];

const SKU2BRAND=[['BYOR','빠이러스'],['COLI','코드니처'],['GLLI','글로리핏'],['GRSO','그로우뮤즈'],['GRET','그로우뮤즈'],
  ['LIET','라이프스타일마트'],['MICO','미니멀룸'],['MILI','미니멀룸'],['MIPI','미니멀룸'],['MITO','미니멀룸'],
  ['MYHO','명퉤'],['ZACO','잠비에'],['ZATO','잠비에'],['POLG','PORKE'],['POET','PORKE'],
  // COTO: 스킬 표는 미니멀룸(신뢰도 낮음)이라고 하지만, DB 실제 값은 코드니처 114행 vs 미니멀룸 2행.
  // "통세탁 사계절 방수토퍼" 는 코드니처가 맞다 (2026-10-01 확인).
  ['COTO','코드니처']];
const BRAND_CANON={'라스마':'라이프스타일마트','폴크':'PORKE','글로리':'글로리핏','글':'글로리핏','Porke':'PORKE','porke':'PORKE'};
// DB 에 실재하는 브랜드. 여기에 없는 값이 브랜드 칸에 들어오면 오타로 보고 SKU 로 복구한다.
const KNOWN_BRANDS=new Set(['코드니처','명퉤','라이프스타일마트','미니멀룸','빠이러스','잠비에','그로우뮤즈','글로리핏','PORKE','멜루션','바디피크']);
const VENDOR_FIX={'CONTENTS_DEAL':'공동구매(컨텐츠팀)','원룸만들기':'원룸만들기(개인)','카카오톡스토어':'카카오톡스토어(법인)'};
// 같은 제품인데 원본에서 짧은 이름으로 들어오는 것들 (DB 표기로 통일)
const PRODUCT_ALIAS={
  '고정밴드 4P':'미니멀룸 고정밴드 4p',
  // MITO002 계열. 띄어쓰기만 다른 같은 제품 (2026-10-06 사용자 확인).
  // 주의: MITO003 "자가발열 양면토퍼 NEW" 는 다른 제품이므로 합치지 말 것.
  '자가발열토퍼':'자가발열 토퍼',
};
const EX=new Set(['미니멀룸','글로리핏','라이프스타일마트','빠이러스','그로우뮤즈','PORKE.','명퉤','명퉤(해외)','잠비에','멜루션','코드니처','카카오선물하기(개인)','카카오톡스토어(법인)','카카오선물하기(개인)_폴크','명퉤 경주 황리단길 본점','공동구매(컨텐츠팀)','CONTENTS_DEAL']);
const norm=s=>String(s??'').trim().replace(/\bporke\b/gi,'PORKE');
const serial=n=>new Date(Date.UTC(1899,11,30)+n*86400000).toISOString().slice(0,10);

console.log('=== 파일의 brand 값 ===');
const bs={}; R.forEach(r=>{const b=String(r[12]||'').trim(); bs[b]=(bs[b]||0)+1;});
Object.entries(bs).sort((x,y)=>y[1]-x[1]).forEach(([k,v])=>
  console.log('   '+(k||'(빈값)').padEnd(16)+String(v).padStart(5)+'행'+(BRAND_CANON[k]?'  → '+BRAND_CANON[k]:'')));

const out=[], iss={mismatch:{},serial:0,canon:{},vfix:{},nobrand:[],baddate:[],badnum:[],recovered:{},unknown:{},alias:{}};
for(let i=0;i<R.length;i++){
  const r=R[i], ln=i+2;
  let vendor=norm(r[0]); if(!vendor||vendor==='합계') continue;
  if(VENDOR_FIX[vendor]){const k=vendor+' → '+VENDOR_FIX[vendor];iss.vfix[k]=(iss.vfix[k]||0)+1;vendor=VENDOR_FIX[vendor];}
  const sku=norm(r[3]);
  let raw=norm(r[4]), bracket=null, name=raw;
  const m=/^\[([^\]]+)\]\s*(.*)$/.exec(raw); if(m){bracket=norm(m[1]);name=norm(m[2]);}
  if(PRODUCT_ALIAS[name]){const k=name+' → '+PRODUCT_ALIAS[name];iss.alias[k]=(iss.alias[k]||0)+1;name=PRODUCT_ALIAS[name];}
  let brand=norm(r[12]);
  if(/^GRET002/i.test(sku)) brand='그로우뮤즈';
  else if(brand&&bracket&&brand!==bracket&&!BRAND_CANON[brand]){const k=brand+' ↔ ['+bracket+']';iss.mismatch[k]=(iss.mismatch[k]||0)+1;}
  if(!brand) brand=bracket||'';
  if(!brand){const p=SKU2BRAND.find(([k])=>sku.toUpperCase().startsWith(k)); if(p)brand=p[1];}
  if(BRAND_CANON[brand]){const k=brand+' → '+BRAND_CANON[brand];iss.canon[k]=(iss.canon[k]||0)+1;brand=BRAND_CANON[brand];}
  // 알 수 없는 브랜드 값이면 SKU 접두어로 복구
  if(brand&&!KNOWN_BRANDS.has(brand)){
    const p=SKU2BRAND.find(([k])=>sku.toUpperCase().startsWith(k));
    if(p){const k='"'+brand+'" → '+p[1]+' (SKU '+sku+')';iss.recovered[k]=(iss.recovered[k]||0)+1;brand=p[1];}
    else {const k='"'+brand+'" (SKU '+sku+', 복구 실패)';iss.unknown[k]=(iss.unknown[k]||0)+1;}
  }
  if(!brand) iss.nobrand.push(ln+':'+sku);
  let date=norm(r[11]);
  if(/^\d+(\.\d+)?$/.test(date)){date=serial(Number(date));iss.serial++;}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) iss.baddate.push('행'+ln+" '"+r[11]+"'");
  const qty=Number(String(r[9]).replace(/,/g,'')), amt=Number(String(r[10]).replace(/,/g,''));
  if(!Number.isFinite(qty)||!Number.isFinite(amt)||String(r[9]).trim()===''||String(r[10]).trim()==='') iss.badnum.push('행'+ln);
  out.push({vendor,brand,product_name:name,sale_date:date,quantity:qty,amount:amt});
}
const q=s=>/[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
fs.writeFileSync(CSV,'﻿'+'vendor,brand,product_name,sale_date,quantity,amount\n'+
  out.map(o=>[q(o.vendor),q(o.brand),q(o.product_name),o.sale_date,o.quantity,o.amount].join(',')).join('\n')+'\n','utf8');
fs.writeFileSync(OUT,JSON.stringify(out));

console.log('\n변환 행수  : '+out.length);
console.log('판매가 합계: '+out.reduce((s,o)=>s+o.amount,0).toLocaleString()+'원');
console.log('수량 합계  : '+out.reduce((s,o)=>s+o.quantity,0).toLocaleString());
console.log('일련번호 날짜 변환: '+iss.serial+'행');
const dd={}; out.forEach(o=>dd[o.sale_date]=(dd[o.sale_date]||0)+1);
console.log('날짜 분포  : '+JSON.stringify(dd));
const team=out.filter(o=>!EX.has(o.vendor));
console.log('영업팀 매출: '+team.reduce((s,o)=>s+o.amount,0).toLocaleString()+'원 ('+team.length+'행)');
console.log('판매가 0원 행: '+out.filter(o=>o.amount===0).length);
const show=(t,o)=>{const e=Object.entries(o); if(e.length){console.log('\n'+t);e.forEach(([k,v])=>console.log('   '+k+' : '+v+'건'));}};
show('브랜드 표기 보정:',iss.canon);
show('⚠ 알 수 없는 브랜드 값 → SKU로 복구:',iss.recovered);
show('❌ 브랜드 복구 실패 (그대로 들어감):',iss.unknown);
show('판매처명 보정:',iss.vfix);
 show('상품명 별칭 통일:',iss.alias);
show('⚠ 브랜드 ↔ 대괄호 불일치:',iss.mismatch);
['nobrand','baddate','badnum'].forEach(k=>{if(iss[k].length)console.log('\n⚠ '+k+': '+iss[k].length+'건 — '+iss[k].slice(0,5).join(', '));});
