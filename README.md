# CivProj

A working first release for civil and construction **cost control, approvals, and stakeholder reporting**, built with Python/FastAPI and React/TypeScript. AED is the default project currency. The interface supports English, Arabic, and Farsi, including right-to-left layouts, local numerals, dates, and currency formatting.

For browser-only access without installing programming tools, see [Cloud hosting](docs/cloud-hosting.md). The included Render Blueprint builds and hosts both the UI and API with persistent storage; deployment requires a hosting account and approval of the host's charges.

To evaluate the interface without any backend, [demo/index.html](demo/index.html) is a self-contained interactive preview. It uses fictional in-memory data and resets on reload; it is separate from the real Python application. See [preview details](demo/README.md).

## Run locally

Requires Python 3.12+, Node.js 22.12+ (Node 24 recommended), npm, and a Linux/macOS shell.

```bash
bash scripts/setup.sh
# Optional: create an explicitly labeled sample organization and local demo accounts.
cd backend
../.venv/bin/python -m app.seed --demo
cd ..
bash scripts/dev.sh
```

The web server listens on port **5173**, and proxies `/api` to FastAPI on **8000**. Use the web server in your local browser. Stop both with Ctrl+C. The database is initialized automatically; no cloud service, API key, or external database is needed for development. Fonts are bundled locally.

To start without sample data, skip the seed command and use **Create workspace**. Registering creates your organization and a CEO membership. An existing account can belong to multiple organizations. CEOs add registered users from **People & access**, with a role and customer project assignments.

The optional demo uses `ceo@civproj.demo`, `cfo@civproj.demo`, `cto@civproj.demo`, `manager@civproj.demo`, `accountant@civproj.demo`, and `customer@civproj.demo`, all with the deliberately public password **`Demo2026!`**. These accounts are created only by the explicit seed command. Re-running it preserves existing sample data. Keep sample accounts and their database out of production. The customer sees one assigned project; internal demo staff see three AED projects.

## Available workflows

- Separate organization workspaces, projects, and per-project currencies: AED, SAR, USD, EUR, IRR. No implicit currency conversion or mixed-currency totals.
- Audited budget allocations for seven construction cost codes.
- Detailed commitments, invoices, and payments with supplier, reference, description, quantity, unit of measure (each, lump sum, m/m²/m³, kg/tonne, hour/day), unit price, accounting date, invoice tax, and retention.
- Linked purchase commitments → invoices → payments, with project and supplier validation and duplicate supplier references blocked per project and record type.
- Pending → approved/rejected decisions, requiring a different CEO or CFO from the submitter. Rejected records remain visible. Submitted financial data cannot be edited or deleted through the API.
- Integer minor-unit storage and Python `Decimal` calculations, with explicit half-up rounding. Payments and linked invoices reserve balances while pending; transactions serialize capacity checks to prevent concurrent over-allocation.
- Monthly charts based on actual approved records, budget/exposure summaries, a searchable cost register, CSV reports, and printable project summaries.
- Append-only audit events for setup, budgets, financial submissions, decisions, and membership additions. The interface shows the latest 500 project events; the database retains all events.

| Role | Access |
| --- | --- |
| CEO | All organization projects, budgets, submissions, approvals, audit, reports, and membership additions |
| CFO | All organization projects, budgets, submissions, approvals, audit, reports, and member list |
| Project manager | All organization projects, budgets, submissions, audit, and reports |
| Accountant | All organization project financial records, submissions, audit, and reports |
| CTO | Read-only internal project records, audit, and reports |
| Customer | Summary dashboards and reports for explicitly assigned projects; no supplier register, approvals, membership list, or audit |

These permissions are enforced by the API. Internal roles are organization-wide; the customer role is also restricted by project grants.

## Financial definitions

```text
Net invoice       = round(quantity × unit price, currency precision)
Tax               = round(net × entered tax rate / 100)
Gross invoice     = net + tax
Retention         = round(gross invoice × retention rate / 100)
Actual cost       = approved gross invoices
Paid              = approved payments
Payable balance   = actual cost − retained amounts − paid
Open commitments  = approved commitments − approved invoices linked to them
Cost exposure     = actual cost + open commitments
Budget headroom   = current budget − cost exposure
```

Commitments use gross face value including expected tax; invoice unit prices are net. Payments have no additional tax or retention. Only approved records affect reports; pending records reserve linked capacity. Exposure measures recorded obligations, **not an estimate at completion**: it does not predict uncommitted future work. Budget revisions are directly authorized role actions, recorded with before/after amounts and a reason.

Tax is manually specified per invoice (the UI initially suggests 5%). This is not a statutory UAE/GCC tax calculation, recoverable VAT ledger, or filing system. Accounting dates use the Gregorian calendar; Farsi displays use the locale’s calendar. Each invoice currently contains one cost line, with partial invoicing and partial payment supported through multiple linked records.

## Verify

```bash
cd backend
../.venv/bin/python -m pytest -q
cd ../frontend
npm run build
npm test
```

Browser tests use an isolated `.local/e2e.sqlite3` demo database and start their own servers on ports 8011/5174. They use `/usr/bin/chromium` by default. Set `CHROMIUM_PATH` to an installed Chromium executable on other systems. Browser coverage includes financial submission and approval across roles, project creation, budgets, membership, customer restrictions, report downloads, Arabic/Farsi layouts, and mobile rendering.

Python tests exercise real API requests and SQLite transactions, including exact rounding, tenant/project isolation, role enforcement, self-approval rejection, payment caps and concurrent spending attempts, rejected-payment balance release, audit protection, CSV injection protection, and session logout.

`backend/requirements.lock` and `frontend/package-lock.json` capture installed dependency versions. `backend/requirements.txt` lists direct Python dependencies. After intentionally changing Python dependencies, regenerate the lock from a clean environment. Configuration variables are documented in [.env.example](.env.example).

## Boundaries and next stages

This is a local development foundation, not a completed construction ERP or certified accounting system. Planned work and production requirements are described in [docs/product-and-architecture.md](docs/product-and-architecture.md). Scheduling and site operations remain a next-stage module, following the chosen costs/approvals/reporting priority.
