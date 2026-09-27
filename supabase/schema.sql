create extension if not exists pgcrypto;

create table if not exists competitions(
 id uuid primary key default gen_random_uuid(), name text not null, join_code text unique not null,
 rules_version text not null default 'SDC 2026 Rev. 10.4', judge_count int not null default 3 check(judge_count in(2,3)),
 status text not null default 'setup', current_phase text not null default 'setup', active_driver_id uuid,
 active_battle_id uuid, active_run int not null default 1 check(active_run in(1,2)), created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists members(
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references competitions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, display_name text not null,
 role text not null check(role in('director','judge','display')), judge_number int check(judge_number is null or judge_number in(1,2,3)),
 created_at timestamptz not null default now(), unique(competition_id,user_id), unique(competition_id,judge_number)
);
create table if not exists drivers(
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references competitions(id) on delete cascade,
 registration_position int not null, name text not null, car_number text, created_at timestamptz not null default now(), unique(competition_id,registration_position)
);
create table if not exists qualifying_runs(
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references competitions(id) on delete cascade,
 driver_id uuid not null references drivers(id) on delete cascade, run_number int not null check(run_number in(1,2)),
 line_score numeric(5,2) not null default 0, angle_score numeric(5,2) not null default 0, style_score numeric(5,2) not null default 0,
 style_bonus numeric(5,2) not null default 0, deductions numeric(5,2) not null default 0, status text not null default 'scored',
 created_at timestamptz not null default now(), unique(driver_id,run_number)
);
create table if not exists battles(
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references competitions(id) on delete cascade,
 round_name text not null, battle_number int not null, driver_a_id uuid not null references drivers(id), driver_b_id uuid not null references drivers(id),
 current_run int not null default 1 check(current_run in(1,2)), lead_driver_id uuid references drivers(id), status text not null default 'pending', omt_count int not null default 0, created_at timestamptz not null default now()
);
create table if not exists judge_decisions(
 id uuid primary key default gen_random_uuid(), battle_id uuid not null references battles(id) on delete cascade,
 judge_member_id uuid not null references members(id) on delete cascade, run_number int not null check(run_number in(1,2)),
 decision text not null check(decision in('A','B','OMT')), idempotency_key uuid not null unique, submitted_at timestamptz not null default now(),
 unique(battle_id,judge_member_id,run_number)
);
create table if not exists judge_calls(
 id uuid primary key default gen_random_uuid(), battle_id uuid not null references battles(id) on delete cascade,
 judge_member_id uuid not null references members(id) on delete cascade, run_number int not null check(run_number in(1,2)),
 call_type text not null, subject_driver_id uuid references drivers(id), notes text, idempotency_key uuid not null unique, created_at timestamptz not null default now()
);
create table if not exists official_rulings(
 id uuid primary key default gen_random_uuid(), battle_id uuid not null references battles(id) on delete cascade,
 run_number int not null, ruling_type text not null, winning_driver_id uuid references drivers(id), reason text,
 decided_by uuid not null references members(id), created_at timestamptz not null default now()
);
create table if not exists audit_log(
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references competitions(id) on delete cascade,
 actor_user_id uuid references auth.users(id), actor_member_id uuid references members(id), action text not null,
 entity_type text, entity_id uuid, payload jsonb, created_at timestamptz not null default now()
);
create table if not exists presence(
 competition_id uuid not null references competitions(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 last_seen timestamptz not null default now(), online boolean not null default true, primary key(competition_id,user_id)
);
create or replace function public.is_competition_member(cid uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from members where competition_id=cid and user_id=auth.uid()); $$;
create or replace function public.is_director(cid uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from members where competition_id=cid and user_id=auth.uid() and role='director'); $$;
create or replace function public.my_member_id(cid uuid) returns uuid language sql stable security definer set search_path=public as $$ select id from members where competition_id=cid and user_id=auth.uid() limit 1; $$;

alter table competitions enable row level security; alter table members enable row level security; alter table drivers enable row level security;
alter table qualifying_runs enable row level security; alter table battles enable row level security; alter table judge_decisions enable row level security;
alter table judge_calls enable row level security; alter table official_rulings enable row level security; alter table audit_log enable row level security; alter table presence enable row level security;

create policy competitions_select on competitions for select to authenticated using (created_by=auth.uid() or public.is_competition_member(id));
create policy competitions_insert on competitions for insert to authenticated with check (created_by=auth.uid());
create policy competitions_update on competitions for update to authenticated using (public.is_director(id)) with check (public.is_director(id));
create policy members_select on members for select to authenticated using (public.is_competition_member(competition_id));
create policy members_insert on members for insert to authenticated with check (user_id=auth.uid() and (public.is_director(competition_id) or not exists(select 1 from members m where m.competition_id=competition_id)));
create policy members_update_director on members for update to authenticated using (public.is_director(competition_id)) with check (public.is_director(competition_id));
create policy drivers_select on drivers for select to authenticated using (public.is_competition_member(competition_id));
create policy drivers_insert on drivers for insert to authenticated with check (public.is_director(competition_id));
create policy drivers_update on drivers for update to authenticated using (public.is_director(competition_id)) with check (public.is_director(competition_id));
create policy drivers_delete on drivers for delete to authenticated using (public.is_director(competition_id));
create policy qualifying_select on qualifying_runs for select to authenticated using (public.is_competition_member(competition_id));
create policy qualifying_insert on qualifying_runs for insert to authenticated with check (public.is_competition_member(competition_id));
create policy qualifying_update on qualifying_runs for update to authenticated using (public.is_competition_member(competition_id));
create policy battles_select on battles for select to authenticated using (public.is_competition_member(competition_id));
create policy battles_insert on battles for insert to authenticated with check (public.is_director(competition_id));
create policy battles_update on battles for update to authenticated using (public.is_director(competition_id)) with check (public.is_director(competition_id));
create policy decisions_select on judge_decisions for select to authenticated using (exists(select 1 from battles b where b.id=battle_id and public.is_competition_member(b.competition_id)));
create policy decisions_insert on judge_decisions for insert to authenticated with check (judge_member_id=public.my_member_id((select competition_id from battles where id=battle_id)) and exists(select 1 from members m where m.id=judge_member_id and m.user_id=auth.uid() and m.role='judge'));
create policy decisions_update on judge_decisions for update to authenticated using (judge_member_id=public.my_member_id((select competition_id from battles where id=battle_id))) with check (judge_member_id=public.my_member_id((select competition_id from battles where id=battle_id)));
create policy calls_select on judge_calls for select to authenticated using (exists(select 1 from battles b where b.id=battle_id and public.is_competition_member(b.competition_id)));
create policy calls_insert on judge_calls for insert to authenticated with check (judge_member_id=public.my_member_id((select competition_id from battles where id=battle_id)) and exists(select 1 from members m where m.id=judge_member_id and m.user_id=auth.uid() and m.role='judge'));
create policy rulings_select on official_rulings for select to authenticated using (exists(select 1 from battles b where b.id=battle_id and public.is_competition_member(b.competition_id)));
create policy rulings_insert on official_rulings for insert to authenticated with check (decided_by=public.my_member_id((select competition_id from battles where id=battle_id)) and public.is_director((select competition_id from battles where id=battle_id)));
create policy audit_select on audit_log for select to authenticated using (public.is_competition_member(competition_id));
create policy audit_insert on audit_log for insert to authenticated with check (actor_user_id=auth.uid() and public.is_competition_member(competition_id));
create policy presence_select on presence for select to authenticated using (public.is_competition_member(competition_id));
create policy presence_upsert on presence for insert to authenticated with check (user_id=auth.uid() and public.is_competition_member(competition_id));
create policy presence_update on presence for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
revoke all on all tables in schema public from anon;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant execute on function public.is_competition_member(uuid) to authenticated;
grant execute on function public.is_director(uuid) to authenticated;
grant execute on function public.my_member_id(uuid) to authenticated;
