# Release checklist

Every change follows the same path. **Nothing is pushed to `main`, tagged or
published until the candidate passes the full test run and a live smoke test.**

## 1. Work on a branch

```sh
git switch -c next/<topic>
```

## 2. Implement + bump

- client changes: edit `client-src/*.js`, then `npm run build:client`
  (never edit `client.js` by hand)
- host changes: bump `HOST_BUILD` in `host/main.js`
- bump `version` in `package.json` and add a `CHANGELOG.md` entry

## 3. Test locally (must all pass)

```sh
npm run check   # build freshness + syntax + dsh manifest + client id == package name
npm test        # host e2e (mock ComfyUI) + regression + client smoke
```

`npm test` runs `test/e2e.mjs`, `test/e2e2.mjs`, `test/client-smoke.mjs`.
For changes that touch real ComfyUI behaviour, also run the manual live smoke
against a running DSH:

```sh
$env:IW_LIVE_BASE = "http://127.0.0.1:<port>"
node test/live-smoke.mjs
```

`test/live-smoke.mjs` is intentionally excluded from CI (needs a running host).

## 4. Real-instance acceptance (before touching `main`)

Install the candidate locally and try it by hand:

- ComfyUI workflow mode: import/edit a workflow, generate, cancel, retry
- long run (> 5 min) is not killed by the API timeout
- two conversations with different workflows stay isolated (params **and** drafts)
- queue / cross-session task panel shows positions and cancels

Use a pre-release tag when you need to install a branch build:

```sh
git tag -a vX.Y.Z-rc.1 -m "candidate"
git push origin vX.Y.Z-rc.1
dsh plugin --profile web add github:LEAFCHINA/dsh-creation-workbench#vX.Y.Z-rc.1
```

## 5. Merge, tag, release

```sh
git switch main && git merge --ff-only next/<topic>
git push
# CI must be green (check + test suites)
git tag -a vX.Y.Z -m "..."
git push origin vX.Y.Z
gh release create vX.Y.Z --notes-file <notes>
```

## 6. Publish and update the local install

```sh
npm publish --access public            # only after the release is green
dsh plugin --profile web remove dsh-creation-workbench
dsh plugin --profile web add github:LEAFCHINA/dsh-creation-workbench
```

Verify: `ping` returns the new version/build; the client bundle build id matches;
existing data (workflows/settings/conversations) is intact.

## Rollback

Keep the previous tag. Reinstall it explicitly:

```sh
dsh plugin --profile web remove dsh-creation-workbench
dsh plugin --profile web add github:LEAFCHINA/dsh-creation-workbench#vPREV
```

Data written by a newer version is not downgraded automatically; the legacy data
directory (pre-2.0) stays available.
