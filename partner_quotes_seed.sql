-- 기존에 발행했던 견적서를 히스토리로 넣습니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 partner_quotes.sql 을 먼저 Run 한 뒤 실행하세요.
--
-- 다운로드 폴더에 있던 아래 4건을 옮겨 담았습니다.
--   · 셀디랩_까르멘 견적서_260713.pdf
--   · 셀디랩_스트롱제습서버 견적서_260804.pdf   (헤이딜러)
--   · 셀디랩_트리플렛츠_영세율_견적서_260806.pdf
--   · SELDI_LAB_Taiwan_Crowdfunding_Quotation_100pct_Prepaid.xlsx (De-ming)
--
-- 견적번호(quote_no)로 중복을 막으므로 여러 번 실행해도 같은 건이 두 번 들어가지 않습니다.
-- 나머지 과거 견적서는 화면의 "엑셀로 히스토리 넣기"로 한 번에 올리시면 됩니다.

-- 1) 거래처가 없으면 만들어 둡니다.
insert into partners (name, type)
select v.name, 'B2B 거래처'
from (values ('까르멘기프트'), ('헤이딜러'), ('트리플렛츠'), ('De-ming Business Development')) as v(name)
where not exists (select 1 from partners p where p.name = v.name);

-- 2) 견적서 머리글
insert into partner_quotes
  (quote_no, quote_date, partner_id, partner_name, category, subject, tax_type,
   total_amount, supply_amount, tax_amount, note, issuer_name, issuer_phone, status, source)
select v.quote_no, v.quote_date::date, p.id, v.partner_name, v.category, v.subject, v.tax_type,
       v.total_amount,
       case when v.tax_type = '영세율' then v.total_amount else round(v.total_amount / 1.1) end,
       case when v.tax_type = '영세율' then 0 else v.total_amount - round(v.total_amount / 1.1) end,
       v.note, v.issuer_name, v.issuer_phone, '발행', '히스토리'
from (values
  ('Q-260713-01', '2026-07-13', '까르멘기프트',                 'B2B 직납', '제습서버',  '과세',   484500::numeric, null,                                                          '윤효선', '010-4434-6844'),
  ('Q-260804-01', '2026-08-04', '헤이딜러',                     'B2B 직납', '오행염주',  '과세',   4000000::numeric, null,                                                         '윤효선', '010-4434-6844'),
  ('Q-260806-01', '2026-08-06', '트리플렛츠',                   'B2B 직납', '코드니처',  '영세율', 6552800::numeric, '영세율 적용 (공급가액 6,552,800원 / 부가가치세 0원)',           null,    null),
  ('Q-260818-01', '2026-08-18', 'De-ming Business Development', '수출',     'Taiwan / Zeczec Crowdfunding Review', '영세율', 10200000::numeric,
     'FCA 국내 지정창고 인도 · 펀딩 종료 후 최종 발주 확정 시 100% 선입금 · 국제운송비/통관비/관세 미포함',                                                                        null,    null)
) as v(quote_no, quote_date, partner_name, category, subject, tax_type, total_amount, note, issuer_name, issuer_phone)
left join partners p on p.name = v.partner_name
where not exists (select 1 from partner_quotes q where q.quote_no = v.quote_no);

-- 3) 품목 줄
insert into partner_quote_items (quote_id, line_no, product_name, product_key, qty, spec, unit_price, amount)
select q.id, v.line_no, v.product_name,
       lower(regexp_replace(v.product_name, '[^0-9A-Za-z가-힣]', '', 'g')),
       v.qty, v.spec, v.unit_price, v.qty * v.unit_price
from (values
  ('Q-260713-01', 1, '스트롱 제습 서버',                  51::numeric,  null,          9500::numeric),
  ('Q-260804-01', 1, '스트롱제습서버',                    500::numeric, null,          8000::numeric),
  ('Q-260806-01', 1, '스트롱 에어컨 탈취 제습 서버(10p)', 72::numeric,  '46*28*28',    8500::numeric),
  ('Q-260806-01', 2, '변기 수조 세정 서버',               63::numeric,  '40*30.5*28',  9000::numeric),
  ('Q-260806-01', 3, '벽지 보호코팅 프로 미스트',         42::numeric,  '44*37*20',    7000::numeric),
  ('Q-260806-01', 4, '딥클렌징 벽지 얼룩제거제',          42::numeric,  '44*37*25',    9500::numeric),
  ('Q-260806-01', 5, '기름 앤 색소 의류 리무버',          20::numeric,  '43*43*15',    4900::numeric),
  ('Q-260806-01', 6, '코스메틱 제거 클리너',              12::numeric,  '42*42*18',    7900::numeric),
  ('Q-260806-01', 7, '세제 톡 버블 클리너',               28::numeric,  '60*40*40',    6500::numeric),
  ('Q-260806-01', 8, '베개 2중 압축 세탁망',              125::numeric, '45*55*40',    9000::numeric),
  ('Q-260806-01', 9, '패딩 세탁망 롱패딩',                125::numeric, '45*55*40',    9000::numeric),
  ('Q-260806-01', 10, '패딩 세탁망 숏패딩',               150::numeric, '45*55*40',    9000::numeric),
  ('Q-260806-01', 11, '하수구 악취 세정 서버',            24::numeric,  '38*23*24',    9000::numeric),
  ('Q-260806-01', 12, '캡모자 복구 클리너',               100::numeric, '43*42*18',    4900::numeric),
  ('Q-260818-01', 1, '스트롱제습서버',                    1000::numeric, 'Reusable Dehumidifier', 7800::numeric),
  ('Q-260818-01', 2, '스트롱제습서버 대형 파우치백',      500::numeric,  'Large Pouch Bag',       4800::numeric)
) as v(quote_no, line_no, product_name, qty, spec, unit_price)
join partner_quotes q on q.quote_no = v.quote_no
where not exists (select 1 from partner_quote_items i where i.quote_id = q.id and i.line_no = v.line_no);

-- 확인 — 견적서 4건과 품목 16줄이 보이면 성공입니다.
select q.quote_no as "견적번호", q.quote_date as "견적일", q.partner_name as "거래처",
       q.tax_type as "과세구분", q.total_amount as "합계금액", count(i.id) as "품목 수"
from partner_quotes q left join partner_quote_items i on i.quote_id = q.id
group by q.id, q.quote_no, q.quote_date, q.partner_name, q.tax_type, q.total_amount
order by q.quote_date;
