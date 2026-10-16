-- Applied after the Supabase security advisor run (2026-10-17).
revoke execute on function public.news_articles_audit(), public.news_articles_broadcast_edit(), public.news_articles_validate_edit()
  from public, anon, authenticated;
revoke execute on function public.news_admin_sources(), public.news_admin_stats(), public.news_add_admin_by_email(text, text),
  public.news_claim_first_owner(), public.news_is_owner()
  from public, anon;
grant execute on function public.news_admin_sources(), public.news_admin_stats(), public.news_add_admin_by_email(text, text),
  public.news_claim_first_owner(), public.news_is_owner() to authenticated;
