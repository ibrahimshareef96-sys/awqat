@AGENTS.md

## For Claude Code

- Start with `npm ci`, then `npm run typecheck` and `npm test` to see the tree is green before changing anything.
- Before a change touches the mushaf, recitation or adhkar, re-read ground rule 1 in AGENTS.md: no Quran text in any
  file you write, tests included.
- Run the full suite and the build before saying a change is done, and say what you could not check (a real device,
  the iOS widgets, a microphone).
- Never commit files under `dist/`, model files, the Tanzil text, keystores or `.env.local`.
