-- 0019: the health card is kept and shown to SOS helpers only with agreement to the notice; withdrawing deletes it;
-- every agreement and withdrawal is on record; "My consents" shows it all.
begin;
create extension if not exists pgtap;
select plan(26);

insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner17@test.local', '+919811800001', now()),
  ('00000000-0000-0000-0000-0000000000c2', 'helper17@test.local', '+919811800002', now()),
  ('00000000-0000-0000-0000-0000000000c3', 'old17@test.local', '+919811800003', now());

create function test_login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
grant execute on function test_login(uuid) to authenticated;
-- Test only: how many cards someone has, readable while logged in as a user.
create function t_cards(p uuid) returns int language sql security definer as $$ select count(*)::int from emergency_cards where profile_id = p $$;
create function t_events(p uuid, k text) returns text[] language sql security definer as $$
  select array_agg(action order by id) from consent_events where profile_id = p and kind = k $$;
grant execute on function t_cards(uuid), t_events(uuid, text) to authenticated;

-- A card saved before this release, with no agreement on record.
insert into emergency_cards (profile_id, blood_group) values ('00000000-0000-0000-0000-0000000000c3', 'O+');

-- SOS events: the owner's and the old card's, both reaching the helper.
insert into sos_events (id, profile_id, ends_at, token_hash, write_hash) values
  ('40000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', now() + interval '1 hour', 't17a', 'w17a'),
  ('40000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c3', now() + interval '1 hour', 't17c', 'w17c');
insert into sos_event_contacts (event_id, position, contact_profile_id) values
  ('40000000-0000-0000-0000-0000000000c1', 0, '00000000-0000-0000-0000-0000000000c2'),
  ('40000000-0000-0000-0000-0000000000c3', 0, '00000000-0000-0000-0000-0000000000c2');

select test_login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select emergency_card_save('{"blood_group": "B+"}') $$, 'PT403', 'consent_needed', 'no saving health details without agreeing');
select is(t_cards('00000000-0000-0000-0000-0000000000c1'), 0, 'and nothing was kept');
select throws_ok($$ select emergency_card_save('{"blood_group": "B+"}', '2020-01') $$, 'PT409', 'consent_outdated', 'agreeing to an old notice is not enough');
select is(emergency_card_save('{"blood_group": "B+", "allergies": "Penicillin"}', health_notice_version()) ->> 'blood_group', 'B+', 'saving with agreement works');
select is((my_consents() -> 'items' -> 2 ->> 'agreed_version'), health_notice_version(), 'My consents shows the agreement');
select ok((my_consents() -> 'items' -> 2 ->> 'current')::boolean, 'to the current notice');
select is(emergency_card_save('{"blood_group": "AB+", "allergies": "Penicillin"}') ->> 'blood_group', 'AB+', 'later saves need no new agreement');
select is((select count(*)::int from consent_events where profile_id = '00000000-0000-0000-0000-0000000000c1' and kind = 'health_card'), 1, 'one agreement on record, not one per save');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c2');
select is(sos_emergency_card('40000000-0000-0000-0000-0000000000c1') ->> 'blood_group', 'AB+', 'the helper sees an agreed card during the SOS');
select is(sos_emergency_card('40000000-0000-0000-0000-0000000000c3'), null, 'a card saved before agreement stays hidden');
select throws_ok($$ insert into consent_events (profile_id, kind, version, action) values ('00000000-0000-0000-0000-0000000000c1', 'health_card', 'x', 'withdrawn') $$,
  '42501', null, 'nobody can write someone else''s consent record directly');
select is((select count(*)::int from consent_events where profile_id = '00000000-0000-0000-0000-0000000000c1'), 0, 'or read it');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c1');
select is(emergency_card_delete() ->> 'ok', 'true', 'withdrawing is one call');
select is(t_cards('00000000-0000-0000-0000-0000000000c1'), 0, 'withdrawing deletes the card');
select is((my_consents() -> 'items' -> 2 ->> 'agreed_version'), null, 'My consents shows it withdrawn');
select is(t_events('00000000-0000-0000-0000-0000000000c1', 'health_card'),
  array['granted', 'withdrawn'], 'both the agreement and the withdrawal stay on record');
select throws_ok($$ select emergency_card_save('{"blood_group": "B+"}') $$, 'PT403', 'consent_needed', 'after withdrawing, saving needs agreement again');
reset role;

select test_login('00000000-0000-0000-0000-0000000000c2');
select is(sos_emergency_card('40000000-0000-0000-0000-0000000000c1'), null, 'helpers no longer see it');
reset role;

-- The old card's owner agrees: it shows again.
select test_login('00000000-0000-0000-0000-0000000000c3');
select is(emergency_card_save('{"blood_group": "O+"}', health_notice_version()) ->> 'blood_group', 'O+', 'an old card can be agreed to');
reset role;
select test_login('00000000-0000-0000-0000-0000000000c2');
select is(sos_emergency_card('40000000-0000-0000-0000-0000000000c3') ->> 'blood_group', 'O+', 'and then helpers see it');
reset role;

-- Terms, privacy and marketing.
select test_login('00000000-0000-0000-0000-0000000000c1');
select consent_accept('terms', '2026-08');
select consent_accept('terms', '2026-08');
select is((select count(*)::int from consent_events where profile_id = '00000000-0000-0000-0000-0000000000c1' and kind = 'terms'), 1, 'agreeing to the same terms twice is one record');
select is((my_consents() -> 'items' -> 0 ->> 'agreed_version'), '2026-08', 'My consents shows the terms version');
select is(marketing_set(true) ->> 'marketing_opt_in', 'true', 'marketing on');
select is(marketing_set(false) ->> 'marketing_opt_in', 'false', 'marketing off');
select is(t_events('00000000-0000-0000-0000-0000000000c1', 'marketing'),
  array['granted', 'withdrawn'], 'marketing choices are on record');
select is(jsonb_array_length(my_consents() -> 'history'), 5, 'the history lists every agreement and withdrawal (health 2, terms 1, marketing 2)');
reset role;

select * from finish();
rollback;
