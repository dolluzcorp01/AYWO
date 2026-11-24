-- PR 53: the bell does not start at "99+".
--
-- Notifications were saved for months before the app had a list to show them in (0041), and none of them was ever
-- marked read. On the first open after that update every one of them counted as new. Everything from before this
-- runs is taken as seen; news from now on counts as usual. Chat messages keep their own unread numbers.

update notifications set read_at = now() where read_at is null and kind <> 'chat_message';
