from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from app.api.deps import get_current_user, oauth2_scheme
from app.core.security import (
    ACCESS, REFRESH, TokenError, create_access_token, create_refresh_token,
    decode_token, hash_password, revoke_token, verify_password,
)
from app.schemas.auth import RefreshRequest, RegisterRequest, TokenResponse, UserOut
from app.services import user_store
import db_utils

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# Constant-time-ish defence against username enumeration via timing
_DUMMY_HASH = hash_password("dummy-password-for-timing")


def _issue(username: str) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(username),
        refresh_token=create_refresh_token(username),
    )


@router.post("/register", response_model=UserOut, status_code=201)
async def register(body: RegisterRequest):
    try:
        u = await user_store.create_user(body.username, body.email, hash_password(body.password))
    except db_utils.DuplicateError:  # username OR email already taken
        raise HTTPException(status.HTTP_409_CONFLICT, "Username or email already exists")
    return UserOut(username=u["username"], email=u["email"])


@router.post("/token", response_model=TokenResponse)
async def login(form: OAuth2PasswordRequestForm = Depends()):
    user = await user_store.get_user(form.username)
    ok = verify_password(form.password, user["password_hash"] if user else _DUMMY_HASH)
    if not user or not ok or user["status"] != "active":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect username or password",
                            headers={"WWW-Authenticate": "Bearer"})
    await db_utils.record_login(user["usr_id"])
    return _issue(user["username"])


@router.post("/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest):
    try:
        payload = decode_token(body.refresh_token, REFRESH)
    except TokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    revoke_token(payload["jti"])  # rotation: old refresh token is single-use
    return _issue(payload["sub"])


@router.post("/logout", status_code=204)
def logout(body: RefreshRequest, token: str = Depends(oauth2_scheme)):
    for t, typ in ((token, ACCESS), (body.refresh_token, REFRESH)):
        try:
            revoke_token(decode_token(t, typ)["jti"])
        except TokenError:
            pass


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return UserOut(username=user["username"], email=user["email"])
