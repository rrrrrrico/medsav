-- Vector store for the MedSav Assistant: official VHIS passages with Qwen text-embedding-v3 vectors.
create extension if not exists vector;

create table if not exists vhis_passages (
  id          text primary key,
  lang        text not null check (lang in ('en', 'zh')),
  source      text not null,
  title       text not null,
  url         text not null,
  page        int,
  section     text,
  content     text not null,
  content_md5 text not null,
  model       text not null,
  embedding   vector(1024) not null,
  updated_at  timestamptz not null default now()
);

create index if not exists vhis_passages_embedding_hnsw
  on vhis_passages using hnsw (embedding vector_cosine_ops);

create index if not exists vhis_passages_lang on vhis_passages (lang);

-- Only the server (service role) reads or writes; the public anon key gets nothing.
alter table vhis_passages enable row level security;

create or replace function match_passages(
  query_embedding vector(1024),
  match_count int default 5,
  filter_lang text default null
)
returns table (id text, similarity float)
language sql stable
as $$
  select p.id, 1 - (p.embedding <=> query_embedding) as similarity
  from vhis_passages p
  where filter_lang is null or p.lang = filter_lang
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

revoke execute on function match_passages from public, anon, authenticated;
