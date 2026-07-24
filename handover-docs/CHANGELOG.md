# Atlas Changelog

All notable changes to the Atlas project will be documented in this file.

## [Unreleased]
### Phase 0: Foundation Setup
- **Architecture**: Established strictly layered architecture (`db.js`, `auth.js`, `entities/`, `pages/`, `components/`).
- **Database**: Created `migrations/001_init.sql` defining 9 core tables (`atlas_projects`, `atlas_tasks`, etc.) with UUIDs, `deleted_at` soft deletes, and RLS enabled.
- **Styling**: Locked Charcoal Muse (dark) and Paper Studio (light) design tokens in `Deploy/css/tokens.css`.
- **Theming**: Implemented single cycling button logic (Dark -> Auto -> Light -> Dark) via `Deploy/js/theme.js` and `Deploy/js/components/theme-switcher.js`.
- **Entities**: Generated empty shape/validation scaffolds for all 9 entities inside `Deploy/js/entities/`.
- **Deployment**: Finalized `.github/workflows/deploy-atlas.yml` mirroring the proven MilesWeb SSH target pattern (`atlas.abhisheksikka.com/`) with isolated deployment triggers.
- **Documentation**: Initialized `SCHEMA.md`, `ARCHITECTURE.md`, `FUTURE-CHANGES-CHECKLIST.md` and consolidated `plan.md` & `CLAUDE.md` into the `handover-docs/` folder.
- **Source Control**: Cleaned up branching structure, ensuring `main` is the primary and only tracking branch.
