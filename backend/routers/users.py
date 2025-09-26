from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel
import models
from database import get_db
from routers.auth import get_current_user, get_password_hash

router = APIRouter()

class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    role: str = "operator"
    first_name: str = None
    last_name: str = None

class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    role: str
    first_name: str = None
    last_name: str = None

    class Config:
        from_attributes = True

@router.post("/", response_model=UserResponse)
async def create_user(
    user_data: UserCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can create users")

    # Check if user already exists
    existing_user = db.query(models.User).filter(
        (models.User.username == user_data.username) |
        (models.User.email == user_data.email)
    ).first()

    if existing_user:
        raise HTTPException(status_code=400, detail="User with this username or email already exists")

    # Create new user
    hashed_password = get_password_hash(user_data.password)
    user = models.User(
        username=user_data.username,
        email=user_data.email,
        password_hash=hashed_password,
        role=user_data.role,
        first_name=user_data.first_name,
        last_name=user_data.last_name
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user

@router.get("/", response_model=List[UserResponse])
async def get_users(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    users = db.query(models.User).all()
    return users

@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role not in ["admin", "manager"] and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return user