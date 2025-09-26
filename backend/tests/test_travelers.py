import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from main import app
from database import get_db, Base

# Test database setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)

class TestTravelers:
    def test_get_travelers(self):
        response = client.get("/travelers/")
        assert response.status_code == 401  # Unauthorized without token

    def test_get_traveler_types(self):
        # Login first
        login_response = client.post("/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        assert login_response.status_code == 200
        token = login_response.json()["access_token"]

        # Get traveler types
        response = client.get(
            "/travelers/types/",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        types = response.json()
        assert len(types) >= 4  # PCB, Parts, Assembly, Cable

    def test_create_traveler(self):
        # Login first
        login_response = client.post("/auth/login", json={
            "username": "admin",
            "password": "admin123"
        })
        token = login_response.json()["access_token"]

        # Create traveler
        traveler_data = {
            "po_number": "PO-2024-001",
            "traveler_type_id": 1,
            "job_number": "TEST-001"
        }

        response = client.post(
            "/travelers/",
            json=traveler_data,
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        traveler = response.json()
        assert traveler["traveler_number"] is not None
        assert traveler["status"] == "created"