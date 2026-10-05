# Security

Security over speed. Current state: design only plus pure-math code; no network surface exists yet.

Rules: no seed phrases or private keys requested, stored, or logged; no secrets in the frontend; secrets via env (see `.env.example`), RPC keys server-side; parameterized SQL; zod validation on all inputs; rate limiting; CSRF protection; strict CSP; signature verification with replay protection; simulate and summarize every transaction before signing.

Admin powers: not yet implemented. When built, each role and its exact powers are listed here, every sensitive action is written to `audit_logs` with reason, and there is no undocumented super-admin.

Reporting vulnerabilities: contact channel TBD before beta.
