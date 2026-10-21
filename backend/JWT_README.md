# JWT login sessions (DarkTrace)

## Setup
cd backend
pip install -r requirements-jwt.txt
Copy-Item .env.example .env   # set DATABASE_URL and JWT_SECRET_KEY
# Generate a secret with: python -c "import secrets; print(secrets.token_urlsafe(64))"

## Run (standalone)
uvicorn app.main_jwt_demo:app --port 8001

## Integration status

This is a standalone demo, not yet wired into the production `backend/main.py`.
Production integration also needs shared token revocation storage and the
remaining production services/configuration.

## Test
python -m pytest tests -v

## Manual curl test
curl -X POST localhost:8001/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"dhaval","email":"d@x.com","password":"Str0ngPass!"}'
curl -X POST localhost:8001/api/v1/auth/token -d 'username=dhaval&password=Str0ngPass!'
curl localhost:8001/api/v1/auth/me -H "Authorization: Bearer <access_token>"
curl -X POST localhost:8001/api/v1/auth/refresh -H 'Content-Type: application/json' -d '{"refresh_token":"<refresh_token>"}'
