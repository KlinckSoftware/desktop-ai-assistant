# Distributing to a few trusted people

The build is an **unsigned** Windows installer, so the goals when sharing are:
**authenticity** (it's really your build), **integrity** (untampered), **access
control** (not public), and **safe transit**. Pick the path that fits the audience.

## Option A — technical recipients: share the source

Best trust model — they build from code they can read, and there's no unsigned-binary problem.

1. Add them as collaborators on the **private** repo.
2. They:
   ```
   git clone <repo-url> && cd desktopAI
   npm install
   npm run dist:win      # or: npm run dev
   ```
3. Revoke their access when done.

## Option B — ship the binary: private release + checksum

1. Build: `npm run dist:win` → produces `release/Desktop AI Assistant-<ver>-setup.exe`
   and `release/SHA256SUMS.txt`.
2. Upload the `.exe` as an asset on a **private** GitHub Release (auth-gated), or put
   an **encrypted archive** (7-Zip AES-256, or `age`/GPG) on any cloud link.
3. **Send the SHA-256 over a different channel** than the file (Signal / text /
   phone) — e.g. the matching line from `SHA256SUMS.txt`.
4. Recipient verifies before running:
   ```powershell
   Get-FileHash ".\Desktop AI Assistant-<ver>-setup.exe" -Algorithm SHA256
   ```
   Must match the hash you sent. Then: run → SmartScreen **More info → Run anyway**
   (one-time, because unsigned).

Do **not** email the raw `.exe` or host it on a public URL.

### Stronger authenticity (optional, free)
Sign the hash with a key the recipient already trusts:
```
minisign -Sm release/SHA256SUMS.txt          # or: gpg --armor --detach-sign
```
They verify the signature → proves it's from you, not just unmodified.

### Kill the SmartScreen/AV warnings (optional, paid)
Buy an **Authenticode** code-signing certificate (EV gives instant SmartScreen
reputation), then point `build.win` at it so `electron-builder` signs the installer.
Worth it only if you distribute repeatedly / to non-technical users.

## What the recipient should know

- API keys are stored in the **OS keychain** (local-only); the app makes no network
  calls except to the AI providers you configure (+ a one-time price-table fetch).
  No telemetry.
- **No auto-update** is wired — updates are manual, so re-verify each new build's hash.
- Keep the safe defaults: isolation **on**, a **cost cap** set, autonomous shell
  **off** (see Settings → Security and the in-app Guide → Safety).
- CLI agents run their own tooling with full shell access governed by that tool's
  own permissions — treat them like running that CLI yourself.

## Releasing a new version

```
# bump version in package.json, commit
npm run dist:win                 # builds installer + SHA256SUMS.txt
gh release create v<ver> "release/Desktop AI Assistant-<ver>-setup.exe" \
  "release/SHA256SUMS.txt" --repo <owner>/<repo> --notes "…"   # private repo
```
Then share the SHA-256 out-of-band as above.
