-- PR 60: the staff second step locks after five wrong codes.
--
-- The six-digit authenticator code could be guessed without end, held back only by the limit on requests from one
-- address. Whoever holds a staff member's signed-in phone or session could keep trying. Five wrong codes in a row
-- now lock that staff account's second step for 15 minutes. A right code clears the count.

alter table admin_mfa add column wrong_tries smallint not null default 0;
alter table admin_mfa add column locked_until timestamptz;
