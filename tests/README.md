# Verification

These tools are for development. End users run `RDAscraper.exe`; they do not install Node, Python, Playwright or a separate OCR engine.

## Install development dependencies

Use Go 1.27.1 and Node.js 24.x, at least 24.3. From the repository root:

```sh
go mod download
go mod verify
npm ci
```

Keep `package-lock.json` and `go.sum` with the source. Do not replace `npm ci` with an unreviewed dependency upgrade when reproducing a release.

## Automated checks

| Command | Scope |
| --- | --- |
| `go test -buildvcs=false -count=1 -v ./...` | Local API authorization, request destination checks, redirects/proxy handling, project persistence, reset and engine lifecycle regression cases |
| `go vet ./...` | Go static checks |
| `npm test` | Core logic, synthetic news parsing, jsdom UI interactions, restart handling and synthetic document extraction |
| `npm run test:security` | Untrusted project validation, DOM injection regression and PDF resource/security regression cases |
| `npm run test:ocr` | Korean PNG and scanned PDF OCR, keyword agreement and cancellation using local models |
| `npm run test:browser` | Integration test using the supplied local engine binary and real Chromium |

Node OCR and jsdom checks do not by themselves verify browser content security policy or native Windows operation. The separate Chromium integration test exercises the real browser rather than jsdom. A Windows CI run still does not cover every end-user Edge version, proxy policy or security product.

## Real browser integration

The harness starts the binary selected by `RDA_TEST_BINARY`, uses a temporary data directory and an automatically chosen local port, and waits for the readiness output. No pre-existing user project is used.

On Linux:

```sh
go build -buildvcs=false -o /tmp/rdascraper-test .
npx playwright install --with-deps chromium
RDA_TEST_BINARY=/tmp/rdascraper-test npm run test:browser
```

On Windows PowerShell:

```powershell
.\build_windows.ps1
npx playwright install chromium
$env:RDA_TEST_BINARY = (Resolve-Path 'dist/RDAscraper.exe').Path
npm run test:browser
```

Browser installation is only for developers and CI. The released application uses the browser already installed on the user's PC.

## Synthetic input data

The public package contains seven synthetic HWP/HWPX/PDF documents and two synthetic OCR inputs. It contains no original contact-bearing press-release fixtures, original preview images or prior live-news collection results.

Two HWP and three HWPX fixtures intentionally contain the minimal structures used by the extraction parser. They test controlled parser behavior, not complete Hancom editor compatibility. The two text PDFs are ordinary PDFs; the OCR pair is generated from a synthetic document. No original document is used as a template or input.

`synthetic_fixture_manifest.json` describes the supplied fixtures. `document_validation.json` and `ocr_validation.json` record synthetic extraction results and may be rewritten by tests. DOM tests may create synthetic PDFs under `tests/artifacts/`; OCR tests create `tests/ocr/*.result.json`. These temporary outputs are excluded from public source packaging.

To regenerate fixtures, developers can run `python3 tests/generate_synthetic_fixtures.py` with ReportLab, Poppler and a suitable Korean font installed. Regeneration is optional and is not needed to run the included tests.

## CI and recorded results

The GitHub workflow runs Linux regression and Chromium tests, then Windows Go tests, build and Chromium integration, before uploading Windows files. The workflow is prepared configuration; creating this package did not execute a remote GitHub Actions run.

Use [the release validation record](../docs/VALIDATION_KO.md) for tests actually performed on this package and for remaining platform limitations. Historical audit results are not current pass/fail evidence. The security fixes and their regressions are evaluated against the current source.

## Live public news and native Windows verification

`tests/live_browser_test.mjs` is separate from the controlled, synthetic-news browser test. It uploads the included synthetic HWPX, searches the public term `농촌진흥청` over the last 90 days, requires a real news result with a fetched original title/date/body, opens its source link, and downloads the review-list PDF. It does not intercept, replay, or substitute network responses. An empty search or failed original-page verification fails the test and records the actual error.

On a native Windows development PC, after `npm ci` and building the executable:

```powershell
.\tests\windows_e2e.ps1 -Binary .\dist\RDAscraper.exe
```

The live check uses installed Microsoft Edge. Add `-Headed` to watch it. It uses a temporary data directory and does not open the user's saved project. Node/Playwright are developer test dependencies only; running the released application requires neither. `RDA_BROWSER_EXECUTABLE` can select an existing browser executable for a developer check. The wrapper does not install tools or change browser security policy.

For a Linux developer check of the same live flow:

```sh
RDA_TEST_BINARY=/absolute/path/to/rdascraper node tests/live_browser_test.mjs
```

Evidence is written under `tests/artifacts/live_browser/`: `validation.json`, screenshots and, when successful, the downloaded PDFs. The JSON records the OS, whether it is a Windows process, browser version, tested binary SHA-256, each step, real fetch outcomes, and the chosen public article. It does not retain the input token or a user project. Linux results must not be described as native Windows results. A successful controlled synthetic-news test is also not evidence that public search worked.

The separate **Windows live news verification** workflow can be run manually after the source is in GitHub. It builds and starts the EXE on `windows-2025`, uses Edge, and preserves success or failure evidence. Merely including the workflow in a ZIP does not execute it. Provider restrictions on datacenter traffic may make that live run fail; no bypass or fabricated success is applied. Review the recorded result before making a Windows/live-search claim.


## Larger-font rendering

After `npm run test:browser` creates the synthetic saved-project fixture, run `npm run test:appearance` with the same `RDA_TEST_BINARY` and optional `RDA_BROWSER_EXECUTABLE`. The test checks all 12 combinations of three text sizes and four viewport widths, actual bundled Noto font loading, minimum text size, page overflow and persistence after reload. Screenshots and evidence are in `tests/artifacts/appearance/`.
