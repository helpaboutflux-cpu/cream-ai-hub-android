/* ============================================================
   Lemon soft · 공용 Supabase 설정 (배포용)
   ------------------------------------------------------------
   이 파일의 값은 Soft Hub 의 모든 페이지가 그대로 사용한다.
   방문자는 아무것도 입력하지 않아도 로그인·동기화·짧은 공유 링크·
   원격 공지·배너·광고가 바로 켜진다.

   anon(publishable) key 는 원래 공개되어도 되는 키다.
   실제 접근 제어는 supabase_schema.sql 의 RLS 정책이 담당한다.
   값을 바꾸려면 관리자 콘솔의 Supabase 탭에서 [설정 파일 내려받기] 로
   이 파일을 다시 만들어 덮어쓰면 된다.
   ============================================================ */
window.LEMON_CLOUD_CONFIG = {
  url: 'https://dgqagaiaykmrmmyxqtol.supabase.co',
  anonKey: 'sb_publishable_RJ0U_IQwByuK-3Sqa9j0uQ_l_7AmZEY'
};
