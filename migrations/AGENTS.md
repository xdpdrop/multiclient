# Migrations (`migrations/`)

Additive SQLite migrations applied by numeric version inside a transaction. Version numbers need not be contiguous (there is no `006`). Current highest version is 9.

Do not rewrite applied migration history. New schema changes add a new numbered SQL file.
