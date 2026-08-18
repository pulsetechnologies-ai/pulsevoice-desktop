# macOS code signing & notarization

The macOS build ships **unsigned** until the secrets below exist. CI turns
signing and notarization on automatically the moment `MAC_CSC_LINK` is present —
there is no code change to make once you have the certificate.

Until then, macOS shows users **"PulseVoice is damaged and can't be opened."**
That is Gatekeeper blocking an unsigned quarantined app, not a corrupt download.

## What you need from Apple

Exactly one certificate: a **Developer ID Application** certificate.

You do **not** need any of these — they are App Store concepts and don't apply to
direct distribution:

- an App ID / bundle ID registration for `ai.pulsevoice.desktop`
- a provisioning profile
- an App Store Connect app record

Two constraints worth knowing before you start:

- Only the **Account Holder** can create a Developer ID certificate. An Admin
  cannot.
- There is a hard cap of **5** Developer ID Application certificates per account,
  and they last 5 years. Don't burn attempts casually.

The Apple Developer account is active: **Team ID `75FN84AXGQ`**.

## Creating the certificate without a Mac

Apple's docs assume you generate the CSR in Keychain Access. `openssl` does the
same job on Windows — the commands below are for **Git Bash**.

### 1. Generate a private key and CSR

```bash
openssl genrsa -out devid.key 2048
MSYS_NO_PATHCONV=1 openssl req -new -key devid.key -out devid.csr \
  -subj "/emailAddress=aaron@pulsetechnologies.ai/CN=Pulse Payments LLC/C=US"
```

> **`MSYS_NO_PATHCONV=1` is required on Git Bash.** Without it MSYS rewrites the
> leading `/` of `-subj` into a Windows path and openssl rejects it with
> `This name is not in that format: 'C:/Program Files/Git/emailAddress=...'`.

Confirm it looks right:

```bash
openssl req -in devid.csr -noout -subject
```

**Keep `devid.key`.** The certificate Apple issues is useless without it.

### 2. Upload the CSR

developer.apple.com → Certificates, Identifiers & Profiles → Certificates → **+**
→ **Developer ID Application** → upload `devid.csr` → download
`developerID_application.cer`.

### 3. Build the `.p12`

Apple returns only your leaf certificate, so fetch the intermediate as well or
signing fails later with a chain error:

```bash
curl -sO https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
openssl x509 -inform DER -in DeveloperIDG2CA.cer -out DeveloperIDG2CA.pem
openssl x509 -inform DER -in developerID_application.cer -out devid.pem
```

```bash
openssl pkcs12 -export \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -out devid.p12 -inkey devid.key -in devid.pem \
  -certfile DeveloperIDG2CA.pem \
  -name "Developer ID Application"
```

> **The three PBE flags are not optional.** OpenSSL 3 defaults to PBES2/AES-256,
> which macOS `security import` cannot read — CI fails with an opaque import
> error. `-legacy` also works but only if your build ships the legacy provider;
> the explicit flags always work.

Verify you get SHA1 + 3DES back:

```bash
openssl pkcs12 -in devid.p12 -nokeys -noout -info
# MAC: sha1, Iteration 2048
# PKCS7 Encrypted data: pbeWithSHA1And3-KeyTripleDES-CBC
```

### 4. Base64 for GitHub

```bash
base64 -w0 devid.p12 > devid.p12.b64
```

## Notarization credentials

Pick one path. CI prefers the API key when both are present.

**Path A — App Store Connect API key (recommended).** Not tied to a personal
login or 2FA. App Store Connect → Users and Access → Integrations → Keys → **+**,
role **Developer**. The `.p8` downloads **once** and cannot be retrieved again.

```bash
base64 -w0 AuthKey_XXXXXXXXXX.p8 > apikey.b64
```

**Path B — Apple ID + app-specific password.** Create the password at
appleid.apple.com (not the developer portal). Simpler, but breaks if revoked.

## Repository secrets

Add under Settings → Secrets and variables → Actions.

| Secret | Value | Needed for |
|---|---|---|
| `MAC_CSC_LINK` | contents of `devid.p12.b64` | signing (also the on/off switch) |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` export password | signing |
| `APPLE_API_KEY_B64` | contents of `apikey.b64` | notarization, path A |
| `APPLE_API_KEY_ID` | the key ID, e.g. `XXXXXXXXXX` | notarization, path A |
| `APPLE_API_ISSUER` | issuer UUID from the Keys page | notarization, path A |
| `APPLE_ID` | aaron@pulsetechnologies.ai | notarization, path B |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password | notarization, path B |
| `APPLE_TEAM_ID` | `75FN84AXGQ` | notarization, path B |

Then delete `devid.key`, `devid.p12`, `*.b64`, and the `.p8` from your machine,
or store them somewhere you'd keep a signing key.

## Shipping it

```bash
git tag v1.0.5 && git push origin v1.0.5
```

Watch the macOS job for:

```
• signing         file=dist/mac-universal/PulseVoice.app  identity=Developer ID Application
• notarizing      ...
```

⚠️ **A pull-request build never proves signing works.** electron-builder logs
`Current build is a part of pull request, code signing will be skipped` and skips
it regardless of secrets. Only a tag build exercises the signing path.

To confirm on a real Mac after release:

```bash
spctl -a -vvv -t install /Applications/PulseVoice.app   # expect: accepted, source=Notarized Developer ID
xcrun stapler validate /Applications/PulseVoice.app
```

## After the first notarized release

`/download` on the marketing site still says *"first launch may warn about an
unrecognized developer — choose Open anyway."* That becomes false once notarized,
and is already wrong on macOS 15+, where the right-click→Open bypass was removed
(users must go System Settings → Privacy & Security → Open Anyway).
