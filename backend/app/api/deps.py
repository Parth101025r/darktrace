from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.core.security import ACCESS, TokenError, decode_token
from app.services import user_store

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    try:
        payload = decode_token(token, ACCESS)
    except TokenError:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = await user_store.get_user(payload["sub"])
    if not user or user["status"] != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found",
                            headers={"WWW-Authenticate": "Bearer"})
    return user
