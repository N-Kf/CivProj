# Browser-only interactive demonstration

`index.html` is a self-contained evaluation of the CivProj interface, with
fictional data, bundled fonts, and in-memory financial workflows. It can be
served by a static HTML host. It starts in Farsi as the sample CFO; select another
language or stakeholder role in the toolbar. No hosting account is needed to
use an already published preview.

The preview supports project creation, budget revisions, detailed cost records,
linked invoices/payments, approval by another sample role, audit history, CSV
downloads, and customer summary views. Reloading discards all modifications.
It never sends login information, financial entries, or project information to
an API. Use fictional entries only.

This is a client-side demonstration, **not the deployed Python application**.
It does not provide real accounts, server-enforced access control, durable data,
real payments, or collaboration between users. The actual FastAPI/SQLite app and
its cloud deployment files remain separate and unchanged in purpose.

Regenerate from a fresh fictional fixture with:

```bash
.venv/bin/python scripts/export_demo_fixture.py
cd frontend
npm run build:demo
npm run test:demo
```

The fixture exporter creates a temporary database from `app.seed` and never
reads the development database. Password hashes and sessions are excluded.
The generated HTML is intentionally tracked so it can be served directly from
this public repository. The normal production build does not enable the demo
transport. See `frontend/vite.demo.config.ts`.

For a repository/CDN preview, rawgit.hack documents the URL format:
`https://rawcdn.githack.com/OWNER/REPOSITORY/COMMIT/demo/index.html`.
Use an immutable commit ID and verify the source file before sharing. The host
may show its standard **External Content Notice / Open the page** confirmation.
Hosting availability and regional access are outside this repository's control.
