-- Baseline: the public schema of the hosted project (qixvqudfrajdodkaazmm) as of 2026-09-27, dumped with
-- `supabase db dump`. It replaces the original schema.sql plus the nine migrations that were applied from
-- the dashboard, so a local `supabase db reset` matches production.



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."generate_rejoin_code"("p_competition_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text;
  v_exists boolean;
begin
  for i in 1..100 loop
    v_code := substr(v_alphabet, floor(random() * length(v_alphabet))::int + 1, 1)
           || substr(v_alphabet, floor(random() * length(v_alphabet))::int + 1, 1);
    select exists(
      select 1 from public.drivers d where d.competition_id = p_competition_id and d.rejoin_code = v_code
      union all
      select 1 from public.members m where m.competition_id = p_competition_id and m.rejoin_code = v_code
    ) into v_exists;
    if not v_exists then return v_code; end if;
  end loop;
  raise exception 'No rejoin codes available for this competition';
end;
$$;


ALTER FUNCTION "public"."generate_rejoin_code"("p_competition_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_competition_member"("cid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select exists(select 1 from public.members where competition_id=cid and user_id=auth.uid()); $$;


ALTER FUNCTION "public"."is_competition_member"("cid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_director"("cid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select exists(select 1 from public.members where competition_id=cid and user_id=auth.uid() and role='director'); $$;


ALTER FUNCTION "public"."is_director"("cid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_competition"("p_join_code" "text", "p_display_name" "text", "p_role" "text" DEFAULT 'judge'::"text") RETURNS TABLE("competition_id" "uuid", "competition_name" "text", "member_id" "uuid", "assigned_judge_number" integer, "rejoin_code" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_user_id uuid := auth.uid(); v_competition public.competitions%rowtype; v_member public.members%rowtype; v_next int; v_code text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select c.* into v_competition from public.competitions c where c.join_code = upper(trim(p_join_code)) limit 1;
  if not found then raise exception 'Competition code not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_competition.id::text, 0));
  if lower(p_role) = 'judge' then
    select coalesce(min(n),1) into v_next from generate_series(1,v_competition.judge_count) as n where not exists (select 1 from public.members m where m.competition_id=v_competition.id and m.judge_number=n);
    if v_next is null then raise exception 'All judge positions are already assigned'; end if;
    v_code := public.generate_rejoin_code(v_competition.id);
    insert into public.members(competition_id,user_id,display_name,role,judge_number,rejoin_code) values(v_competition.id,v_user_id,coalesce(nullif(trim(p_display_name),''),'Judge'),'judge',v_next,v_code) returning * into v_member;
  else
    v_code := public.generate_rejoin_code(v_competition.id);
    insert into public.members(competition_id,user_id,display_name,role,rejoin_code) values(v_competition.id,v_user_id,coalesce(nullif(trim(p_display_name),''),'Display'),'display',v_code) returning * into v_member;
  end if;
  return query select v_competition.id,v_competition.name,v_member.id,v_member.judge_number,v_member.rejoin_code;
exception when unique_violation then raise exception 'That participant position or rejoin code was just taken. Please try joining again';
end;
$$;


ALTER FUNCTION "public"."join_competition"("p_join_code" "text", "p_display_name" "text", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_competition_by_code"("p_code" "text", "p_display_name" "text", "p_role" "text" DEFAULT 'judge'::"text") RETURNS TABLE("competition_id" "uuid", "competition_name" "text", "member_id" "uuid", "judge_number" integer, "rejoin_code" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select jc.competition_id,jc.competition_name,jc.member_id,jc.assigned_judge_number as judge_number,jc.rejoin_code from public.join_competition(p_code,p_display_name,p_role) jc; $$;


ALTER FUNCTION "public"."join_competition_by_code"("p_code" "text", "p_display_name" "text", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_member_id"("cid" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select id from public.members where competition_id=cid and user_id=auth.uid() limit 1; $$;


ALTER FUNCTION "public"."my_member_id"("cid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_driver"("p_registration_code" "text", "p_name" "text", "p_team_name" "text" DEFAULT NULL::"text") RETURNS TABLE("driver_id" "uuid", "competition_id" "uuid", "competition_name" "text", "registration_position" integer, "car_number" "text", "status" "text", "rejoin_code" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_user uuid := auth.uid(); v_comp public.competitions%rowtype; v_pos int; v_driver public.drivers%rowtype; v_code text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select c.* into v_comp from public.competitions c where c.driver_registration_code = upper(trim(p_registration_code)) limit 1;
  if not found then raise exception 'Registration code not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_comp.id::text, 0));
  select coalesce(max(d.registration_position),0)+1 into v_pos from public.drivers d where d.competition_id = v_comp.id;
  v_code := public.generate_rejoin_code(v_comp.id);
  insert into public.drivers(competition_id,registration_position,name,car_number,user_id,status,team_name,rejoin_code)
  values(v_comp.id,v_pos,coalesce(nullif(trim(p_name),''),'Driver'),v_pos::text,v_user,'pending',nullif(trim(p_team_name),''),v_code)
  returning * into v_driver;
  return query select v_driver.id,v_comp.id,v_comp.name,v_driver.registration_position,v_driver.car_number,v_driver.status,v_driver.rejoin_code;
end;
$$;


ALTER FUNCTION "public"."register_driver"("p_registration_code" "text", "p_name" "text", "p_team_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rejoin_driver"("p_rejoin_code" "text") RETURNS TABLE("driver_id" "uuid", "competition_id" "uuid", "competition_name" "text", "registration_position" integer, "car_number" "text", "status" "text", "name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_user uuid := auth.uid(); v_driver public.drivers%rowtype; v_comp public.competitions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select d.* into v_driver from public.drivers d where d.rejoin_code=upper(trim(p_rejoin_code)) order by d.created_at desc limit 1;
  if not found then raise exception 'Rejoin code not found'; end if;
  select * into v_comp from public.competitions c where c.id=v_driver.competition_id;
  update public.drivers set user_id=v_user where id=v_driver.id;
  return query select v_driver.id,v_driver.competition_id,v_comp.name,v_driver.registration_position,v_driver.car_number,v_driver.status,v_driver.name;
end;
$$;


ALTER FUNCTION "public"."rejoin_driver"("p_rejoin_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rejoin_judge"("p_rejoin_code" "text") RETURNS TABLE("competition_id" "uuid", "competition_name" "text", "member_id" "uuid", "judge_number" integer, "display_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_user uuid := auth.uid(); v_member public.members%rowtype; v_comp public.competitions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select m.* into v_member from public.members m where m.rejoin_code=upper(trim(p_rejoin_code)) and m.role='judge' order by m.created_at desc limit 1;
  if not found then raise exception 'Rejoin code not found'; end if;
  select * into v_comp from public.competitions c where c.id=v_member.competition_id;
  update public.members set user_id=v_user where id=v_member.id;
  return query select v_member.competition_id,v_comp.name,v_member.id,v_member.judge_number,v_member.display_name;
end;
$$;


ALTER FUNCTION "public"."rejoin_judge"("p_rejoin_code" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "actor_member_id" "uuid",
    "action" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."battles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "round_name" "text" NOT NULL,
    "battle_number" integer NOT NULL,
    "driver_a_id" "uuid" NOT NULL,
    "driver_b_id" "uuid" NOT NULL,
    "current_run" integer DEFAULT 1 NOT NULL,
    "lead_driver_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "omt_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "battles_current_run_check" CHECK (("current_run" = ANY (ARRAY[1, 2])))
);


ALTER TABLE "public"."battles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "join_code" "text" NOT NULL,
    "rules_version" "text" DEFAULT 'SDC'::"text" NOT NULL,
    "judge_count" integer DEFAULT 3 NOT NULL,
    "status" "text" DEFAULT 'setup'::"text" NOT NULL,
    "current_phase" "text" DEFAULT 'setup'::"text" NOT NULL,
    "active_run" integer DEFAULT 1 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "driver_registration_code" "text" NOT NULL,
    CONSTRAINT "competitions_active_run_check" CHECK (("active_run" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "competitions_judge_count_check" CHECK ((("judge_count" >= 2) AND ("judge_count" <= 3)))
);


ALTER TABLE "public"."competitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drivers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "registration_position" integer NOT NULL,
    "name" "text" NOT NULL,
    "car_number" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "team_name" "text",
    "rejoin_code" "text",
    CONSTRAINT "drivers_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."drivers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."judge_calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "battle_id" "uuid" NOT NULL,
    "judge_member_id" "uuid" NOT NULL,
    "run_number" integer NOT NULL,
    "call_type" "text" NOT NULL,
    "subject_driver_id" "uuid",
    "notes" "text",
    "idempotency_key" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "judge_calls_run_number_check" CHECK (("run_number" = ANY (ARRAY[1, 2])))
);


ALTER TABLE "public"."judge_calls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."judge_decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "battle_id" "uuid" NOT NULL,
    "judge_member_id" "uuid" NOT NULL,
    "run_number" integer NOT NULL,
    "decision" "text" NOT NULL,
    "idempotency_key" "uuid" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "judge_decisions_decision_check" CHECK (("decision" = ANY (ARRAY['A'::"text", 'B'::"text", 'OMT'::"text"]))),
    CONSTRAINT "judge_decisions_run_number_check" CHECK (("run_number" = ANY (ARRAY[1, 2])))
);


ALTER TABLE "public"."judge_decisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "judge_number" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rejoin_code" "text",
    CONSTRAINT "members_judge_number_check" CHECK ((("judge_number" IS NULL) OR (("judge_number" >= 1) AND ("judge_number" <= 3)))),
    CONSTRAINT "members_role_check" CHECK (("role" = ANY (ARRAY['director'::"text", 'judge'::"text", 'display'::"text"])))
);


ALTER TABLE "public"."members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."official_rulings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "battle_id" "uuid" NOT NULL,
    "run_number" integer NOT NULL,
    "ruling_type" "text" NOT NULL,
    "winning_driver_id" "uuid",
    "reason" "text",
    "decided_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."official_rulings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."presence" (
    "competition_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "last_seen" timestamp with time zone DEFAULT "now"() NOT NULL,
    "online" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."presence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."qualifying_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "competition_id" "uuid" NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "run_number" integer NOT NULL,
    "line_score" numeric(6,2) DEFAULT 0 NOT NULL,
    "angle_score" numeric(6,2) DEFAULT 0 NOT NULL,
    "style_score" numeric(6,2) DEFAULT 0 NOT NULL,
    "style_bonus" numeric(6,2) DEFAULT 0 NOT NULL,
    "deductions" numeric(6,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'scored'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "qualifying_runs_run_number_check" CHECK (("run_number" = ANY (ARRAY[1, 2])))
);


ALTER TABLE "public"."qualifying_runs" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."battles"
    ADD CONSTRAINT "battles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."competitions"
    ADD CONSTRAINT "competitions_join_code_key" UNIQUE ("join_code");



ALTER TABLE ONLY "public"."competitions"
    ADD CONSTRAINT "competitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_competition_id_registration_position_key" UNIQUE ("competition_id", "registration_position");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."judge_calls"
    ADD CONSTRAINT "judge_calls_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."judge_calls"
    ADD CONSTRAINT "judge_calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."judge_decisions"
    ADD CONSTRAINT "judge_decisions_battle_id_judge_member_id_run_number_key" UNIQUE ("battle_id", "judge_member_id", "run_number");



ALTER TABLE ONLY "public"."judge_decisions"
    ADD CONSTRAINT "judge_decisions_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."judge_decisions"
    ADD CONSTRAINT "judge_decisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_competition_id_judge_number_key" UNIQUE ("competition_id", "judge_number");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_competition_id_user_id_key" UNIQUE ("competition_id", "user_id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."official_rulings"
    ADD CONSTRAINT "official_rulings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."presence"
    ADD CONSTRAINT "presence_pkey" PRIMARY KEY ("competition_id", "user_id");



ALTER TABLE ONLY "public"."qualifying_runs"
    ADD CONSTRAINT "qualifying_runs_driver_id_run_number_key" UNIQUE ("driver_id", "run_number");



ALTER TABLE ONLY "public"."qualifying_runs"
    ADD CONSTRAINT "qualifying_runs_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "competitions_driver_registration_code_key" ON "public"."competitions" USING "btree" ("driver_registration_code");



CREATE UNIQUE INDEX "drivers_competition_car_number_key" ON "public"."drivers" USING "btree" ("competition_id", "car_number") WHERE ("car_number" IS NOT NULL);



CREATE UNIQUE INDEX "drivers_competition_registration_position_key" ON "public"."drivers" USING "btree" ("competition_id", "registration_position");



CREATE UNIQUE INDEX "drivers_competition_rejoin_code_uidx" ON "public"."drivers" USING "btree" ("competition_id", "rejoin_code") WHERE ("rejoin_code" IS NOT NULL);



CREATE UNIQUE INDEX "members_competition_rejoin_code_uidx" ON "public"."members" USING "btree" ("competition_id", "rejoin_code") WHERE ("rejoin_code" IS NOT NULL);



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_member_id_fkey" FOREIGN KEY ("actor_member_id") REFERENCES "public"."members"("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battles"
    ADD CONSTRAINT "battles_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."battles"
    ADD CONSTRAINT "battles_driver_a_id_fkey" FOREIGN KEY ("driver_a_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."battles"
    ADD CONSTRAINT "battles_driver_b_id_fkey" FOREIGN KEY ("driver_b_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."battles"
    ADD CONSTRAINT "battles_lead_driver_id_fkey" FOREIGN KEY ("lead_driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."competitions"
    ADD CONSTRAINT "competitions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drivers"
    ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."judge_calls"
    ADD CONSTRAINT "judge_calls_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."judge_calls"
    ADD CONSTRAINT "judge_calls_judge_member_id_fkey" FOREIGN KEY ("judge_member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."judge_calls"
    ADD CONSTRAINT "judge_calls_subject_driver_id_fkey" FOREIGN KEY ("subject_driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."judge_decisions"
    ADD CONSTRAINT "judge_decisions_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."judge_decisions"
    ADD CONSTRAINT "judge_decisions_judge_member_id_fkey" FOREIGN KEY ("judge_member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."official_rulings"
    ADD CONSTRAINT "official_rulings_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "public"."battles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."official_rulings"
    ADD CONSTRAINT "official_rulings_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."members"("id");



ALTER TABLE ONLY "public"."official_rulings"
    ADD CONSTRAINT "official_rulings_winning_driver_id_fkey" FOREIGN KEY ("winning_driver_id") REFERENCES "public"."drivers"("id");



ALTER TABLE ONLY "public"."presence"
    ADD CONSTRAINT "presence_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presence"
    ADD CONSTRAINT "presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."qualifying_runs"
    ADD CONSTRAINT "qualifying_runs_competition_id_fkey" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."qualifying_runs"
    ADD CONSTRAINT "qualifying_runs_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE CASCADE;



CREATE POLICY "audit_insert" ON "public"."audit_log" FOR INSERT TO "authenticated" WITH CHECK ((("actor_user_id" = "auth"."uid"()) AND "public"."is_competition_member"("competition_id")));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_select" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ("public"."is_competition_member"("competition_id"));



ALTER TABLE "public"."battles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "battles_insert" ON "public"."battles" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_director"("competition_id"));



CREATE POLICY "battles_select" ON "public"."battles" FOR SELECT TO "authenticated" USING ("public"."is_competition_member"("competition_id"));



CREATE POLICY "battles_update" ON "public"."battles" FOR UPDATE TO "authenticated" USING ("public"."is_director"("competition_id")) WITH CHECK ("public"."is_director"("competition_id"));



CREATE POLICY "calls_insert" ON "public"."judge_calls" FOR INSERT TO "authenticated" WITH CHECK ((("judge_member_id" = "public"."my_member_id"(( SELECT "battles"."competition_id"
   FROM "public"."battles"
  WHERE ("battles"."id" = "judge_calls"."battle_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."members" "m"
  WHERE (("m"."id" = "judge_calls"."judge_member_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = 'judge'::"text"))))));



CREATE POLICY "calls_select" ON "public"."judge_calls" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."battles" "b"
  WHERE (("b"."id" = "judge_calls"."battle_id") AND "public"."is_competition_member"("b"."competition_id")))));



ALTER TABLE "public"."competitions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "competitions_insert" ON "public"."competitions" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "competitions_select" ON "public"."competitions" FOR SELECT TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR "public"."is_competition_member"("id")));



CREATE POLICY "competitions_update" ON "public"."competitions" FOR UPDATE TO "authenticated" USING ("public"."is_director"("id")) WITH CHECK ("public"."is_director"("id"));



CREATE POLICY "decisions_insert" ON "public"."judge_decisions" FOR INSERT TO "authenticated" WITH CHECK ((("judge_member_id" = "public"."my_member_id"(( SELECT "battles"."competition_id"
   FROM "public"."battles"
  WHERE ("battles"."id" = "judge_decisions"."battle_id")))) AND (EXISTS ( SELECT 1
   FROM "public"."members" "m"
  WHERE (("m"."id" = "judge_decisions"."judge_member_id") AND ("m"."user_id" = "auth"."uid"()) AND ("m"."role" = 'judge'::"text"))))));



CREATE POLICY "decisions_select" ON "public"."judge_decisions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."battles" "b"
  WHERE (("b"."id" = "judge_decisions"."battle_id") AND "public"."is_competition_member"("b"."competition_id")))));



CREATE POLICY "decisions_update" ON "public"."judge_decisions" FOR UPDATE TO "authenticated" USING (("judge_member_id" = "public"."my_member_id"(( SELECT "battles"."competition_id"
   FROM "public"."battles"
  WHERE ("battles"."id" = "judge_decisions"."battle_id"))))) WITH CHECK (("judge_member_id" = "public"."my_member_id"(( SELECT "battles"."competition_id"
   FROM "public"."battles"
  WHERE ("battles"."id" = "judge_decisions"."battle_id")))));



ALTER TABLE "public"."drivers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "drivers_delete" ON "public"."drivers" FOR DELETE TO "authenticated" USING ("public"."is_director"("competition_id"));



CREATE POLICY "drivers_insert" ON "public"."drivers" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_director"("competition_id"));



CREATE POLICY "drivers_select" ON "public"."drivers" FOR SELECT TO "authenticated" USING ("public"."is_competition_member"("competition_id"));



CREATE POLICY "drivers_update" ON "public"."drivers" FOR UPDATE TO "authenticated" USING ("public"."is_director"("competition_id")) WITH CHECK ("public"."is_director"("competition_id"));



ALTER TABLE "public"."judge_calls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."judge_decisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "members_insert" ON "public"."members" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND ("public"."is_director"("competition_id") OR (NOT (EXISTS ( SELECT 1
   FROM "public"."members" "x"
  WHERE ("x"."competition_id" = "members"."competition_id")))))));



CREATE POLICY "members_select" ON "public"."members" FOR SELECT TO "authenticated" USING (("public"."is_competition_member"("competition_id") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "members_update_director" ON "public"."members" FOR UPDATE TO "authenticated" USING ("public"."is_director"("competition_id")) WITH CHECK ("public"."is_director"("competition_id"));



ALTER TABLE "public"."official_rulings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."presence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "presence_insert" ON "public"."presence" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_competition_member"("competition_id")));



CREATE POLICY "presence_select" ON "public"."presence" FOR SELECT TO "authenticated" USING ("public"."is_competition_member"("competition_id"));



CREATE POLICY "presence_update" ON "public"."presence" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "qualifying_insert" ON "public"."qualifying_runs" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_competition_member"("competition_id"));



ALTER TABLE "public"."qualifying_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "qualifying_select" ON "public"."qualifying_runs" FOR SELECT TO "authenticated" USING ("public"."is_competition_member"("competition_id"));



CREATE POLICY "qualifying_update" ON "public"."qualifying_runs" FOR UPDATE TO "authenticated" USING ("public"."is_competition_member"("competition_id"));



CREATE POLICY "rulings_insert" ON "public"."official_rulings" FOR INSERT TO "authenticated" WITH CHECK ((("decided_by" = "public"."my_member_id"(( SELECT "battles"."competition_id"
   FROM "public"."battles"
  WHERE ("battles"."id" = "official_rulings"."battle_id")))) AND "public"."is_director"(( SELECT "battles"."competition_id"
   FROM "public"."battles"
  WHERE ("battles"."id" = "official_rulings"."battle_id")))));



CREATE POLICY "rulings_select" ON "public"."official_rulings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."battles" "b"
  WHERE (("b"."id" = "official_rulings"."battle_id") AND "public"."is_competition_member"("b"."competition_id")))));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_rejoin_code"("p_competition_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_rejoin_code"("p_competition_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_rejoin_code"("p_competition_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_rejoin_code"("p_competition_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_competition_member"("cid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_competition_member"("cid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_competition_member"("cid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_director"("cid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_director"("cid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_director"("cid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."join_competition"("p_join_code" "text", "p_display_name" "text", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."join_competition"("p_join_code" "text", "p_display_name" "text", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_competition"("p_join_code" "text", "p_display_name" "text", "p_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."join_competition_by_code"("p_code" "text", "p_display_name" "text", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."join_competition_by_code"("p_code" "text", "p_display_name" "text", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_competition_by_code"("p_code" "text", "p_display_name" "text", "p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_member_id"("cid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_member_id"("cid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_member_id"("cid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."register_driver"("p_registration_code" "text", "p_name" "text", "p_team_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."register_driver"("p_registration_code" "text", "p_name" "text", "p_team_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_driver"("p_registration_code" "text", "p_name" "text", "p_team_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rejoin_driver"("p_rejoin_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rejoin_driver"("p_rejoin_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rejoin_driver"("p_rejoin_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rejoin_driver"("p_rejoin_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rejoin_judge"("p_rejoin_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rejoin_judge"("p_rejoin_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rejoin_judge"("p_rejoin_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rejoin_judge"("p_rejoin_code" "text") TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."battles" TO "anon";
GRANT ALL ON TABLE "public"."battles" TO "authenticated";
GRANT ALL ON TABLE "public"."battles" TO "service_role";



GRANT ALL ON TABLE "public"."competitions" TO "anon";
GRANT ALL ON TABLE "public"."competitions" TO "authenticated";
GRANT ALL ON TABLE "public"."competitions" TO "service_role";



GRANT ALL ON TABLE "public"."drivers" TO "anon";
GRANT ALL ON TABLE "public"."drivers" TO "authenticated";
GRANT ALL ON TABLE "public"."drivers" TO "service_role";



GRANT ALL ON TABLE "public"."judge_calls" TO "anon";
GRANT ALL ON TABLE "public"."judge_calls" TO "authenticated";
GRANT ALL ON TABLE "public"."judge_calls" TO "service_role";



GRANT ALL ON TABLE "public"."judge_decisions" TO "anon";
GRANT ALL ON TABLE "public"."judge_decisions" TO "authenticated";
GRANT ALL ON TABLE "public"."judge_decisions" TO "service_role";



GRANT ALL ON TABLE "public"."members" TO "anon";
GRANT ALL ON TABLE "public"."members" TO "authenticated";
GRANT ALL ON TABLE "public"."members" TO "service_role";



GRANT ALL ON TABLE "public"."official_rulings" TO "anon";
GRANT ALL ON TABLE "public"."official_rulings" TO "authenticated";
GRANT ALL ON TABLE "public"."official_rulings" TO "service_role";



GRANT ALL ON TABLE "public"."presence" TO "anon";
GRANT ALL ON TABLE "public"."presence" TO "authenticated";
GRANT ALL ON TABLE "public"."presence" TO "service_role";



GRANT ALL ON TABLE "public"."qualifying_runs" TO "anon";
GRANT ALL ON TABLE "public"."qualifying_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."qualifying_runs" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







