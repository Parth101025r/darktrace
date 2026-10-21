import os
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-test-secret-key-1234567890")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "15")
# the API tests use a real PostgreSQL: point the app at the throwaway test database
if os.getenv("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
