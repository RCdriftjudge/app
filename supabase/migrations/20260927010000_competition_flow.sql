-- Competition flow: brings the repo in line with what the app needs and moves every write behind
-- security-definer RPCs so the rules (seats, blind judging, bracket progression) live in one place.
--
-- Safe to run on a database that already has some of these objects: columns use IF NOT EXISTS and the
-- RPCs that were previously created by hand in the dashboard are dropped and recreated.

-- ---------------------------------------------------------------------------------------------------
-- Columns and tables
-- ---------------------------------------------------------------------------------------------------

alter table competitions add column if not exists driver_registration_code text;
alter table competitions add column if not exists state_version bigint not null default 0;
alter table competitions add column if not exists bracket_size int;
alter table competitions add column if not exists champion_driver_id uuid references drivers(id);
create unique index if not exists competitions_driver_registration_code_key on competitions(driver_registration_code);
alter table competitions drop constraint if exists competitions_current_phase_check;
alter table competitions add constraint competitions_current_phase_check check (current_phase in ('setup','qualifying','tandem','finished'));

-- Director recovery PIN lives outside competitions so members can never select it.
create table if not exists competition_secrets(
 competition_id uuid primary key references competitions(id) on delete cascade, director_pin text not null
);
alter table competition_secrets enable row level security;

alter table members add column if not exists rejoin_code text;
alter table members add column if not exists active boolean not null default true;
create unique index if not exists members_rejoin_code_key on members(competition_id, rejoin_code);

alter table drivers add column if not exists team_name text;
alter table drivers add column if not exists status text not null default 'pending';
alter table drivers add column if not exists rejoin_code text;
alter table drivers add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table drivers add column if not exists seed int;
alter table drivers drop constraint if exists drivers_status_check;
alter table drivers add constraint drivers_status_check check (status in ('pending','approved','rejected'));
create unique index if not exists drivers_rejoin_code_key on drivers(competition_id, rejoin_code);
create unique index if not exists drivers_car_number_key on drivers(competition_id, car_number);

-- One row per judge per qualifying run. (qualifying_runs held a single combined score and is unused.)
create table if not exists qualifying_scores(
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references competitions(id) on delete cascade,
 driver_id uuid not null references drivers(id) on delete cascade, run_number int not null check(run_number in(1,2)),
 judge_member_id uuid not null references members(id) on delete cascade,
 line_score numeric(4,1) not null, angle_score numeric(4,1) not null, style_score numeric(4,1) not null,
 total numeric(5,1) generated always as (line_score+angle_score+style_score) stored,
 idempotency_key uuid not null unique, submitted_at timestamptz not null default now(),
 unique(driver_id,run_number,judge_member_id)
);
alter table qualifying_scores enable row level security;

alter table battles add column if not exists round int;
alter table battles add column if not exists slot int;
alter table battles add column if not exists winner_driver_id uuid references drivers(id);
alter table battles add column if not exists decided_by text;
alter table battles drop constraint if exists battles_status_check;
alter table battles add constraint battles_status_check check (status in ('pending','active','decided'));
create unique index if not exists battles_round_slot_key on battles(competition_id, round, slot);

-- Judges decide a battle after both runs; an OMT starts a new attempt (battles.omt_count).
alter table judge_decisions add column if not exists attempt int not null default 0;
alter table judge_decisions drop constraint if exists judge_decisions_battle_id_judge_member_id_run_number_key;
create unique index if not exists judge_decisions_attempt_key on judge_decisions(battle_id, judge_member_id, attempt);
alter table judge_calls add column if not exists attempt int not null default 0;

alter table audit_log add column if not exists idempotency_key uuid;
create unique index if not exists audit_log_idempotency_key on audit_log(idempotency_key);

create table if not exists rejoin_attempts(
 id bigint generated always as identity primary key, competition_id uuid not null references competitions(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table rejoin_attempts enable row level security;

-- ---------------------------------------------------------------------------------------------------
-- Row level security: reads only. All writes go through the RPCs below.
-- ---------------------------------------------------------------------------------------------------

create or replace function public.is_competition_member(cid uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from members where competition_id=cid and user_id=auth.uid() and active); $$;
create or replace function public.is_director(cid uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from members where competition_id=cid and user_id=auth.uid() and role='director' and active); $$;
create or replace function public.my_member_id(cid uuid) returns uuid language sql stable security definer set search_path=public as $$ select id from members where competition_id=cid and user_id=auth.uid() and active limit 1; $$;
create or replace function public.is_competition_driver(cid uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from drivers where competition_id=cid and user_id=auth.uid()); $$;
grant execute on function public.is_competition_driver(uuid) to authenticated;

drop policy if exists competitions_select on competitions;
create policy competitions_select on competitions for select to authenticated using (created_by=auth.uid() or public.is_competition_member(id) or public.is_competition_driver(id));
drop policy if exists competitions_insert on competitions;
drop policy if exists competitions_update on competitions;
-- The old insert policy compared members.competition_id to itself, which let any device that was not yet
-- in a competition add itself to any competition (as director) and blocked directors from creating a second one.
drop policy if exists members_insert on members;
drop policy if exists members_update_director on members;
drop policy if exists drivers_select on drivers;
create policy drivers_select on drivers for select to authenticated using (public.is_competition_member(competition_id) or user_id=auth.uid());
drop policy if exists drivers_insert on drivers;
drop policy if exists drivers_update on drivers;
drop policy if exists drivers_delete on drivers;
drop policy if exists battles_insert on battles;
drop policy if exists battles_update on battles;
-- Blind judging: a judge can only read their own decisions and calls; the director reads all.
drop policy if exists decisions_select on judge_decisions;
create policy decisions_select on judge_decisions for select to authenticated using (exists(select 1 from members m where m.id=judge_member_id and m.user_id=auth.uid()) or exists(select 1 from battles b where b.id=battle_id and public.is_director(b.competition_id)));
drop policy if exists decisions_insert on judge_decisions;
drop policy if exists decisions_update on judge_decisions;
drop policy if exists calls_select on judge_calls;
create policy calls_select on judge_calls for select to authenticated using (exists(select 1 from members m where m.id=judge_member_id and m.user_id=auth.uid()) or exists(select 1 from battles b where b.id=battle_id and public.is_director(b.competition_id)));
drop policy if exists calls_insert on judge_calls;
drop policy if exists rulings_insert on official_rulings;
drop policy if exists audit_insert on audit_log;
drop policy if exists qualifying_scores_select on qualifying_scores;
create policy qualifying_scores_select on qualifying_scores for select to authenticated using (exists(select 1 from members m where m.id=judge_member_id and m.user_id=auth.uid()) or public.is_director(competition_id));
grant select on qualifying_scores to authenticated;
revoke all on competition_secrets, rejoin_attempts from authenticated, anon;

-- Clients listen to their competition row and refetch state when state_version changes.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='competitions') then
  alter publication supabase_realtime add table competitions;
 end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------

-- No 0/O/1/I so codes survive being read aloud or off a screen.
create or replace function public.gen_code(len int) returns text language sql volatile as $$
 select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1+floor(random()*32)::int, 1), '') from generate_series(1,len);
$$;

create or replace function public.gen_rejoin_code(cid uuid) returns text language plpgsql volatile set search_path=public as $$
declare c text;
begin
 for i in 1..200 loop
  c:=gen_code(2);
  if not exists(select 1 from members where competition_id=cid and rejoin_code=c) and not exists(select 1 from drivers where competition_id=cid and rejoin_code=c) then return c; end if;
 end loop;
 raise exception 'No rejoin codes left for this competition';
end $$;

create or replace function public.touch(cid uuid, p_action text, p_payload jsonb default '{}') returns void language plpgsql security definer set search_path=public as $$
begin
 update competitions set state_version=state_version+1 where id=cid;
 insert into audit_log(competition_id,actor_user_id,actor_member_id,action,payload) values(cid,auth.uid(),my_member_id(cid),p_action,p_payload);
end $$;

create or replace function public.require_user() returns uuid language plpgsql stable as $$
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if;
 return auth.uid();
end $$;

create or replace function public.require_director(cid uuid) returns void language plpgsql stable security definer set search_path=public as $$
begin
 if not is_director(cid) then raise exception 'Only the director can do that'; end if;
end $$;

-- Returns the caller's active judge seat in the competition or raises.
create or replace function public.require_judge(cid uuid) returns members language plpgsql stable security definer set search_path=public as $$
declare m members;
begin
 select * into m from members where competition_id=cid and user_id=auth.uid() and role='judge' and active;
 if m.id is null then raise exception 'You are not a judge in this competition'; end if;
 return m;
end $$;

-- Qualifying: judges score line/angle/style; a run counts once every seated judge has scored it.
-- Run score = average judge total. Ranking = best run, then other run, then registration order.
create or replace function public.qualifying_leaderboard(cid uuid) returns table(driver_id uuid, run1 numeric, run2 numeric, best numeric, rank int)
language sql stable security definer set search_path=public as $$
 with seats as (select judge_count from competitions where id=cid),
 runs as (
  select q.driver_id, q.run_number, round(avg(q.total),2) as score
  from qualifying_scores q join members m on m.id=q.judge_member_id and m.active
  where q.competition_id=cid group by q.driver_id, q.run_number
  having count(*)>=(select judge_count from seats)
 ),
 per as (
  select d.id, d.registration_position,
   (select score from runs r where r.driver_id=d.id and r.run_number=1) as run1,
   (select score from runs r where r.driver_id=d.id and r.run_number=2) as run2
  from drivers d where d.competition_id=cid and d.status='approved'
 )
 select id, run1, run2, greatest(run1,run2) as best,
  (row_number() over (order by greatest(run1,run2) desc nulls last, least(run1,run2) desc nulls last, registration_position))::int
 from per where coalesce(run1,run2) is not null;
$$;

create or replace function public.round_name(drivers_in_round int) returns text language sql immutable as $$
 select case drivers_in_round when 2 then 'Final' when 4 then 'Semi Final' else 'Top '||drivers_in_round end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Session RPCs
-- ---------------------------------------------------------------------------------------------------

drop function if exists public.join_competition_by_code(text,text,text);
drop function if exists public.register_driver(text,text,text);
drop function if exists public.rejoin_driver(text);
drop function if exists public.rejoin_judge(text);

create or replace function public.create_competition(p_name text, p_director_name text, p_judge_count int) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); c competitions; m members; pin text:=gen_code(6);
begin
 if p_judge_count not in (2,3) then raise exception 'Judge count must be 2 or 3'; end if;
 for i in 1..20 loop
  begin
   insert into competitions(name,join_code,driver_registration_code,judge_count,created_by)
   values(coalesce(nullif(trim(p_name),''),'RC Drift Competition'),gen_code(6),gen_code(6),p_judge_count,uid) returning * into c;
   exit;
  exception when unique_violation then null;
  end;
 end loop;
 if c.id is null then raise exception 'Could not allocate competition codes, try again'; end if;
 insert into members(competition_id,user_id,display_name,role) values(c.id,uid,coalesce(nullif(trim(p_director_name),''),'Director'),'director') returning * into m;
 insert into competition_secrets values(c.id,pin);
 perform touch(c.id,'competition_created',jsonb_build_object('judge_count',p_judge_count));
 return jsonb_build_object('competition_id',c.id,'member_id',m.id,'role','director');
end $$;

-- Name of the competition behind a judge or driver code, for the landing screen after scanning a QR.
create or replace function public.invite_info(p_code text) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(
  (select jsonb_build_object('kind','judge','competition_name',name) from competitions where join_code=upper(trim(p_code))),
  (select jsonb_build_object('kind','driver','competition_name',name,'registration_open',current_phase='setup') from competitions where driver_registration_code=upper(trim(p_code))));
$$;

create or replace function public.join_competition_by_code(p_code text, p_display_name text, p_role text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); c competitions; m members; seat int;
begin
 if p_role not in ('judge','display') then raise exception 'Role must be judge or display'; end if;
 select * into c from competitions where join_code=upper(trim(p_code)) for update;
 if c.id is null then raise exception 'Competition code not found'; end if;
 select * into m from members where competition_id=c.id and user_id=uid;
 if m.id is not null then
  if not m.active then raise exception 'The director removed you from this competition'; end if;
  return jsonb_build_object('competition_id',c.id,'member_id',m.id,'role',m.role,'judge_number',m.judge_number,'rejoin_code',m.rejoin_code);
 end if;
 if p_role='judge' then
  select min(n) into seat from generate_series(1,c.judge_count) n where not exists(select 1 from members where competition_id=c.id and judge_number=n and active);
  if seat is null then raise exception 'All % judge seats are taken', c.judge_count; end if;
 end if;
 insert into members(competition_id,user_id,display_name,role,judge_number,rejoin_code)
 values(c.id,uid,coalesce(nullif(trim(p_display_name),''),initcap(p_role)),p_role,seat,gen_rejoin_code(c.id)) returning * into m;
 perform touch(c.id,'member_joined',jsonb_build_object('role',p_role,'judge_number',seat));
 return jsonb_build_object('competition_id',c.id,'member_id',m.id,'role',m.role,'judge_number',m.judge_number,'rejoin_code',m.rejoin_code);
end $$;

create or replace function public.register_driver(p_registration_code text, p_name text, p_team_name text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); c competitions; d drivers; pos int;
begin
 if nullif(trim(p_name),'') is null then raise exception 'Please enter your driver name'; end if;
 select * into c from competitions where driver_registration_code=upper(trim(p_registration_code)) for update;
 if c.id is null then raise exception 'Registration code not found'; end if;
 if c.current_phase<>'setup' then raise exception 'Registration for % is closed', c.name; end if;
 select coalesce(max(registration_position),0)+1 into pos from drivers where competition_id=c.id;
 insert into drivers(competition_id,registration_position,name,team_name,car_number,status,rejoin_code,user_id)
 values(c.id,pos,trim(p_name),nullif(trim(p_team_name),''),pos::text,'pending',gen_rejoin_code(c.id),uid) returning * into d;
 perform touch(c.id,'driver_registered',jsonb_build_object('driver_id',d.id));
 return jsonb_build_object('competition_id',c.id,'competition_name',c.name,'driver_id',d.id,'car_number',d.car_number,'rejoin_code',d.rejoin_code,'role','competitor');
end $$;

-- One rejoin path for everyone: event code (judge or driver code) plus a 2-character rejoin code, or the
-- director's 6-character PIN. Failed attempts are rate limited per competition and come back as {error}.
create or replace function public.rejoin(p_event_code text, p_rejoin_code text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); c competitions; m members; d drivers; code text:=upper(trim(p_rejoin_code)); existing members;
begin
 select * into c from competitions where join_code=upper(trim(p_event_code)) or driver_registration_code=upper(trim(p_event_code));
 if c.id is null then raise exception 'Competition code not found'; end if;
 if (select count(*) from rejoin_attempts where competition_id=c.id and created_at>now()-interval '10 minutes')>=20 then
  raise exception 'Too many wrong codes. Wait a few minutes and try again';
 end if;
 select * into existing from members where competition_id=c.id and user_id=uid;
 select * into m from members where competition_id=c.id and active and (
  (role<>'director' and rejoin_code=code) or (role='director' and exists(select 1 from competition_secrets s where s.competition_id=c.id and s.director_pin=code)));
 if m.id is not null then
  if existing.id is not null and existing.id<>m.id then
   if existing.role='display' then delete from members where id=existing.id;
   else raise exception 'This device is already in the competition as %', existing.role; end if;
  end if;
  update members set user_id=uid where id=m.id;
  perform touch(c.id,'member_rejoined',jsonb_build_object('member_id',m.id));
  return jsonb_build_object('competition_id',c.id,'member_id',m.id,'role',m.role,'judge_number',m.judge_number,'rejoin_code',m.rejoin_code);
 end if;
 select * into d from drivers where competition_id=c.id and rejoin_code=code;
 if d.id is not null then
  update drivers set user_id=uid where id=d.id;
  perform touch(c.id,'driver_rejoined',jsonb_build_object('driver_id',d.id));
  return jsonb_build_object('competition_id',c.id,'competition_name',c.name,'driver_id',d.id,'car_number',d.car_number,'rejoin_code',d.rejoin_code,'role','competitor');
 end if;
 -- Returned rather than raised: raising would roll back the attempt record that drives the rate limit.
 insert into rejoin_attempts(competition_id) values(c.id);
 return jsonb_build_object('error','Rejoin code not found');
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Director RPCs
-- ---------------------------------------------------------------------------------------------------

create or replace function public.add_driver(p_competition_id uuid, p_name text, p_team_name text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare d drivers; pos int;
begin
 perform require_director(p_competition_id);
 if nullif(trim(p_name),'') is null then raise exception 'Driver name is required'; end if;
 if (select current_phase from competitions where id=p_competition_id for update)<>'setup' then raise exception 'Drivers can only be added before qualifying'; end if;
 select coalesce(max(registration_position),0)+1 into pos from drivers where competition_id=p_competition_id;
 insert into drivers(competition_id,registration_position,name,team_name,car_number,status,rejoin_code)
 values(p_competition_id,pos,trim(p_name),nullif(trim(p_team_name),''),pos::text,'approved',gen_rejoin_code(p_competition_id)) returning * into d;
 perform touch(p_competition_id,'driver_added',jsonb_build_object('driver_id',d.id));
 return jsonb_build_object('driver_id',d.id,'car_number',d.car_number,'rejoin_code',d.rejoin_code);
end $$;

create or replace function public.set_driver_status(p_driver_id uuid, p_status text) returns void
language plpgsql security definer set search_path=public as $$
declare d drivers;
begin
 select * into d from drivers where id=p_driver_id;
 if d.id is null then raise exception 'Driver not found'; end if;
 perform require_director(d.competition_id);
 if p_status not in ('pending','approved','rejected') then raise exception 'Invalid status'; end if;
 if (select current_phase from competitions where id=d.competition_id)<>'setup' then raise exception 'The driver list is locked once qualifying starts'; end if;
 update drivers set status=p_status where id=p_driver_id;
 perform touch(d.competition_id,'driver_status',jsonb_build_object('driver_id',p_driver_id,'status',p_status));
end $$;

create or replace function public.remove_member(p_member_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare m members;
begin
 select * into m from members where id=p_member_id;
 if m.id is null then raise exception 'Member not found'; end if;
 perform require_director(m.competition_id);
 if m.role='director' then raise exception 'The director cannot be removed'; end if;
 update members set active=false, judge_number=null where id=p_member_id;
 -- Undecided votes from a removed judge no longer count.
 delete from judge_decisions jd using battles b where jd.battle_id=b.id and b.status<>'decided' and jd.judge_member_id=p_member_id;
 perform touch(m.competition_id,'member_removed',jsonb_build_object('member_id',p_member_id,'role',m.role));
end $$;

create or replace function public.start_qualifying(p_competition_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare c competitions; judges int; approved int; first_driver uuid;
begin
 perform require_director(p_competition_id);
 select * into c from competitions where id=p_competition_id for update;
 if c.current_phase<>'setup' then raise exception 'Qualifying has already started'; end if;
 select count(*) into judges from members where competition_id=c.id and role='judge' and active;
 if judges<c.judge_count then raise exception 'Waiting for judges: %/% joined', judges, c.judge_count; end if;
 select count(*) into approved from drivers where competition_id=c.id and status='approved';
 if approved<2 then raise exception 'Approve at least 2 drivers first (% approved)', approved; end if;
 select id into first_driver from drivers where competition_id=c.id and status='approved' order by registration_position limit 1;
 update competitions set current_phase='qualifying', status='live', active_driver_id=first_driver, active_run=1 where id=c.id;
 perform touch(c.id,'phase_changed',jsonb_build_object('phase','qualifying'));
end $$;

create or replace function public.set_qualifying_run(p_competition_id uuid, p_driver_id uuid, p_run int) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform require_director(p_competition_id);
 if p_run not in (1,2) then raise exception 'Run must be 1 or 2'; end if;
 if not exists(select 1 from drivers where id=p_driver_id and competition_id=p_competition_id and status='approved') then raise exception 'Driver is not in this competition'; end if;
 update competitions set active_driver_id=p_driver_id, active_run=p_run where id=p_competition_id and current_phase='qualifying';
 if not found then raise exception 'Qualifying is not running'; end if;
 perform touch(p_competition_id,'qualifying_run',jsonb_build_object('driver_id',p_driver_id,'run',p_run));
end $$;

-- Seeds the top p_size qualifiers into a standard bracket (1 v N, 2 v N-1 ... arranged so 1 and 2 meet in the final).
create or replace function public.build_bracket(p_competition_id uuid, p_size int) returns void
language plpgsql security definer set search_path=public as $$
declare c competitions; ranked int; ord int[]:=array[1]; nxt int[]; s int; n int; i int; a uuid; b uuid; first_battle uuid;
begin
 perform require_director(p_competition_id);
 select * into c from competitions where id=p_competition_id for update;
 if c.current_phase<>'qualifying' then raise exception 'Build the bracket at the end of qualifying'; end if;
 if p_size not in (2,4,8,16,32) then raise exception 'Bracket size must be 2, 4, 8, 16 or 32'; end if;
 select count(*) into ranked from qualifying_leaderboard(c.id);
 if ranked<p_size then raise exception 'Only % drivers have a complete qualifying score', ranked; end if;
 update drivers d set seed=l.rank from qualifying_leaderboard(c.id) l where d.id=l.driver_id;
 n:=1;
 while n<p_size loop
  n:=n*2; nxt:=array[]::int[];
  foreach s in array ord loop nxt:=nxt||s||(n+1-s); end loop;
  ord:=nxt;
 end loop;
 for i in 1..p_size/2 loop
  select id into a from drivers where competition_id=c.id and seed=ord[2*i-1];
  select id into b from drivers where competition_id=c.id and seed=ord[2*i];
  insert into battles(competition_id,round_name,battle_number,round,slot,driver_a_id,driver_b_id,lead_driver_id,status)
  values(c.id,round_name(p_size),i,1,i,a,b,a,case when i=1 then 'active' else 'pending' end)
  returning case when i=1 then id end into first_battle;
  if i=1 then update competitions set active_battle_id=first_battle where id=c.id; end if;
 end loop;
 update competitions set current_phase='tandem', bracket_size=p_size, active_driver_id=null where id=c.id;
 perform touch(c.id,'bracket_built',jsonb_build_object('size',p_size));
end $$;

create or replace function public.set_active_battle(p_battle_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare bt battles;
begin
 select * into bt from battles where id=p_battle_id;
 if bt.id is null then raise exception 'Battle not found'; end if;
 perform require_director(bt.competition_id);
 update battles set status='pending' where competition_id=bt.competition_id and status='active' and id<>bt.id;
 if bt.status<>'decided' then update battles set status='active' where id=bt.id; end if;
 update competitions set active_battle_id=bt.id where id=bt.competition_id;
 perform touch(bt.competition_id,'battle_selected',jsonb_build_object('battle_id',bt.id));
end $$;

create or replace function public.set_battle_run(p_battle_id uuid, p_run int) returns void
language plpgsql security definer set search_path=public as $$
declare bt battles;
begin
 select * into bt from battles where id=p_battle_id;
 perform require_director(bt.competition_id);
 if bt.status<>'active' then raise exception 'That battle is not running'; end if;
 if p_run not in (1,2) then raise exception 'Run must be 1 or 2'; end if;
 update battles set current_run=p_run, lead_driver_id=case when p_run=1 then driver_a_id else driver_b_id end where id=bt.id;
 perform touch(bt.competition_id,'battle_run',jsonb_build_object('battle_id',bt.id,'run',p_run));
end $$;

-- Records a winner and moves them into the next round. The higher qualifier leads run 1 of the next battle.
create or replace function public.decide_battle(p_battle_id uuid, p_winner uuid, p_by text) returns void
language plpgsql security definer set search_path=public as $$
declare bt battles; sib battles; nxt battles; total_rounds int; wa uuid; wb uuid; c competitions;
begin
 select * into bt from battles where id=p_battle_id for update;
 select * into c from competitions where id=bt.competition_id;
 update battles set status='decided', winner_driver_id=p_winner, decided_by=p_by where id=bt.id;
 total_rounds:=round(log(2,c.bracket_size))::int;
 if bt.round=total_rounds then
  update competitions set champion_driver_id=p_winner, current_phase='finished', status='finished' where id=c.id;
  return;
 end if;
 select * into sib from battles where competition_id=c.id and round=bt.round and slot=case when bt.slot%2=1 then bt.slot+1 else bt.slot-1 end;
 select * into nxt from battles where competition_id=c.id and round=bt.round+1 and slot=(bt.slot+1)/2;
 if nxt.id is not null then
  -- Result changed by an override before the next battle started.
  if nxt.driver_a_id in (bt.driver_a_id,bt.driver_b_id) then update battles set driver_a_id=p_winner where id=nxt.id;
  else update battles set driver_b_id=p_winner where id=nxt.id; end if;
  select * into nxt from battles where id=nxt.id;
  update battles set driver_a_id=case when (select seed from drivers where id=nxt.driver_a_id)<=(select seed from drivers where id=nxt.driver_b_id) then nxt.driver_a_id else nxt.driver_b_id end,
   driver_b_id=case when (select seed from drivers where id=nxt.driver_a_id)<=(select seed from drivers where id=nxt.driver_b_id) then nxt.driver_b_id else nxt.driver_a_id end where id=nxt.id;
  update battles set lead_driver_id=driver_a_id where id=nxt.id;
 elsif sib.status='decided' then
  select case when (select seed from drivers where id=p_winner)<=(select seed from drivers where id=sib.winner_driver_id) then p_winner else sib.winner_driver_id end,
         case when (select seed from drivers where id=p_winner)<=(select seed from drivers where id=sib.winner_driver_id) then sib.winner_driver_id else p_winner end into wa, wb;
  insert into battles(competition_id,round_name,battle_number,round,slot,driver_a_id,driver_b_id,lead_driver_id,status)
  values(c.id,round_name(c.bracket_size/(2^bt.round)::int),(bt.slot+1)/2,bt.round+1,(bt.slot+1)/2,wa,wb,wa,'pending');
 end if;
end $$;

create or replace function public.override_battle(p_battle_id uuid, p_result text, p_reason text) returns void
language plpgsql security definer set search_path=public as $$
declare bt battles; nxt battles; winner uuid;
begin
 select * into bt from battles where id=p_battle_id for update;
 if bt.id is null then raise exception 'Battle not found'; end if;
 perform require_director(bt.competition_id);
 if p_result not in ('A','B','OMT') then raise exception 'Result must be A, B or OMT'; end if;
 select * into nxt from battles where competition_id=bt.competition_id and round=bt.round+1 and slot=(bt.slot+1)/2;
 if bt.status='decided' and nxt.status in ('active','decided') then
  raise exception 'Too late to change this result: the next battle has started';
 end if;
 insert into official_rulings(battle_id,run_number,ruling_type,winning_driver_id,reason,decided_by)
 values(bt.id,bt.current_run,case when p_result='OMT' then 'omt' else 'winner' end,
  case p_result when 'A' then bt.driver_a_id when 'B' then bt.driver_b_id end,nullif(trim(p_reason),''),my_member_id(bt.competition_id));
 if p_result='OMT' then
  if bt.status='decided' then
   if nxt.id is not null then delete from battles where id=nxt.id; end if;
   update competitions set champion_driver_id=null, current_phase='tandem', status='live' where id=bt.competition_id and current_phase='finished';
  end if;
  update battles set status='active', winner_driver_id=null, decided_by=null, omt_count=omt_count+1, current_run=1, lead_driver_id=driver_a_id where id=bt.id;
  update competitions set active_battle_id=bt.id where id=bt.competition_id;
 else
  winner:=case p_result when 'A' then bt.driver_a_id else bt.driver_b_id end;
  if bt.status='decided' and nxt.id is null and exists(select 1 from competitions where id=bt.competition_id and current_phase='finished') then
   update competitions set current_phase='tandem', status='live' where id=bt.competition_id;
  end if;
  perform decide_battle(bt.id,winner,'director');
 end if;
 perform touch(bt.competition_id,'battle_override',jsonb_build_object('battle_id',bt.id,'result',p_result,'reason',p_reason));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Judge RPCs (idempotent so the offline queue can safely retry them)
-- ---------------------------------------------------------------------------------------------------

create or replace function public.submit_qualifying_score(p_competition_id uuid, p_driver_id uuid, p_run int, p_line numeric, p_angle numeric, p_style numeric, p_idempotency_key uuid) returns void
language plpgsql security definer set search_path=public as $$
declare m members:=require_judge(p_competition_id);
begin
 if (select current_phase from competitions where id=p_competition_id)<>'qualifying' then raise exception 'Qualifying is closed'; end if;
 if not exists(select 1 from drivers where id=p_driver_id and competition_id=p_competition_id and status='approved') then raise exception 'Driver is not in this competition'; end if;
 if p_line not between 0 and 35 or p_angle not between 0 and 30 or p_style not between 0 and 35 then raise exception 'Scores out of range (line 0-35, angle 0-30, style 0-35)'; end if;
 if exists(select 1 from qualifying_scores where idempotency_key=p_idempotency_key) then return; end if;
 insert into qualifying_scores(competition_id,driver_id,run_number,judge_member_id,line_score,angle_score,style_score,idempotency_key)
 values(p_competition_id,p_driver_id,p_run,m.id,p_line,p_angle,p_style,p_idempotency_key)
 on conflict(driver_id,run_number,judge_member_id) do update set line_score=excluded.line_score, angle_score=excluded.angle_score, style_score=excluded.style_score, idempotency_key=excluded.idempotency_key, submitted_at=now();
 perform touch(p_competition_id,'qualifying_score',jsonb_build_object('driver_id',p_driver_id,'run',p_run,'judge',m.judge_number));
end $$;

create or replace function public.submit_battle_vote(p_battle_id uuid, p_attempt int, p_decision text, p_idempotency_key uuid) returns void
language plpgsql security definer set search_path=public as $$
declare bt battles; c competitions; m members; a int; b int; votes int;
begin
 select * into bt from battles where id=p_battle_id for update;
 if bt.id is null then raise exception 'Battle not found'; end if;
 m:=require_judge(bt.competition_id);
 if p_decision not in ('A','B','OMT') then raise exception 'Decision must be A, B or OMT'; end if;
 if exists(select 1 from judge_decisions where idempotency_key=p_idempotency_key) then return; end if;
 if bt.status<>'active' or bt.omt_count<>p_attempt then raise exception 'This battle has moved on; your vote was not counted'; end if;
 if bt.current_run<2 then raise exception 'Vote after the second run'; end if;
 insert into judge_decisions(battle_id,judge_member_id,run_number,attempt,decision,idempotency_key) values(bt.id,m.id,2,p_attempt,p_decision,p_idempotency_key)
 on conflict(battle_id,judge_member_id,attempt) do update set decision=excluded.decision, idempotency_key=excluded.idempotency_key, submitted_at=now();
 select * into c from competitions where id=bt.competition_id;
 select count(*) filter (where decision='A'), count(*) filter (where decision='B'), count(*) into a, b, votes
 from judge_decisions jd join members mm on mm.id=jd.judge_member_id and mm.active where jd.battle_id=bt.id and jd.attempt=p_attempt;
 perform touch(bt.competition_id,'battle_vote',jsonb_build_object('battle_id',bt.id,'attempt',p_attempt,'judge',m.judge_number));
 if votes<c.judge_count then return; end if;
 -- A driver needs a strict majority of the panel (2 of 3, or both of 2). Anything else is a one more time.
 if a*2>c.judge_count then perform decide_battle(bt.id,bt.driver_a_id,'judges');
 elsif b*2>c.judge_count then perform decide_battle(bt.id,bt.driver_b_id,'judges');
 else update battles set omt_count=omt_count+1, current_run=1, lead_driver_id=driver_a_id where id=bt.id;
 end if;
 perform touch(bt.competition_id,'battle_result',jsonb_build_object('battle_id',bt.id,'a',a,'b',b,'votes',votes));
end $$;

create or replace function public.record_judge_call(p_battle_id uuid, p_attempt int, p_call_type text, p_idempotency_key uuid) returns void
language plpgsql security definer set search_path=public as $$
declare bt battles; m members;
begin
 select * into bt from battles where id=p_battle_id;
 if bt.id is null then raise exception 'Battle not found'; end if;
 m:=require_judge(bt.competition_id);
 insert into judge_calls(battle_id,judge_member_id,run_number,attempt,call_type,idempotency_key) values(bt.id,m.id,bt.current_run,p_attempt,p_call_type,p_idempotency_key)
 on conflict(idempotency_key) do nothing;
 if found then perform touch(bt.competition_id,'judge_call',jsonb_build_object('battle_id',bt.id,'type',p_call_type,'judge',m.judge_number)); end if;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- State: one role-aware read for every screen. Judges only ever see their own undecided votes and scores.
-- ---------------------------------------------------------------------------------------------------

create or replace function public.competition_state(p_competition_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare uid uuid:=require_user(); c competitions; me members; is_dir boolean; my_drivers jsonb; result jsonb;
begin
 select * into c from competitions where id=p_competition_id;
 if c.id is null then raise exception 'Competition not found'; end if;
 select * into me from members where competition_id=c.id and user_id=uid;
 if me.id is not null and not me.active then raise exception 'The director removed you from this competition'; end if;
 select jsonb_agg(jsonb_build_object('id',id,'name',name,'team_name',team_name,'car_number',car_number,'status',status,'rejoin_code',rejoin_code) order by registration_position)
  into my_drivers from drivers where competition_id=c.id and user_id=uid;
 if me.id is null and my_drivers is null then raise exception 'You are not part of this competition'; end if;
 is_dir:=me.role='director';

 result:=jsonb_build_object(
  'competition',jsonb_build_object('id',c.id,'name',c.name,'judge_count',c.judge_count,'phase',c.current_phase,'state_version',c.state_version,
   'rules_version',c.rules_version,'active_driver_id',c.active_driver_id,'active_run',c.active_run,'active_battle_id',c.active_battle_id,
   'bracket_size',c.bracket_size,'champion_driver_id',c.champion_driver_id,
   'join_code',case when is_dir then c.join_code end,
   'driver_registration_code',case when is_dir or me.role='display' then c.driver_registration_code end,
   'director_pin',case when is_dir then (select director_pin from competition_secrets where competition_id=c.id) end),
  'me',case when me.id is not null then jsonb_build_object('member_id',me.id,'role',me.role,'judge_number',me.judge_number,'rejoin_code',me.rejoin_code,'display_name',me.display_name)
            else jsonb_build_object('role','competitor') end,
  'my_drivers',coalesce(my_drivers,'[]'),
  'judges',(select coalesce(jsonb_agg(jsonb_build_object('member_id',id,'display_name',display_name,'judge_number',judge_number,'rejoin_code',case when is_dir then rejoin_code end) order by judge_number),'[]')
            from members where competition_id=c.id and role='judge' and active),
  'drivers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'team_name',team_name,'car_number',car_number,'status',status,'seed',seed,
              'rejoin_code',case when is_dir then rejoin_code end,'self_registered',user_id is not null) order by registration_position),'[]')
             from drivers where competition_id=c.id and (is_dir or status='approved' or user_id=uid)),
  'leaderboard',(select coalesce(jsonb_agg(jsonb_build_object('driver_id',driver_id,'run1',run1,'run2',run2,'best',best,'rank',rank) order by rank),'[]') from qualifying_leaderboard(c.id)),
  'qualifying_progress',(select coalesce(jsonb_agg(jsonb_build_object('driver_id',driver_id,'run',run_number,'scored',n)),'[]')
             from (select q.driver_id,q.run_number,count(*) n from qualifying_scores q join members m on m.id=q.judge_member_id and m.active where q.competition_id=c.id group by 1,2) x),
  'my_scores',(select coalesce(jsonb_agg(jsonb_build_object('driver_id',driver_id,'run',run_number,'line',line_score,'angle',angle_score,'style',style_score,'total',total)),'[]')
             from qualifying_scores where judge_member_id=me.id),
  'battles',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'round',b.round,'slot',b.slot,'round_name',b.round_name,'driver_a_id',b.driver_a_id,'driver_b_id',b.driver_b_id,
              'status',b.status,'current_run',b.current_run,'lead_driver_id',b.lead_driver_id,'attempt',b.omt_count,'winner_driver_id',b.winner_driver_id,'decided_by',b.decided_by,
              'votes_in',(select count(*) from judge_decisions jd join members m on m.id=jd.judge_member_id and m.active where jd.battle_id=b.id and jd.attempt=b.omt_count and b.status='active'),
              'my_vote',(select decision from judge_decisions where battle_id=b.id and attempt=b.omt_count and judge_member_id=me.id),
              -- Votes are revealed per attempt once that attempt is over.
              'history',(select coalesce(jsonb_agg(jsonb_build_object('attempt',x.attempt,'votes',x.votes) order by x.attempt),'[]') from (
                 select jd.attempt, jsonb_agg(jsonb_build_object('judge_number',m.judge_number,'decision',jd.decision) order by m.judge_number) votes
                 from judge_decisions jd join members m on m.id=jd.judge_member_id
                 where jd.battle_id=b.id and (jd.attempt<b.omt_count or b.status='decided') group by jd.attempt) x),
              'calls',case when is_dir then (select coalesce(jsonb_agg(jsonb_build_object('type',call_type,'judge_number',m.judge_number,'attempt',jc.attempt,'run',jc.run_number) order by jc.created_at),'[]')
                 from judge_calls jc join members m on m.id=jc.judge_member_id where jc.battle_id=b.id) end
             ) order by b.round, b.slot),'[]') from battles b where b.competition_id=c.id)
 );
 return result;
end $$;

revoke execute on function public.touch(uuid,text,jsonb), public.decide_battle(uuid,uuid,text), public.gen_rejoin_code(uuid), public.require_director(uuid), public.require_judge(uuid), public.qualifying_leaderboard(uuid) from public, anon, authenticated;
grant execute on function public.invite_info(text) to anon, authenticated;
grant execute on function public.create_competition(text,text,int), public.join_competition_by_code(text,text,text), public.register_driver(text,text,text), public.rejoin(text,text),
 public.add_driver(uuid,text,text), public.set_driver_status(uuid,text), public.remove_member(uuid), public.start_qualifying(uuid), public.set_qualifying_run(uuid,uuid,int),
 public.build_bracket(uuid,int), public.set_active_battle(uuid), public.set_battle_run(uuid,int), public.override_battle(uuid,text,text),
 public.submit_qualifying_score(uuid,uuid,int,numeric,numeric,numeric,uuid), public.submit_battle_vote(uuid,int,text,uuid), public.record_judge_call(uuid,int,text,uuid),
 public.competition_state(uuid) to authenticated;
