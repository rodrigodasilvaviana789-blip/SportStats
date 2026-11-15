-- =====================================================================
-- SportStats - tabelas do Supabase
-- ---------------------------------------------------------------------
-- COMO USAR: no painel do Supabase, abra "SQL Editor", clique em
-- "New query", cole TODO este arquivo e clique em "Run".
-- Pode rodar de novo sem problema: ele não apaga nada.
-- =====================================================================

-- Partidas (cada linha guarda uma partida completa em "valor")
create table if not exists public.partidas (
    chave     text primary key,
    valor     jsonb       not null,
    criado_em timestamptz not null default now()
);

-- Contas dos usuários (a senha fica guardada só como hash, nunca em texto)
create table if not exists public.contas (
    chave     text primary key,          -- o e-mail
    valor     jsonb       not null,
    criado_em timestamptz not null default now()
);

-- Sessões de login (guardamos só o hash do token)
create table if not exists public.sessoes (
    chave     text primary key,
    valor     jsonb       not null,
    criado_em timestamptz not null default now()
);

-- Imagens (escudos dos times e fotos de perfil), em base64
create table if not exists public.imagens (
    chave     text primary key,          -- "<hash>.png", "<hash>.jpg"...
    tipo      text        not null,
    dados     text        not null,
    criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- SEGURANÇA
-- Ativa o RLS e NÃO cria nenhuma política: assim, quem tiver só a chave
-- pública (publishable / anon) não consegue ler nem gravar nada.
-- Somente o nosso servidor, com a chave SECRETA, acessa estes dados.
-- ---------------------------------------------------------------------
alter table public.partidas enable row level security;
alter table public.contas   enable row level security;
alter table public.sessoes  enable row level security;
alter table public.imagens  enable row level security;

revoke all on table public.partidas, public.contas, public.sessoes, public.imagens from anon, authenticated;
grant  all on table public.partidas, public.contas, public.sessoes, public.imagens to service_role;
