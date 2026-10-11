# Deferred modules

This document lists functionality intentionally **not** implemented in the minimal development setup. The runnable development API is `backend/dev_server.py`; it only provides in-memory authentication, alerts, sources, and queued crawl-job records required by the current frontend.

## Deferred backend modules

| Module | Where it will be used | Related endpoint(s) | Expected input | Expected output |
| --- | --- | --- | --- | --- |
| Database and migrations | Production `backend/main.py` needs persistent users, sources, jobs, alerts, cases, investigations, and evidence. The development server deliberately has no database. | All authenticated production routes, including `/api/v1/auth/*`, `/api/v1/alerts`, `/api/v1/sources`, `/api/v1/crawl-jobs`, and `/api/v1/investigator/*`. | Database URL, ORM models, migration definitions, and route payloads. | Durable records, transactional updates, and query results. |
| Production authentication/JWT module | `backend/main.py` imports `app.core.security`; every protected production route depends on it. The dev server uses opaque process-local tokens only. | `POST /api/v1/auth/token`, `POST /api/v1/auth/register`, `GET /api/v1/auth/me`, plus all protected endpoints. | Username/password, password hash, signing secret, token expiry, and Bearer token. | Secure password verification, signed token, validated user identity, and 401/403 responses. |
| Crawler worker | The frontend can queue a crawl job, but a separate worker must claim and execute it. No request from the browser starts a crawler. | Reads jobs created by `POST /api/v1/crawl-jobs`; worker updates `PATCH /api/v1/ingestion/crawl-job/{job_id}/state` and may call ingestion endpoints. | Queued job (`job_id`, `source_id`, `intent_id`, `kind`), source policy/address, authorisation reference, and service API key. | State updates (`running`, `done`, `failed`), worker statistics such as `pages_crawled`, and any extracted records. |
| Ingestion service authentication | This protects crawler-to-backend calls and must not be exposed in browser code. | `POST /api/v1/ingestion/document`, `/batch`, `/entity`, `/relationship`, and `PATCH /api/v1/ingestion/crawl-job/{job_id}/state`. | Service credential such as `INGESTION_API_KEY`, validated payload, and job lifecycle state. | Authorised ingestion response or rejected request. |
| Search and graph adapters | Production investigation search uses Elasticsearch and Neo4j. | `GET /api/v1/investigator/investigations/{investigation_id}/search`; ingestion document/entity/relationship routes. | Investigation query, indexed documents, entities, and relationships. | Content matches, graph matches, indexing/upsert results. |
| Evidence store and blockchain adapter | Required for evidence retention and chain-of-custody, not for the current frontend views. | `POST /api/v1/evidence/investigations/{investigation_id}/upload`, `GET /api/v1/evidence/{evidence_id}/url`, `/api/v1/blockchain/anchor/{evidence_id}`, `/verify/{evidence_id}`. | Evidence file, investigation/evidence ID, object-store configuration, and blockchain credentials. | Evidence record, download URL, SHA-256 value, anchor or verification result. |
| SIEM adapter | High-severity alerts may be forwarded to a SIEM in production. | `POST /api/v1/siem/forward/{alert_id}` and inbound `POST /api/v1/siem/webhook`. | Alert payload or SIEM webhook event, plus SIEM configuration/API key. | Delivery result or validated/processed inbound event. |
| Cases, investigations, reporting, and user administration | These backend routes have no matching frontend screen in the current project, so they are deferred. | `/api/v1/investigator/cases*`, `/api/v1/investigator/investigations*`, `/api/v1/reports/cases/{case_id}`, `/api/v1/users*`. | Case/investigation/user payloads and authenticated roles. | Created/updated records, report object, search results, or role-gated response. |
| Persistent alert review | Threat Intelligence currently marks a card reviewed only in the browser session. | No update route exists yet; a future route could be `PATCH /api/v1/alerts/{alert_id}`. | Alert ID, review status, reviewer ID, timestamp, optional note. | Updated alert object persisted for later users/audits. |
| Standalone login service | `backend/login_darktress.py` is an optional independent authentication service, but it uses PostgreSQL and is not needed for the development path. | `/api/v1/auth/signup`, `/login`, `/refresh`, `/me` when `VITE_AUTH_MODE=login-service`. | PostgreSQL configuration, JWT configuration, and credentials. | Persistent user, access/refresh tokens, and authenticated profile. |

## Minimal development API contract

`backend/dev_server.py` implements only these endpoints for local frontend execution:

| Endpoint | Behaviour | Input | Output |
| --- | --- | --- | --- |
| `GET /health` | Health check. | None. | Development service status. |
| `POST /api/v1/auth/register` | Creates an in-memory account. | `username`, `email`, `password` (8+ characters). | Development user profile. |
| `POST /api/v1/auth/token` | Creates an in-memory session token. | Form-encoded `username`, `password`. | `access_token`, `token_type`. |
| `GET /api/v1/auth/me` | Reads the signed-in in-memory user. | Bearer token. | User profile. |
| `GET`/`POST /api/v1/alerts` | Lists or adds temporary alerts for dashboard testing. | Bearer token; POST accepts title, severity, and optional IOC/details. | Alert list or created alert. |
| `GET /api/v1/dashboard/summary` | Counts temporary alerts by severity. | Bearer token. | Summary object. |
| `GET /api/v1/sources` | Returns one non-network development source. | Bearer token; optional `status_filter`. | Source list. |
| `GET`/`POST /api/v1/crawl-jobs` | Lists or records queued jobs only. No job is executed. | Bearer token; POST accepts `intent_id`, `source_id`, optional `kind`. | Job list or queued job object. |
