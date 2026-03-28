from fastapi import APIRouter

router = APIRouter()


@router.post("/register")
async def register():
    return {"message": "Registration endpoint - TODO"}


@router.post("/login")
async def login():
    return {"message": "Login endpoint - TODO"}
