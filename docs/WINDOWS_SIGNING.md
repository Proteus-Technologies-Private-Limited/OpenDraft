# Windows Code Signing

This guide covers how to set up free Windows EXE/MSI code signing for OpenDraft releases.

---

## Why sign?

Unsigned Windows executables trigger SmartScreen warnings ("Windows protected your PC") and may be flagged by antivirus software. Code signing:

- Eliminates SmartScreen "unknown publisher" warnings (with a trusted certificate)
- Builds download reputation over time
- Proves the binary hasn't been tampered with

---

## How it works

The GitHub Actions release workflow (`.github/workflows/release.yml`) automatically signs Windows builds when the required secrets are configured:

1. **Certificate import** — decodes the base64 PFX from `WINDOWS_CERTIFICATE` secret and imports it into the Windows certificate store
2. **Tauri signing** — patches `tauri.conf.json` with the certificate thumbprint so Tauri's NSIS and WiX bundlers sign all executables during packaging
3. **Timestamping** — uses DigiCert's timestamp server so signatures remain valid after the certificate expires

If no certificate is configured, builds proceed unsigned (current default behavior).

---

## Automated prerequisites

The Windows installer automatically handles common issues that previously required manual intervention:

1. **Windows Defender exclusion** — added to the install directory *before* files are copied, preventing Defender from quarantining sidecar DLLs during installation
2. **Visual C++ Redistributable** — checked and silently installed if missing (Python 3.12 requires VC++ 2015-2022 runtime)
3. **Per-machine install** — installs to `C:\Program Files\OpenDraft\` (elevated), which is less likely to be flagged by security software than user-profile directories

These are implemented via NSIS installer hooks (`src-tauri/nsis-hooks.nsh`) and the `perMachine` install mode in `tauri.conf.json`.

---

## Getting a free certificate

### Option 1: SignPath Foundation (recommended for open-source)

[SignPath Foundation](https://signpath.org) provides **free code signing certificates** for qualifying open-source projects. They verify your binary was built from your open-source repository and sign it with their trusted certificate — no personal identification required.

**What you get:**
- Trusted code signing certificate (stored on their HSM — you never handle private keys)
- Automatic verification that binaries match your source repository
- CI/CD integration with GitHub Actions
- Trusted by Windows SmartScreen

**How to apply:**
1. Review the eligibility requirements at https://signpath.org/terms.html
2. Go to https://signpath.org/apply
3. Download the application form (`OSSRequestForm-v4.xlsx`)
4. Fill it out with your project details
5. Email the completed form to **oss-support@signpath.org**
6. SignPath evaluates your application and contacts you

**Eligibility requirements:**
- OSI-approved open-source license (MIT, Apache, GPL, etc.) — no commercial dual-licensing
- Project must be actively maintained and already released
- No malware or potentially unwanted programs
- No proprietary components (except system libraries)
- Must publish a code signing policy on your project homepage

### Option 2: Certum Open Source Code Signing

[Certum](https://www.certum.eu/) offers code signing certificates at reduced cost for open-source developers.

1. Visit https://www.certum.eu/open-source-code-signing/
2. Apply with your open-source project details
3. Receive a code signing certificate (typically valid for 1-3 years)
4. Export as PFX for use with GitHub Actions

### Option 3: Self-signed certificate (testing only)

For testing the signing pipeline without a trusted CA certificate. **Users will still see SmartScreen warnings** with self-signed certificates.

Generate a self-signed code signing certificate:

```powershell
# Run in PowerShell on Windows
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=OpenDraft, O=Proteus Technologies" `
  -CertStoreLocation Cert:\CurrentUser\My `
  -NotAfter (Get-Date).AddYears(3)

# Export as PFX
$password = ConvertTo-SecureString -String "your-password-here" -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath "opendraft-signing.pfx" -Password $password
```

---

## Configuring GitHub secrets

Once you have a PFX certificate file, add these secrets to the GitHub repository:

### 1. WINDOWS_CERTIFICATE

Base64-encode the PFX file and store it as a secret:

```bash
# macOS / Linux
base64 -i opendraft-signing.pfx | tr -d '\n'

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("opendraft-signing.pfx"))
```

Go to **GitHub repo > Settings > Secrets and variables > Actions > New repository secret**:
- Name: `WINDOWS_CERTIFICATE`
- Value: the base64 string from above

### 2. WINDOWS_CERTIFICATE_PASSWORD

- Name: `WINDOWS_CERTIFICATE_PASSWORD`
- Value: the password used when exporting the PFX file

---

## Verifying signed builds

After a release with signing configured:

```powershell
# Check signature on the installer
Get-AuthenticodeSignature "OpenDraft_*_x64-setup.exe"

# Or using signtool
signtool verify /pa "OpenDraft_*_x64-setup.exe"
```

A properly signed binary shows:
- `StatusMessage: Signature verified` (signtool)
- `Status: Valid` (PowerShell)
- Publisher name matching the certificate subject

---

## Troubleshooting

### "SignTool not found" in CI

The `windows-latest` GitHub Actions runner includes Windows SDK with `signtool.exe`. If this fails, ensure the runner image hasn't changed. Tauri automatically locates `signtool.exe` in standard SDK paths.

### "Certificate chain not trusted"

Self-signed certificates aren't trusted by default. For production releases, use a certificate from a trusted CA (SignPath, Certum, or another CA).

### SmartScreen still warns despite signing

With OV (Organization Validated) certificates, SmartScreen reputation builds over time with download volume. EV (Extended Validation) certificates provide instant SmartScreen trust but are more expensive. SignPath's OSS program typically provides OV certificates.
