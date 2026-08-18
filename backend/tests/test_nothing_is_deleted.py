"""Nothing in NEXUS is ever removed from the database.

Preet's rule: no traveler, no labor hours, nothing gets dumped. Travelers archive
in place (see test_traveler_visibility.py); the records here are soft-deleted —
stamped with deleted_at/deleted_by and filtered out of every ORM read by
models.install_soft_delete_filter, so totals stay correct while the row survives.
"""
import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from main import app
from models import (
    Base, Traveler, LaborEntry, PauseLog, CommunicationLog, QualityCheckItem,
    User, UserRole, TravelerStatus, TravelerType, Priority, SOFT_DELETE_MODELS,
)
from database import get_db
from routers.auth import get_current_user

engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def admin(db):
    user = User(username="admin@test", email="admin@test", first_name="T", last_name="A",
                hashed_password="x", role=UserRole.ADMIN, is_active=True)
    db.add(user); db.commit(); db.refresh(user)
    return user


@pytest.fixture
def client(db, admin):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def traveler(db, admin):
    t = Traveler(job_number="JOB-SOFT", work_order_number="WO-1", traveler_type=TravelerType.ASSY,
                 part_number="PN-1", part_description="Test", revision="A", quantity=1,
                 priority=Priority.NORMAL, work_center="ASSEMBLY", status=TravelerStatus.IN_PROGRESS,
                 created_by=admin.id, is_active=True)
    db.add(t); db.commit(); db.refresh(t)
    return t


def make_labor(db, traveler, admin, hours, completed=True):
    entry = LaborEntry(
        traveler_id=traveler.id, employee_id=admin.id, work_center="ASSEMBLY",
        start_time=datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc),
        end_time=datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc) if completed else None,
        hours_worked=hours, is_completed=completed,
    )
    db.add(entry); db.commit(); db.refresh(entry)
    return entry


def total_hours(db, traveler_id):
    return db.query(func.coalesce(func.sum(LaborEntry.hours_worked), 0.0)).filter(
        LaborEntry.traveler_id == traveler_id).scalar()


class TestLaborEntriesAreNeverRemoved:
    def test_row_survives_and_hours_leave_the_total(self, db, client, admin, traveler):
        keep = make_labor(db, traveler, admin, 2.0)
        drop = make_labor(db, traveler, admin, 3.5)
        assert total_hours(db, traveler.id) == 5.5

        assert client.delete(f"/labor/{drop.id}").status_code == 200
        db.expire_all()

        # Hours are gone from every total...
        assert total_hours(db, traveler.id) == 2.0
        assert db.query(LaborEntry).filter(LaborEntry.traveler_id == traveler.id).count() == 1
        assert [e.id for e in traveler.labor_entries] == [keep.id]

        # ...but the row is still physically in the table.
        row = db.execute(text(
            "select hours_worked, deleted_at is not null, deleted_by from labor_entries where id=:i"
        ), {"i": drop.id}).first()
        assert row is not None, "the labor row must never leave the table"
        assert row[0] == 3.5, "its hours are preserved on the row"
        assert row[1] is True or row[1] == 1
        assert row[2] == admin.id

    def test_recoverable_with_include_deleted(self, db, client, admin, traveler):
        entry = make_labor(db, traveler, admin, 1.25)
        client.delete(f"/labor/{entry.id}")
        db.expire_all()

        assert db.query(LaborEntry).filter(LaborEntry.id == entry.id).first() is None
        recovered = (db.query(LaborEntry).execution_options(include_deleted=True)
                     .filter(LaborEntry.id == entry.id).first())
        assert recovered is not None
        assert recovered.hours_worked == 1.25

    def test_open_timer_is_closed_so_the_employee_is_not_blocked(self, db, client, admin, traveler):
        """The partial unique index still sees soft-deleted rows, so a deleted
        running timer must not keep occupying the employee's one open slot."""
        running = make_labor(db, traveler, admin, 0.0, completed=False)
        assert running.end_time is None

        client.delete(f"/labor/{running.id}")
        db.expire_all()

        row = db.query(LaborEntry).execution_options(include_deleted=True).filter(
            LaborEntry.id == running.id).first()
        assert row.end_time is not None, "an open entry must be closed on delete"
        assert row.is_completed is True

    def test_deleting_a_pause_keeps_the_row(self, db, client, admin, traveler):
        entry = make_labor(db, traveler, admin, 3.0)
        pause = PauseLog(labor_entry_id=entry.id,
                         paused_at=datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc),
                         resumed_at=datetime(2026, 8, 1, 10, 30, tzinfo=timezone.utc),
                         duration_seconds=1800.0)
        db.add(pause); db.commit(); db.refresh(pause)

        assert client.delete(f"/labor/{entry.id}/pauses/{pause.id}").status_code == 200
        db.expire_all()

        assert db.query(PauseLog).filter(PauseLog.id == pause.id).first() is None
        assert db.execute(text("select count(*) from pause_logs where id=:i"),
                          {"i": pause.id}).scalar() == 1


class TestOtherRecordsAreNeverRemoved:
    def test_communication_log(self, db, client, admin, traveler):
        log = CommunicationLog(traveler_id=traveler.id, comm_type="note",
                               message="spoke to customer", created_by=admin.id)
        db.add(log); db.commit(); db.refresh(log)

        assert client.delete(f"/features/comms/entry/{log.id}").status_code == 200
        db.expire_all()

        assert db.query(CommunicationLog).filter(CommunicationLog.id == log.id).first() is None
        assert db.execute(text("select count(*) from communication_logs where id=:i"),
                          {"i": log.id}).scalar() == 1

    def test_every_soft_delete_model_has_the_columns(self):
        for model in SOFT_DELETE_MODELS:
            assert hasattr(model, "deleted_at"), model.__name__
            assert hasattr(model, "deleted_by"), model.__name__


class TestNoHardDeletePathsRemain:
    def test_routers_do_not_call_db_delete_on_data(self):
        """A hard delete reintroduced anywhere in these routers fails this."""
        import pathlib
        routers = pathlib.Path(__file__).resolve().parent.parent / "routers"
        offenders = []
        for name in ["labor.py", "features.py", "kitting_timer.py", "users.py",
                     "work_centers.py", "travelers.py"]:
            for num, line in enumerate(( routers / name).read_text().splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if "db.delete(" in stripped:
                    # Traveler groups are a grouping construct, not a record of
                    # work: dissolving one unlinks its travelers, never deletes
                    # them. Process steps are replaced on edit, and that path
                    # already reassigns any labor to the traveler first.
                    if name == "travelers.py" and ("group" in stripped or "old_step" in stripped):
                        continue
                    offenders.append(f"{name}:{num}: {stripped}")
        assert not offenders, "hard delete reintroduced:\n" + "\n".join(offenders)
