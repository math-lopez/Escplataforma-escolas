-- Extensão para geração de UUID (gen_random_uuid já vem via pgcrypto no Supabase, mas garantimos aqui)
create extension if not exists pgcrypto;

-- A função public.instituicao_atual(), usada pelas policies de RLS, é criada na migration
-- 0003_usuarios_papeis.sql porque depende da tabela public.usuarios já existir.
-- Fica no schema public (não em auth) porque o SQL editor do Supabase não tem permissão
-- de CREATE no schema auth, que pertence ao supabase_auth_admin.
