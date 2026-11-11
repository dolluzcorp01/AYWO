-- 0013: row security on every public table, including admin_roles and schema_migrations.
begin;
create extension if not exists pgtap;
select plan(5);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0, 'every public table has row security on');

select ok((select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'admin_roles'), 'admin_roles has row security');
select ok((select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'schema_migrations'), 'schema_migrations has row security');

set local role authenticated;
select throws_ok('select * from public.admin_roles', '42501', null, 'a signed-in person cannot read admin_roles directly');
select throws_ok('select * from public.schema_migrations', '42501', null, 'a signed-in person cannot read schema_migrations');
reset role;

select * from finish();
rollback;
