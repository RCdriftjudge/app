-- Race-day hardening.
-- 1. Rejoin codes are pinned to the phone that holds them. A different phone can only take over a judge or
--    driver after the director releases it (e.g. a dead or wiped phone). The director PIN is not pinned.
-- 2. Scores and votes belong to a judging seat, not a person. Removing or replacing a judge no longer
--    un-scores qualifying runs, and battles resolve with the judges who are actually seated.

alter table members add column if not exists released boolean not null default false;
alter table drivers add column if not exists released boolean not null default false;

alter table qualifying_scores add column if not exists judge_number int;
update qualifying_scores q set judge_number=m.judge_number from members m where m.id=q.judge_member_id and q.judge_number is null;

-- A run is locked in as complete once every seated judge has scored it; later panel changes can't undo that.
create table if not exists qualifying_complete(
 driver_id uuid not null references drivers(id) on delete cascade, run_number int not null,
 competition_id uuid not null references competitions(id) on delete cascade, completed_at timestamptz not null default now(),
 primary key(driver_id,run_number)
);
alter table qualifying_complete enable row level security;
revoke all on qualifying_complete from anon, authenticated;

-- Runs that were complete under the old rule stay complete.
insert into qualifying_complete(driver_id,run_number,competition_id)
select q.driver_id,q.run_number,q.competition_id from qualifying_scores q join competitions c on c.id=q.competition_id
group by q.driver_id,q.run_number,q.competition_id,c.judge_count having count(distinct q.judge_number)>=c.judge_count
on conflict do nothing;

create or replace function public.seated_judges(cid uuid) returns int language sql stable security definer set search_path=public as $$
 select count(*)::int from members where competition_id=cid and role='judge' and active;
$$;

-- Complete when every seated judge has a score for the run, and at least two seats (or the whole panel of
-- two) have scored. Scores from a judge who has since left still count for their seat.
create or replace function public.evaluate_run(cid uuid, p_driver uuid, p_run int) returns void
language plpgsql security definer set search_path=public as $$
declare jc int; seats int; missing int;
begin
 if exists(select 1 from qualifying_complete where driver_id=p_driver and run_number=p_run) then return; end if;
 select judge_count into jc from competitions where id=cid;
 select count(distinct judge_number) into seats from qualifying_scores where driver_id=p_driver and run_number=p_run;
 select count(*) into missing from members m where m.competition_id=cid and m.role='judge' and m.active
  and not exists(select 1 from qualifying_scores q where q.driver_id=p_driver and q.run_number=p_run and q.judge_number=m.judge_number);
 if missing=0 and seats>=least(2,jc) then
  insert into qualifying_complete(driver_id,run_number,competition_id) values(p_driver,p_run,cid) on conflict do nothing;
 end if;
end $$;

create or replace function public.qualifying_leaderboard(cid uuid) returns table(driver_id uuid, run1 numeric, run2 numeric, best numeric, rank int)
language sql stable security definer set search_path=public as $$
 with latest as (
  select distinct on (q.driver_id,q.run_number,q.judge_number) q.driver_id,q.run_number,q.total
  from qualifying_scores q where q.competition_id=cid order by q.driver_id,q.run_number,q.judge_number,q.submitted_at desc
 ),
 runs as (
  select l.driver_id,l.run_number,round(avg(l.total),2) as score from latest l
  join qualifying_complete qc on qc.driver_id=l.driver_id and qc.run_number=l.run_number group by 1,2
 ),
 per as (
  select d.id,d.registration_position,
   (select score from runs r where r.driver_id=d.id and r.run_number=1) as run1,
   (select score from runs r where r.driver_id=d.id and r.run_number=2) as run2
  from drivers d where d.competition_id=cid and d.status='approved'
 )
 select id,run1,run2,greatest(run1,run2) as best,
  (row_number() over (order by greatest(run1,run2) desc nulls last, least(run1,run2) desc nulls last, registration_position))::int
 from per where coalesce(run1,run2) is not null;
$$;

create or replace function public.submit_qualifying_score(p_competition_id uuid, p_driver_id uuid, p_run int, p_line numeric, p_angle numeric, p_style numeric, p_idempotency_key uuid) returns void
language plpgsql security definer set search_path=public as $$
declare m members:=require_judge(p_competition_id);
begin
 if (select current_phase from competitions where id=p_competition_id)<>'qualifying' then raise exception 'Qualifying is closed'; end if;
 if not exists(select 1 from drivers where id=p_driver_id and competition_id=p_competition_id and status='approved') then raise exception 'Driver is not in this competition'; end if;
 if p_line not between 0 and 35 or p_angle not between 0 and 30 or p_style not between 0 and 35 then raise exception 'Scores out of range (line 0-35, angle 0-30, style 0-35)'; end if;
 if exists(select 1 from qualifying_scores where idempotency_key=p_idempotency_key) then return; end if;
 insert into qualifying_scores(competition_id,driver_id,run_number,judge_member_id,judge_number,line_score,angle_score,style_score,idempotency_key)
 values(p_competition_id,p_driver_id,p_run,m.id,m.judge_number,p_line,p_angle,p_style,p_idempotency_key)
 on conflict(driver_id,run_number,judge_member_id) do update set line_score=excluded.line_score, angle_score=excluded.angle_score, style_score=excluded.style_score,
  judge_number=excluded.judge_number, idempotency_key=excluded.idempotency_key, submitted_at=now();
 perform evaluate_run(p_competition_id,p_driver_id,p_run);
 perform touch(p_competition_id,'qualifying_score',jsonb_build_object('driver_id',p_driver_id,'run',p_run,'judge',m.judge_number));
end $$;

-- Decides the current attempt once every seated judge has voted (at least two, or both of a two-judge
-- panel). A driver needs a strict majority of the votes cast; anything else is a one more time.
create or replace function public.resolve_battle(p_battle_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare bt battles; c competitions; a int; b int; votes int; seated int;
begin
 select * into bt from battles where id=p_battle_id for update;
 if bt.status<>'active' or bt.current_run<2 then return; end if;
 select * into c from competitions where id=bt.competition_id;
 seated:=seated_judges(c.id);
 select count(*) filter (where decision='A'), count(*) filter (where decision='B'), count(*) into a, b, votes
 from judge_decisions jd join members mm on mm.id=jd.judge_member_id and mm.active where jd.battle_id=bt.id and jd.attempt=bt.omt_count;
 if votes<seated or votes<least(2,c.judge_count) then return; end if;
 if a*2>votes then perform decide_battle(bt.id,bt.driver_a_id,'judges');
 elsif b*2>votes then perform decide_battle(bt.id,bt.driver_b_id,'judges');
 else update battles set omt_count=omt_count+1, current_run=1, lead_driver_id=driver_a_id where id=bt.id;
 end if;
 perform touch(bt.competition_id,'battle_result',jsonb_build_object('battle_id',bt.id,'a',a,'b',b,'votes',votes,'seated',seated));
end $$;

create or replace function public.submit_battle_vote(p_battle_id uuid, p_attempt int, p_decision text, p_idempotency_key uuid) returns void
language plpgsql security definer set search_path=public as $$
declare bt battles; m members;
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
 perform touch(bt.competition_id,'battle_vote',jsonb_build_object('battle_id',bt.id,'attempt',p_attempt,'judge',m.judge_number));
 perform resolve_battle(bt.id);
end $$;

-- Replace a judge with a different person. Their scores stay with the seat; their undecided battle vote is
-- dropped, and anything that was only waiting on them is settled with the judges still seated.
create or replace function public.remove_member(p_member_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare m members; r record;
begin
 select * into m from members where id=p_member_id;
 if m.id is null then raise exception 'Member not found'; end if;
 perform require_director(m.competition_id);
 if m.role='director' then raise exception 'The director cannot be removed'; end if;
 update members set active=false, judge_number=null, released=false where id=p_member_id;
 delete from judge_decisions jd using battles b where jd.battle_id=b.id and b.status<>'decided' and jd.judge_member_id=p_member_id;
 for r in select distinct driver_id, run_number from qualifying_scores where competition_id=m.competition_id loop
  perform evaluate_run(m.competition_id,r.driver_id,r.run_number);
 end loop;
 for r in select id from battles where competition_id=m.competition_id and status='active' loop
  perform resolve_battle(r.id);
 end loop;
 perform touch(m.competition_id,'member_removed',jsonb_build_object('member_id',p_member_id,'role',m.role));
end $$;

-- Same person, new phone: lets the next device that uses their rejoin code take over.
create or replace function public.release_member(p_member_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare m members;
begin
 select * into m from members where id=p_member_id and active;
 if m.id is null then raise exception 'Member not found'; end if;
 perform require_director(m.competition_id);
 if m.role='director' then raise exception 'Use the director PIN to move the director to a new phone'; end if;
 update members set released=true where id=m.id;
 perform touch(m.competition_id,'member_released',jsonb_build_object('member_id',m.id));
end $$;

create or replace function public.release_driver(p_driver_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare d drivers;
begin
 select * into d from drivers where id=p_driver_id;
 if d.id is null then raise exception 'Driver not found'; end if;
 perform require_director(d.competition_id);
 update drivers set released=true where id=d.id;
 perform touch(d.competition_id,'driver_released',jsonb_build_object('driver_id',d.id));
end $$;

create or replace function public.rejoin(p_event_code text, p_rejoin_code text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=require_user(); c competitions; m members; d drivers; code text:=upper(trim(p_rejoin_code)); existing members;
begin
 select * into c from competitions where join_code=upper(trim(p_event_code)) or driver_registration_code=upper(trim(p_event_code));
 if c.id is null then raise exception 'Competition code not found'; end if;
 if (select count(*) from rejoin_attempts where competition_id=c.id and created_at>now()-interval '10 minutes')>=20 then
  raise exception 'Too many wrong codes. Wait a few minutes and try again';
 end if;
 select * into m from members where competition_id=c.id and active and (
  (role<>'director' and rejoin_code=code) or (role='director' and exists(select 1 from competition_secrets s where s.competition_id=c.id and s.director_pin=code)));
 if m.id is not null then
  -- Pinned to the phone that holds it, unless the director released it for a new phone.
  if m.role<>'director' and m.user_id<>uid and not m.released then
   return jsonb_build_object('error','That code is in use on another phone. Ask the director to release it to your new phone.');
  end if;
  select * into existing from members where competition_id=c.id and user_id=uid;
  if existing.id is not null and existing.id<>m.id then
   if existing.role='display' then delete from members where id=existing.id;
   else raise exception 'This device is already in the competition as %', existing.role; end if;
  end if;
  update members set user_id=uid, released=false where id=m.id;
  perform touch(c.id,'member_rejoined',jsonb_build_object('member_id',m.id));
  return jsonb_build_object('competition_id',c.id,'member_id',m.id,'role',m.role,'judge_number',m.judge_number,'rejoin_code',m.rejoin_code);
 end if;
 select * into d from drivers where competition_id=c.id and rejoin_code=code;
 if d.id is not null then
  if d.user_id is not null and d.user_id<>uid and not d.released then
   return jsonb_build_object('error','That code is in use on another phone. Ask the director to release it to your new phone.');
  end if;
  update drivers set user_id=uid, released=false where id=d.id;
  perform touch(c.id,'driver_rejoined',jsonb_build_object('driver_id',d.id));
  return jsonb_build_object('competition_id',c.id,'competition_name',c.name,'driver_id',d.id,'car_number',d.car_number,'rejoin_code',d.rejoin_code,'role','competitor');
 end if;
 -- Returned rather than raised: raising would roll back the attempt record that drives the rate limit.
 insert into rejoin_attempts(competition_id) values(c.id);
 return jsonb_build_object('error','Rejoin code not found');
end $$;

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
  'judges',(select coalesce(jsonb_agg(jsonb_build_object('member_id',id,'display_name',display_name,'judge_number',judge_number,'rejoin_code',case when is_dir then rejoin_code end,'released',case when is_dir then released end) order by judge_number),'[]')
            from members where competition_id=c.id and role='judge' and active),
  'drivers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'team_name',team_name,'car_number',car_number,'status',status,'seed',seed,
              'rejoin_code',case when is_dir then rejoin_code end,'released',case when is_dir then released end,'self_registered',user_id is not null) order by registration_position),'[]')
             from drivers where competition_id=c.id and (is_dir or status='approved' or user_id=uid)),
  'leaderboard',(select coalesce(jsonb_agg(jsonb_build_object('driver_id',driver_id,'run1',run1,'run2',run2,'best',best,'rank',rank) order by rank),'[]') from qualifying_leaderboard(c.id)),
  'qualifying_progress',(select coalesce(jsonb_agg(jsonb_build_object('driver_id',x.driver_id,'run',x.run_number,'scored',x.n,
              'complete',exists(select 1 from qualifying_complete qc where qc.driver_id=x.driver_id and qc.run_number=x.run_number))),'[]')
             from (select q.driver_id,q.run_number,count(distinct q.judge_number) filter (where exists(select 1 from members m where m.competition_id=c.id and m.active and m.role='judge' and m.judge_number=q.judge_number)) n
                   from qualifying_scores q where q.competition_id=c.id group by 1,2) x),
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

revoke execute on function public.evaluate_run(uuid,uuid,int), public.resolve_battle(uuid), public.seated_judges(uuid), public.qualifying_leaderboard(uuid) from public, anon, authenticated;
grant execute on function public.release_member(uuid), public.release_driver(uuid) to authenticated;
