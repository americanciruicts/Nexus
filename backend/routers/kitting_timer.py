"""Phase A: Kitting Timer state machine & API.

State machine for a traveler's kitting work:

    IDLE  ──start──▶  ACTIVE  ──pause-waiting──▶  WAITING_PARTS
                       ▲                                │
                       └─────────── resume ─────────────┘
                       │
                      stop
                       ▼
                    COMPLETED

Each transition writes:
  - a row in kitting_timer_sessions (open if start, closed if stop/transition)
  - an entry in kitting_event_logs (audit trail)

Lives in parallel with the existing labor_entries system. This module never
writes to KOSH — it only reads from it (same pattern as analytics.py).
"""

from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import (
    KittingEventLog,
    KittingTimerSession,
    NotificationType,
    ProcessStep,
    Traveler,
    User,
)
from routers.auth import get_current_user

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

ACTIVE = "ACTIVE"
WAITING = "WAITING_PARTS"

# Notify admins when a kitting WAITING_PARTS session has been open this long
LONG_WAIT_THRESHOLD_HOURS = 24


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _open_session(db: Session, traveler_id: int) -> Optional[KittingTimerSession]:
    """Return the currently-open session for this traveler (end_time IS NULL),
    or None if there isn't one. There should never be more than one open
    session per traveler — the state machine enforces that."""
    return (
        db.query(KittingTimerSession)
        .filter(
            KittingTimerSession.traveler_id == traveler_id,
            KittingTimerSession.end_time.is_(None),
        )
        .order_by(KittingTimerSession.start_time.desc())
        .first()
    )


def _close_session(session: KittingTimerSession, when: Optional[datetime] = None) -> None:
    """Close an open session and compute its duration."""
    when = when or _now()
    session.end_time = when
    start = session.start_time
    if start and start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if start:
        session.duration_seconds = (when - start).total_seconds()


def _log_event(
    db: Session,
    traveler_id: int,
    event_type: str,
    *,
    session_id: Optional[int] = None,
    source: str = "user",
    actor_id: Optional[int] = None,
    payload: Optional[str] = None,
) -> KittingEventLog:
    evt = KittingEventLog(
        traveler_id=traveler_id,
        session_id=session_id,
        event_type=event_type,
        source=source,
        actor_id=actor_id,
        payload=payload,
    )
    db.add(evt)
    return evt


def _get_kitting_step(db: Session, traveler_id: int) -> Optional[ProcessStep]:
    """Pick the (first) kitting step on a traveler, if any. Used to populate
    step_id on a session. Optional — sessions work without it."""
    return (
        db.query(ProcessStep)
        .filter(
            ProcessStep.traveler_id == traveler_id,
            func.upper(ProcessStep.operation).like("%KIT%"),
        )
        .order_by(ProcessStep.step_number)
        .first()
    )


def _kosh_parts_ready(job_number: str) -> Optional[bool]:
    """Read-only check: are all BOM parts on hand for this job in KOSH?

    Returns:
        True  → all parts present (job is unblocked)
        False → at least one shortage
        None  → unknown / KOSH unreachable / no BOM rows
    """
    if not job_number:
        return None
    try:
        from routers.jobs import get_kosh_connection

        kosh_conn = get_kosh_connection()
        kosh_cur = kosh_conn.cursor()
        try:
            base = job_number.rstrip("LM") if job_number else job_number
            kosh_job = None
            kosh_jn = job_number
            for try_jn in (job_number, base) if base != job_number else (job_number,):
                kosh_cur.execute(
                    'SELECT order_qty FROM warehouse."tblJob" WHERE job_number = %s',
                    (try_jn,),
                )
                row = kosh_cur.fetchone()
                if row:
                    kosh_job = row
                    kosh_jn = try_jn
                    break
            if not kosh_job:
                return None
            order_qty = int(kosh_job[0] or 1)

            kosh_cur.execute(
                """
                WITH bom_items AS (
                    SELECT DISTINCT ON (b.aci_pn) b.aci_pn, b.mpn, b.qty
                    FROM warehouse."tblBOM" b
                    WHERE b.job = %s
                    ORDER BY b.aci_pn, b.line
                )
                SELECT
                    CAST(COALESCE(NULLIF(bi.qty, ''), '0') AS INTEGER) as qty_per,
                    COALESCE(SUM(CASE WHEN w.loc_to != 'MFG Floor' THEN w.onhandqty ELSE 0 END), 0) as on_hand
                FROM bom_items bi
                LEFT JOIN warehouse."tblWhse_Inventory" w
                    ON bi.aci_pn = w.item OR bi.mpn = w.mpn
                GROUP BY bi.aci_pn, bi.qty
                """,
                (kosh_jn,),
            )
            bom_rows = kosh_cur.fetchall()
            if not bom_rows:
                return None
            for r in bom_rows:
                req = int(r[0] or 0) * order_qty
                oh = int(r[1] or 0)
                if oh < req:
                    return False
            return True
        finally:
            try:
                kosh_conn.close()
            except Exception:
                pass
    except Exception as e:
        print(f"kitting_timer KOSH check error: {e}")
        return None


def _maybe_notify_long_wait(db: Session, traveler: Traveler) -> Optional[KittingEventLog]:
    """If this traveler has an open WAITING_PARTS session that has been open
    longer than LONG_WAIT_THRESHOLD_HOURS, fire ONE admin notification and
    log a LONG_WAIT_NOTIFIED event so we don't notify again for the same
    session. Idempotent: re-running won't double-notify.
    """
    open_sess = _open_session(db, traveler.id)
    if not open_sess or open_sess.session_type != WAITING:
        return None
    start = open_sess.start_time
    if start and start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if not start:
        return None
    elapsed_hours = (_now() - start).total_seconds() / 3600
    if elapsed_hours < LONG_WAIT_THRESHOLD_HOURS:
        return None
    # Already notified for this session?
    already = (
        db.query(KittingEventLog)
        .filter(
            KittingEventLog.session_id == open_sess.id,
            KittingEventLog.event_type == "LONG_WAIT_NOTIFIED",
        )
        .first()
    )
    if already:
        return None
    try:
        from services.notification_service import create_notification_for_admins

        create_notification_for_admins(
            db,
            notification_type=NotificationType.LABOR_ENTRY_UPDATED,
            title=f"Kitting waiting > {int(elapsed_hours)}h",
            message=(
                f"Job {traveler.job_number} has been waiting on parts for "
                f"~{int(elapsed_hours)}h. Check KOSH inventory or contact "
                f"purchasing."
            ),
            reference_id=traveler.id,
            reference_type="traveler",
            created_by_username="system",
        )
    except Exception as e:
        print(f"kitting long-wait notify error: {e}")
        return None
    evt = _log_event(
        db,
        traveler.id,
        "LONG_WAIT_NOTIFIED",
        session_id=open_sess.id,
        source="system",
        payload=f"waited {round(elapsed_hours, 1)}h, threshold {LONG_WAIT_THRESHOLD_HOURS}h",
    )
    db.commit()
    return evt


def _maybe_auto_close_waiting(db: Session, traveler: Traveler) -> Optional[KittingEventLog]:
    """If this traveler has an open WAITING_PARTS session AND KOSH now reports
    all parts on hand, close the waiting session and write a PARTS_RECEIVED
    event. Does NOT auto-resume the active timer — operator must do that
    manually so we don't log fake hours for an absent kitter.

    Returns the new event log row if it fired, else None.
    """
    open_sess = _open_session(db, traveler.id)
    if not open_sess or open_sess.session_type != WAITING:
        return None
    parts_ready = _kosh_parts_ready(traveler.job_number)
    if parts_ready is not True:
        return None
    _close_session(open_sess)
    evt = _log_event(
        db,
        traveler.id,
        "PARTS_RECEIVED",
        session_id=open_sess.id,
        source="kosh",
        payload="auto-closed waiting session: KOSH reports all BOM parts on hand",
    )
    db.commit()
    return evt


# ─────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────


class StartReq(BaseModel):
    note: Optional[str] = None


class PauseWaitingReq(BaseModel):
    note: Optional[str] = None


class ResumeReq(BaseModel):
    note: Optional[str] = None


class StopReq(BaseModel):
    note: Optional[str] = None


class SessionOut(BaseModel):
    id: int
    session_type: str
    start_time: datetime
    end_time: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    note: Optional[str] = None

    class Config:
        from_attributes = True


class EventOut(BaseModel):
    id: int
    event_type: str
    source: str
    actor_id: Optional[int] = None
    session_id: Optional[int] = None
    payload: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class StateOut(BaseModel):
    traveler_id: int
    job_number: Optional[str] = None
    state: str  # IDLE | ACTIVE | WAITING_PARTS | COMPLETED
    open_session: Optional[SessionOut] = None
    total_active_seconds: float
    total_waiting_seconds: float
    waiting_event_count: int
    avg_waiting_seconds: float
    longest_waiting_seconds: float
    sessions: List[SessionOut]
    events: List[EventOut]


class AnalyticsOut(BaseModel):
    traveler_id: int
    total_active_seconds: float
    total_waiting_seconds: float
    waiting_event_count: int
    avg_waiting_seconds: float
    longest_waiting_seconds: float
    active_vs_idle_pct: dict  # {"active": 0.72, "waiting": 0.28}


# ─────────────────────────────────────────────────────────────────────
# State computation
# ─────────────────────────────────────────────────────────────────────


def _compute_state(db: Session, traveler: Traveler) -> StateOut:
    sessions = (
        db.query(KittingTimerSession)
        .filter(KittingTimerSession.traveler_id == traveler.id)
        .order_by(KittingTimerSession.start_time)
        .all()
    )
    events = (
        db.query(KittingEventLog)
        .filter(KittingEventLog.traveler_id == traveler.id)
        .order_by(KittingEventLog.created_at)
        .all()
    )

    now = _now()
    total_active = 0.0
    total_waiting = 0.0
    waiting_durations: List[float] = []

    open_sess: Optional[KittingTimerSession] = None
    for s in sessions:
        start = s.start_time
        if start and start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if s.end_time is None:
            open_sess = s
            running = (now - start).total_seconds() if start else 0
            if s.session_type == ACTIVE:
                total_active += max(running, 0)
            else:
                total_waiting += max(running, 0)
                waiting_durations.append(max(running, 0))
        else:
            d = float(s.duration_seconds or 0)
            if s.session_type == ACTIVE:
                total_active += d
            else:
                total_waiting += d
                waiting_durations.append(d)

    # Determine high-level state
    if open_sess is None:
        # No open session. If there's any closed session and the traveler's
        # kitting step is marked completed, call it COMPLETED. Otherwise IDLE.
        kit_step = _get_kitting_step(db, traveler.id)
        if kit_step and kit_step.is_completed:
            state = "COMPLETED"
        else:
            state = "IDLE"
    else:
        state = open_sess.session_type  # ACTIVE or WAITING_PARTS

    waiting_count = len(waiting_durations)
    avg_waiting = (sum(waiting_durations) / waiting_count) if waiting_count else 0.0
    longest_waiting = max(waiting_durations) if waiting_durations else 0.0

    return StateOut(
        traveler_id=traveler.id,
        job_number=traveler.job_number,
        state=state,
        open_session=SessionOut.model_validate(open_sess) if open_sess else None,
        total_active_seconds=round(total_active, 1),
        total_waiting_seconds=round(total_waiting, 1),
        waiting_event_count=waiting_count,
        avg_waiting_seconds=round(avg_waiting, 1),
        longest_waiting_seconds=round(longest_waiting, 1),
        sessions=[SessionOut.model_validate(s) for s in sessions],
        events=[EventOut.model_validate(e) for e in events],
    )


# ─────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────


def _get_traveler_or_404(db: Session, traveler_id: int) -> Traveler:
    t = db.query(Traveler).filter(Traveler.id == traveler_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Traveler not found")
    return t


@router.post("/timer/{traveler_id}/start")
def start_timer(
    traveler_id: int,
    body: StartReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Begin (or resume from IDLE) an ACTIVE kitting session.

    Reject if a session is already open. To resume from a WAITING_PARTS
    pause, use /resume instead.
    """
    traveler = _get_traveler_or_404(db, traveler_id)
    open_sess = _open_session(db, traveler_id)
    if open_sess:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot start: a {open_sess.session_type} session is already open",
        )
    kit_step = _get_kitting_step(db, traveler_id)
    sess = KittingTimerSession(
        traveler_id=traveler_id,
        step_id=kit_step.id if kit_step else None,
        employee_id=current_user.id,
        session_type=ACTIVE,
        start_time=_now(),
        note=body.note,
    )
    db.add(sess)
    db.flush()
    _log_event(
        db,
        traveler_id,
        "TIMER_STARTED",
        session_id=sess.id,
        actor_id=current_user.id,
    )
    db.commit()
    return _compute_state(db, traveler)


@router.post("/timer/{traveler_id}/pause-waiting")
def pause_waiting(
    traveler_id: int,
    body: PauseWaitingReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Transition ACTIVE → WAITING_PARTS. Closes the active session and
    opens a new waiting session."""
    traveler = _get_traveler_or_404(db, traveler_id)
    open_sess = _open_session(db, traveler_id)
    if not open_sess:
        raise HTTPException(status_code=409, detail="No active session to pause")
    if open_sess.session_type != ACTIVE:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot pause-waiting: current session is {open_sess.session_type}",
        )
    now = _now()
    _close_session(open_sess, now)
    new_sess = KittingTimerSession(
        traveler_id=traveler_id,
        step_id=open_sess.step_id,
        employee_id=current_user.id,
        session_type=WAITING,
        start_time=now,
        note=body.note,
    )
    db.add(new_sess)
    db.flush()
    _log_event(
        db,
        traveler_id,
        "TIMER_PAUSED_WAITING",
        session_id=new_sess.id,
        actor_id=current_user.id,
    )
    db.commit()
    return _compute_state(db, traveler)


@router.post("/timer/{traveler_id}/resume")
def resume_timer(
    traveler_id: int,
    body: ResumeReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Transition WAITING_PARTS → ACTIVE. Closes waiting session, opens an
    active one. Operator-driven only — KOSH parts-arrival never auto-resumes
    (it only auto-closes the waiting session)."""
    traveler = _get_traveler_or_404(db, traveler_id)
    open_sess = _open_session(db, traveler_id)
    if not open_sess:
        # No open session: maybe KOSH already auto-closed the waiting one.
        # Treat resume as a clean start of a new ACTIVE session.
        kit_step = _get_kitting_step(db, traveler_id)
        sess = KittingTimerSession(
            traveler_id=traveler_id,
            step_id=kit_step.id if kit_step else None,
            employee_id=current_user.id,
            session_type=ACTIVE,
            start_time=_now(),
            note=body.note,
        )
        db.add(sess)
        db.flush()
        _log_event(
            db,
            traveler_id,
            "TIMER_RESUMED",
            session_id=sess.id,
            actor_id=current_user.id,
            payload="resumed after auto-closed waiting session",
        )
        db.commit()
        return _compute_state(db, traveler)

    if open_sess.session_type != WAITING:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot resume: current session is {open_sess.session_type}",
        )
    now = _now()
    _close_session(open_sess, now)
    new_sess = KittingTimerSession(
        traveler_id=traveler_id,
        step_id=open_sess.step_id,
        employee_id=current_user.id,
        session_type=ACTIVE,
        start_time=now,
        note=body.note,
    )
    db.add(new_sess)
    db.flush()
    _log_event(
        db,
        traveler_id,
        "TIMER_RESUMED",
        session_id=new_sess.id,
        actor_id=current_user.id,
    )
    db.commit()
    return _compute_state(db, traveler)


@router.post("/timer/{traveler_id}/stop")
def stop_timer(
    traveler_id: int,
    body: StopReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Close any open session. Use when the kitter is done for the day or
    the kitting step is complete."""
    traveler = _get_traveler_or_404(db, traveler_id)
    open_sess = _open_session(db, traveler_id)
    if not open_sess:
        raise HTTPException(status_code=409, detail="No open session to stop")
    _close_session(open_sess)
    if body.note:
        open_sess.note = (open_sess.note or "") + ("\n" if open_sess.note else "") + body.note
    _log_event(
        db,
        traveler_id,
        "TIMER_STOPPED",
        session_id=open_sess.id,
        actor_id=current_user.id,
    )
    db.commit()
    return _compute_state(db, traveler)


@router.get("/timer/{traveler_id}")
def get_timer_state(
    traveler_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return current state, sessions, and event timeline for one traveler.

    Side effect: if the traveler is currently in WAITING_PARTS, this endpoint
    polls KOSH (read-only) and, if all parts are now on hand, auto-closes the
    waiting session + writes a PARTS_RECEIVED event. The active timer is NOT
    auto-resumed; the operator clicks Resume to log the next active interval.
    """
    traveler = _get_traveler_or_404(db, traveler_id)
    _maybe_auto_close_waiting(db, traveler)
    # Long-wait notification (idempotent — fires once per open waiting session)
    _maybe_notify_long_wait(db, traveler)
    return _compute_state(db, traveler)


@router.post("/sweep-long-waits")
def sweep_long_waits(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Scan every traveler with an open WAITING_PARTS session and fire long-wait
    notifications for any that exceed the threshold and have not yet been
    notified. Idempotent. Returns the count of newly notified sessions.

    Useful for cron / scheduled invocation. Cheap query — only touches open
    sessions, so it scales with concurrent waiting jobs, not history.
    """
    open_waiting = (
        db.query(KittingTimerSession)
        .filter(
            KittingTimerSession.end_time.is_(None),
            KittingTimerSession.session_type == WAITING,
        )
        .all()
    )
    fired = 0
    for sess in open_waiting:
        traveler = db.query(Traveler).filter(Traveler.id == sess.traveler_id).first()
        if not traveler:
            continue
        evt = _maybe_notify_long_wait(db, traveler)
        if evt is not None:
            fired += 1
    return {"open_waiting_sessions": len(open_waiting), "newly_notified": fired}


@router.get("/analytics/{traveler_id}", response_model=AnalyticsOut)
def get_per_job_analytics(
    traveler_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-traveler kitting analytics: total times, waiting metrics, and
    active-vs-idle percentage breakdown."""
    traveler = _get_traveler_or_404(db, traveler_id)
    state = _compute_state(db, traveler)
    total = state.total_active_seconds + state.total_waiting_seconds
    if total > 0:
        active_pct = round(state.total_active_seconds / total, 3)
        waiting_pct = round(state.total_waiting_seconds / total, 3)
    else:
        active_pct = 0.0
        waiting_pct = 0.0
    return AnalyticsOut(
        traveler_id=traveler.id,
        total_active_seconds=state.total_active_seconds,
        total_waiting_seconds=state.total_waiting_seconds,
        waiting_event_count=state.waiting_event_count,
        avg_waiting_seconds=state.avg_waiting_seconds,
        longest_waiting_seconds=state.longest_waiting_seconds,
        active_vs_idle_pct={"active": active_pct, "waiting": waiting_pct},
    )


@router.post("/timer/{traveler_id}/sync-kosh")
def manual_kosh_sync(
    traveler_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manual trigger for the same KOSH check that GET /timer/{id} does.

    Useful from a frontend "Check parts" button. Read-only against KOSH.
    """
    traveler = _get_traveler_or_404(db, traveler_id)
    parts_ready = _kosh_parts_ready(traveler.job_number)
    fired = _maybe_auto_close_waiting(db, traveler)
    return {
        "traveler_id": traveler.id,
        "kosh_parts_ready": parts_ready,
        "auto_closed_waiting": fired is not None,
        "state": _compute_state(db, traveler),
    }


# ─────────────────────────────────────────────────────────────────────
# Admin override endpoints
# ─────────────────────────────────────────────────────────────────────


class OverrideEditReq(BaseModel):
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    session_type: Optional[str] = None
    note: Optional[str] = None


@router.put("/timer/session/{session_id}")
def admin_edit_session(
    session_id: int,
    body: OverrideEditReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin override: edit a kitting timer session. Recomputes duration."""
    if getattr(current_user, "role", None) and str(current_user.role).upper().endswith("OPERATOR"):
        raise HTTPException(status_code=403, detail="Admin only")
    sess = db.query(KittingTimerSession).filter(KittingTimerSession.id == session_id).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    if body.start_time is not None:
        sess.start_time = body.start_time
    if body.end_time is not None:
        sess.end_time = body.end_time
    if body.session_type is not None:
        if body.session_type not in (ACTIVE, WAITING):
            raise HTTPException(status_code=400, detail="invalid session_type")
        sess.session_type = body.session_type
    if body.note is not None:
        sess.note = body.note
    if sess.end_time and sess.start_time:
        st = sess.start_time if sess.start_time.tzinfo else sess.start_time.replace(tzinfo=timezone.utc)
        et = sess.end_time if sess.end_time.tzinfo else sess.end_time.replace(tzinfo=timezone.utc)
        sess.duration_seconds = (et - st).total_seconds()
    _log_event(
        db,
        sess.traveler_id,
        "MANUAL_OVERRIDE",
        session_id=sess.id,
        actor_id=current_user.id,
        payload="admin edited session",
    )
    db.commit()
    return {"ok": True, "session_id": sess.id}


@router.delete("/timer/session/{session_id}")
def admin_delete_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Admin override: delete a kitting timer session.

    Soft delete — the session row is never removed, only stamped and filtered
    out of every read.
    """
    if getattr(current_user, "role", None) and str(current_user.role).upper().endswith("OPERATOR"):
        raise HTTPException(status_code=403, detail="Admin only")
    sess = db.query(KittingTimerSession).filter(KittingTimerSession.id == session_id).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    traveler_id = sess.traveler_id
    # An open session is also closed out: the partial unique index
    # uq_one_open_kitting_session_per_traveler still sees soft-deleted rows, so
    # leaving end_time NULL would block the next session for this traveler.
    _now = datetime.now(timezone.utc)
    if sess.end_time is None:
        sess.end_time = _now
    sess.deleted_at = _now
    sess.deleted_by = current_user.id
    _log_event(
        db,
        traveler_id,
        "MANUAL_OVERRIDE",
        actor_id=current_user.id,
        payload=f"admin deleted session id={session_id}",
    )
    db.commit()
    return {"ok": True}
