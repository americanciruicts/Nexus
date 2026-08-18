"""Regression tests for the two ways travelers used to vanish from the UI.

1. GET /travelers is server-paginated. The All Travelers page fetched a single
   capped page, so once the shop passed that many travelers the oldest ones
   silently stopped rendering — they were still on the Jobs page (fed by KOSH),
   which is how the gap was noticed. Anything reachable anywhere must be
   reachable by paging this endpoint.

2. DELETE /travelers/{id} used to hard-delete the traveler and every child row,
   including its own audit log, leaving no record that it had ever existed. It
   now archives: nothing leaves the database.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app
from models import (
    Base, Traveler, ProcessStep, AuditLog, User, UserRole,
    TravelerStatus, TravelerType, Priority,
)
from database import get_db
from routers.auth import get_current_user
from routers.travelers import get_user_or_system

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Mirrors frontend/src/lib/travelersApi.ts — keep the two in step.
PAGE_SIZE = 200


@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def admin(db):
    user = User(
        username="admin@test",
        email="admin@test",
        first_name="Test",
        last_name="Admin",
        hashed_password="x",
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture
def client(db, admin):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin
    app.dependency_overrides[get_user_or_system] = lambda: admin
    yield TestClient(app)
    app.dependency_overrides.clear()


def make_traveler(db, job_number, created_by=1, status=TravelerStatus.IN_PROGRESS):
    traveler = Traveler(
        job_number=job_number,
        work_order_number=f"WO-{job_number}",
        traveler_type=TravelerType.ASSY,
        part_number=f"PN-{job_number}",
        part_description="Test part",
        revision="A",
        quantity=1,
        priority=Priority.NORMAL,
        work_center="ASSEMBLY",
        status=status,
        created_by=created_by,
        is_active=True,
    )
    db.add(traveler)
    db.commit()
    db.refresh(traveler)
    return traveler


def fetch_all(client):
    """Walk every page the way the All Travelers page does."""
    rows = []
    for page in range(50):
        response = client.get(f"/travelers/?skip={page * PAGE_SIZE}&limit={PAGE_SIZE}")
        assert response.status_code == 200
        batch = response.json()
        if not batch:
            break
        rows += batch
        if len(batch) < PAGE_SIZE:
            break
    return rows


class TestTravelerVisibility:
    def test_paging_returns_every_traveler(self, db, client):
        """More travelers than one page: all of them must still come back."""
        expected = {f"JOB{i:04d}" for i in range(PAGE_SIZE + 53)}
        for job_number in sorted(expected):
            make_traveler(db, job_number)

        rows = fetch_all(client)

        assert {r["job_number"] for r in rows} == expected
        assert len({r["id"] for r in rows}) == len(expected), "paging returned duplicates"

    def test_single_capped_request_is_not_enough(self, db, client):
        """Guards the actual bug: one capped call silently drops the rest."""
        for i in range(PAGE_SIZE + 53):
            make_traveler(db, f"JOB{i:04d}")

        one_call = client.get(f"/travelers/?limit={PAGE_SIZE}").json()

        assert len(one_call) == PAGE_SIZE
        assert len(fetch_all(client)) == PAGE_SIZE + 53

    def test_archived_travelers_stay_in_the_list(self, db, client):
        """Archiving must not hide a traveler from the list endpoint."""
        traveler = make_traveler(db, "JOB-ARCHIVED")

        assert client.delete(f"/travelers/{traveler.id}").status_code == 200

        assert "JOB-ARCHIVED" in {r["job_number"] for r in fetch_all(client)}


class TestDeleteIsNonDestructive:
    def test_delete_archives_and_keeps_everything(self, db, client, admin):
        traveler = make_traveler(db, "JOB-KEEP", status=TravelerStatus.IN_PROGRESS)
        db.add(ProcessStep(
            traveler_id=traveler.id,
            step_number=1,
            operation="INCOMING INSPECTION",
            work_center_code="INCOMING",
            instructions="Verify PCB against specifications",
        ))
        db.commit()

        response = client.delete(f"/travelers/{traveler.id}")
        assert response.status_code == 200
        assert response.json()["status"] == "ARCHIVED"

        db.expire_all()
        kept = db.query(Traveler).filter(Traveler.id == traveler.id).first()
        assert kept is not None, "the traveler row must survive"
        assert kept.status == TravelerStatus.ARCHIVED
        assert kept.previous_status == "IN_PROGRESS"

        steps = db.query(ProcessStep).filter(ProcessStep.traveler_id == traveler.id).count()
        assert steps == 1, "child rows must survive"

        audit = db.query(AuditLog).filter(
            AuditLog.traveler_id == traveler.id, AuditLog.action == "ARCHIVED"
        ).all()
        assert len(audit) == 1, "archiving must leave a permanent record"
        assert audit[0].old_value == "IN_PROGRESS"
        assert audit[0].user_id == admin.id

    def test_delete_is_idempotent(self, db, client):
        traveler = make_traveler(db, "JOB-TWICE")

        assert client.delete(f"/travelers/{traveler.id}").status_code == 200
        second = client.delete(f"/travelers/{traveler.id}")

        assert second.status_code == 200
        assert second.json()["message"] == "Traveler is already archived"
        assert db.query(Traveler).filter(Traveler.id == traveler.id).first() is not None

    def test_archived_traveler_can_be_restored(self, db, client):
        traveler = make_traveler(db, "JOB-RESTORE", status=TravelerStatus.IN_PROGRESS)

        client.delete(f"/travelers/{traveler.id}")
        response = client.patch(f"/travelers/{traveler.id}", json={"status": "CREATED"})

        assert response.status_code == 200
        db.expire_all()
        restored = db.query(Traveler).filter(Traveler.id == traveler.id).first()
        assert restored.status == TravelerStatus.IN_PROGRESS, "restores to pre-archive status"


class TestJobToTravelerMatching:
    """A job page must show its OWN travelers and nobody else's.

    The per-job endpoint used a bare ILIKE prefix, so job "8813L-4D" was shown
    "8813L-4DA"'s traveler — a job with no traveler looked covered — and job
    "8813L-4" was shown all seven of its sub-assemblies' travelers.
    """

    @pytest.mark.parametrize("traveler_jn, job_number, expected", [
        # Exact.
        ("8813L-4A", "8813L-4A", True),
        # Compliance suffixes appended in the UI.
        ("8414L", "8414", True),
        ("8414LM", "8414", True),
        # Work descriptor — the filing convention on roughly half the jobs.
        ("8813L-4BA ASSY", "8813L-4BA", True),
        ("8689L CABLE ASSY", "8689L", True),
        ("8762L KANBAN", "8762L", True),
        # The regressions: a longer job number is a DIFFERENT job.
        ("8813L-4DA", "8813L-4D", False),
        ("8813L-4A", "8813L-4", False),
        ("8813L-4BB", "8813L-4B", False),
        ("1000", "100", False),
        # Unrelated.
        ("9999L", "8813L-4", False),
    ])
    def test_matching_rule(self, traveler_jn, job_number, expected):
        from routers.jobs import traveler_matches_job
        assert traveler_matches_job(traveler_jn, job_number) is expected

    def test_job_page_shows_only_its_own_travelers(self, db, client):
        for jn in ["8813L-4A", "8813L-4BA ASSY", "8813L-4DA"]:
            make_traveler(db, jn)

        # 8813L-4D has no traveler of its own — 8813L-4DA's must not stand in.
        assert client.get("/jobs/8813L-4D/travelers").json()["total"] == 0
        # 8813L-4 must not claim its sub-assemblies.
        assert client.get("/jobs/8813L-4/travelers").json()["total"] == 0
        # A descriptor suffix still belongs to its own job.
        own = client.get("/jobs/8813L-4BA/travelers").json()
        assert [t["job_number"] for t in own["travelers"]] == ["8813L-4BA ASSY"]
