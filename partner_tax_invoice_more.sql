-- 세금계산서용 거래처 정보 추가 3곳
-- Supabase 프로젝트 대시보드 > SQL Editor 에 붙여넣고 Run 하세요.
-- partner_tax_invoice.sql 을 먼저 실행하셨어야 합니다. 여러 번 돌려도 안전합니다.
--
-- 공유 폴더의 거래처 폴더 안에 있던 전자세금계산서·사업자등록증에서 읽었습니다.
--   · 코드스테이츠        ← 전자세금계산서_주식회사 더블에이스.pdf
--   · 팀크리에이티브       ← 전자세금계산서_(주) 팀크리에이티브.pdf
--   · 한국화학융합시험연구원 ← 한국화학융합시험연구원-사업자등록증.pdf

update partners p
set business_reg_no = v.business_reg_no,
    email           = coalesce(v.email, p.email),
    invoice_name    = case when v.invoice_name = p.name then null else v.invoice_name end
from (values
  ('코드스테이츠',            '주식회사 더블에이스',       '206-87-09615', 'management@rocketpunch.com'),
  ('팀크리에이티브',          '㈜ 팀크리에이티브',         '211-88-71821', 'ce.rim@timcreative.co.kr'),
  -- 사업자등록증에 전자세금계산서 전용 메일이 비어 있어 이메일은 확인이 필요합니다.
  ('한국화학융합시험연구원',   '(재)한국화학융합시험연구원', '107-82-14534', null)
) as v(partner_name, invoice_name, business_reg_no, email)
where p.name = v.partner_name
  and p.business_reg_no is null;

-- 마스터에도 같이 넣어 둡니다.
insert into tax_invoice_recipients (invoice_name, business_reg_no, email, sales_channel, memo)
select v.invoice_name, v.business_reg_no, v.email, v.sales_channel, v.memo
from (values
  ('주식회사 더블에이스',       '206-87-09615', 'management@rocketpunch.com', '코드스테이츠', null),
  ('㈜ 팀크리에이티브',         '211-88-71821', 'ce.rim@timcreative.co.kr',   null,          null),
  ('(재)한국화학융합시험연구원', '107-82-14534', null,                         null,          '사업자등록증에 전자세금계산서 전용 메일이 비어 있습니다 — 확인 필요')
) as v(invoice_name, business_reg_no, email, sales_channel, memo)
where not exists (select 1 from tax_invoice_recipients r where r.invoice_name = v.invoice_name);

-- 확인 — 사업자번호가 채워진 거래처가 13곳이 되면 성공입니다.
select count(*) filter (where business_reg_no is not null) as "채워진 거래처",
       count(*) filter (where business_reg_no is null)     as "아직 빈 거래처",
       count(*)                                            as "전체"
from partners;
