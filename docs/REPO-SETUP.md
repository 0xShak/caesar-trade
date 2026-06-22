# GitHub repo — one-time setup (needs YOUR GitHub auth)

I couldn't create the GitHub repo autonomously: `gh` isn't installed in this
environment, there's no `GITHUB_TOKEN`/`GH_TOKEN`, and no git remote is set.
Creating + pushing requires your GitHub credentials. All work so far is committed
**locally** on branch `master` (nothing pushed). Run one of the options below when
you're ready.

> ⚠️ Make it **private**. This is an early-stage trading terminal. `.env` and
> `secrets/` are gitignored (verified), so no secrets are in the history — but the
> code is proprietary and pre-mainnet.

## Option A — GitHub CLI (easiest)
In this session, run with the `!` prefix (interactive login lands here):
```
! gh auth login            # if gh is installed; pick GitHub.com → HTTPS → browser/token
! gh repo create caesar-terminal --private --source=. --remote=origin --push
```
If `gh` isn't installed: `brew install gh` (mac) / see https://cli.github.com.

## Option B — create empty repo in the UI, then point me at it
1. Create a new **private** repo on github.com (no README/license/gitignore).
2. Give me the URL, or run:
```
! git remote add origin git@github.com:<you>/caesar-terminal.git
! git push -u origin master
```
(Use the `https://…` URL instead of `git@…` if you auth over HTTPS.)

## After it's pushed
- Default branch will be `master` (matches local history). Rename to `main` in
  GitHub settings if you prefer — tell me and I'll align local.
- Once a remote exists I can push future commits when you ask (I won't push
  without you asking).

## Current local state
- Branch `master`, all phases committed locally. `git log --oneline` shows the
  Phase 0/1/2/4 commits. `git status` is clean after the Phase 2 commits.
