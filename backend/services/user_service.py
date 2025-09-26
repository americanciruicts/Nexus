from sqlalchemy.orm import Session
from typing import List, Optional
import models
from schemas.user_schemas import UserCreate
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class UserService:
    def __init__(self, db: Session):
        self.db = db

    def get_users(self) -> List[models.User]:
        return self.db.query(models.User).all()

    def get_user_by_id(self, user_id: int) -> Optional[models.User]:
        return self.db.query(models.User).filter(models.User.id == user_id).first()

    def get_user_by_username(self, username: str) -> Optional[models.User]:
        return self.db.query(models.User).filter(models.User.username == username).first()

    def get_user_by_email(self, email: str) -> Optional[models.User]:
        return self.db.query(models.User).filter(models.User.email == email).first()

    def create_user(self, user_data: UserCreate) -> models.User:
        # Check if user already exists
        existing_user = self.db.query(models.User).filter(
            (models.User.username == user_data.username) |
            (models.User.email == user_data.email)
        ).first()

        if existing_user:
            raise ValueError("User with this username or email already exists")

        # Hash password
        hashed_password = pwd_context.hash(user_data.password)

        # Create user
        user = models.User(
            username=user_data.username,
            email=user_data.email,
            password_hash=hashed_password,
            role=user_data.role,
            first_name=user_data.first_name,
            last_name=user_data.last_name
        )

        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)

        return user

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        return pwd_context.verify(plain_password, hashed_password)

    def authenticate_user(self, username: str, password: str) -> Optional[models.User]:
        user = self.get_user_by_username(username)
        if not user:
            return None
        if not self.verify_password(password, user.password_hash):
            return None
        return user