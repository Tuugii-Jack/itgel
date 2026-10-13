# Itgel project notes

Keep the Obsidian vault in `docs/obsidian/Itgel` current whenever changing the site.
Update the relevant workflow, permissions, payments or deployment note and append
the concrete change plus validation to `12 Өөрчлөлтийн түүх.md`. Keep
`00 Итгэл — Сайтын тэмдэглэл.md` as the entry point. Record incomplete checks and
limitations accurately. Never store credentials, tokens, real customer contact
details, bank account credentials or production database dumps in these notes.
Run `node scripts/sync-obsidian.mjs` to update the Itgel folder in the user's
Obsidian vault. If the script detects a note edited in Obsidian, read and merge
that edit into the repository note before syncing; do not overwrite it silently.

The user's latest payment rule (2026-10-13) supersedes earlier notes: manual
incoming bank payments are registered only by the ADMIN role. LEASING, STAFF,
CUSTOMER and OWNER do not have that permission unless the human changes this
rule. Customer QPay flows, the two merchant accounts and existing unrelated
actions must continue to work. Check permission on the server, not only in UI.

Read `frontend/AGENTS.md` before frontend changes.
