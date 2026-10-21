"""PostgreSQL-backed user store (the `users` table) via db_utils.

Usernames are stored lower-case so lookups stay case-insensitive, as before.
Same function names as the old in-memory version, but now async."""
from typing import Optional

import db_utils as db


def _norm(username: str) -> str:
    return username.strip().lower()


async def get_user(username: str) -> Optional[dict]:
    """User row including password_hash (needed for login), or None."""
    return await db.get_user_by_username(_norm(username), include_hash=True)


async def create_user(username: str, email: str, password_hash: str) -> dict:
    """Raises db.DuplicateError if the username or email already exists."""
    return await db.create_user(_norm(username), email, password_hash)


async def clear() -> None:  # tests only
    async with db.connection() as conn:
        await conn.execute("TRUNCATE users CASCADE")
