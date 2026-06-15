# Deploy-Sicherheit

## Aktueller Stand (2026-06-15)
- Produktion deployt von Branch **`main`** auf Railway.
- In Railway ist **„Wait for CI" deaktiviert** (es hing wiederholt und verhinderte Deploys grüner Commits). **Folge: jeder Push auf `main` geht SOFORT live — ohne CI-Gate davor.**

## Schutz: lokales Pre-Push-Gate
Damit kein kaputter Code ungeprüft live geht, gibt es einen Git-Hook
`.githooks/pre-push`. Vor jedem Push auf `main` laufen automatisch:
- Backend-Tests (`npm test --prefix backend`)
- Frontend-Typecheck (`tsc -b`)
- Frontend-Unit-Tests (`vitest run`)

Schlägt etwas fehl → Push wird abgebrochen.

**Einmalig aktivieren** (pro Klon):
```bash
git config core.hooksPath .githooks
```

**Notausstieg** (mit Bedacht): `git push --no-verify`

> Playwright-E2E läuft im Hook NICHT (zu langsam). Bei größeren UI-Änderungen
> vorher manuell: `cd frontend-react && npx playwright test`.

## Empfohlene Ausbaustufen (optional, später)
1. **Staging-Service**: zweiter Railway-Service auf Branch `develop` mit eigener
   (Test-)DB. Erst auf Staging testen, dann `develop → main` mergen.
2. **„Wait for CI" wieder aktivieren**, sobald der Hänger geklärt ist
   (GitHub-Actions-Suite ist grün; das Problem lag an Railways CI-Erkennung,
   nicht an den Tests). Dann ist das Cloud-CI wieder das Gate vor Prod.
