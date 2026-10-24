# Use CivProj as a hosted website

No programming language, development tool, or executable needs to be installed
on users' computers. Users open the service's HTTPS address in a browser.

## Render deployment

The repository includes a Docker build and a Render Blueprint (`render.yaml`).
The blueprint selects a **paid Starter web service and a 1 GB persistent disk**.
Review Render's current service and disk pricing before authorizing deployment.
The service is intended for an initial evaluation of this development foundation;
the production work in `product-and-architecture.md` remains applicable.

1. The application source must first be saved to the GitHub repository. A local
   commit, ZIP, or Codex environment publication does not put it on GitHub.
2. Sign in at **https://dashboard.render.com** and connect the GitHub account
   that can access **N-Kf/CivProj**. Grant access only to this repository as needed.
3. Create a **Blueprint** from that repository. Select the branch containing
   `render.yaml` and the application code.
4. Review the proposed service, persistent disk, and charges. Deploy when you
   approve them. The Blueprint builds the React interface and Python backend;
   you do not enter shell commands or install Python on your computer.
5. When the service is live and its health check passes, open the HTTPS address
   shown on its Render service page. No public address exists before deployment.
6. Select **Create workspace** and create your own account and organization.
   The cloud image does not contain local demo accounts, sessions, or sample
   financial data. Add a second registered CEO/CFO so financial submissions
   can be reviewed by someone other than their submitter.

Render supplies `PORT` and `RENDER_EXTERNAL_URL`; the service uses these for its
listener and trusted browser origin. The UI and API share one HTTPS address.
Authentication cookies are secure and HttpOnly. Database writes go to the
persistent disk, not the container's replaceable filesystem. Automatic deployment
is disabled; deploy reviewed updates manually. Use one service instance/worker
with SQLite. Set up independent database backups before keeping important data;
a persistent disk is not a backup.

For a custom domain, set `CIVPROJ_PUBLIC_URL` to its exact HTTPS origin (without a
trailing slash). An alternative host must provide equivalent persistent storage,
HTTPS, this environment variable, and a runtime `PORT`. Do not use ephemeral
storage for the SQLite database.

## Verification before sharing

- Open the HTTPS URL and register an account; sign out and sign back in.
- Create a project and budget, then restart the service and confirm they remain.
- Add another registered approver, submit a cost, and approve it from the other
  account. Confirm reporting and audit history.
- Verify English, Arabic, and Farsi screens and customer project restrictions.

Building the container locally verifies the packaging only. It does not prove
Render deployment, persistent-disk attachment, TLS, domain configuration, or
backups. These require checks against the deployed service.
