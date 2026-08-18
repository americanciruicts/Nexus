import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, model_validator

from database import get_db
from models import User, LaborEntry, Traveler, ProcessStep, ManualStep, NotificationType, WorkCenter, TravelerStatus, TravelerType, UserRole, PauseLog, AuditLog
from routers.auth import get_current_user
from services.notification_service import create_notification_for_admins

logger = logging.getLogger(__name__)

router = APIRouter()


def get_pause_data(db: Session, entry_id: int):
    """Get pause logs, total pause seconds, and count for a labor entry."""
    logs = db.query(PauseLog).filter(PauseLog.labor_entry_id == entry_id).order_by(PauseLog.paused_at).all()
    total_seconds = sum(l.duration_seconds or 0 for l in logs)
    return {
        "pause_logs": [PauseLogResponse.model_validate(l) for l in logs],
        "total_pause_seconds": round(total_seconds, 1) if logs else None,
        "pause_count": len(logs) if logs else None,
    }


def get_pause_data_batch(db: Session, entry_ids: list):
    """Batch-fetch pause logs for many labor entries in a single query.
    Returns a dict {entry_id: pause_data_dict} matching get_pause_data's shape.
    Avoids the N+1 that crushed labor endpoints under admin polling load."""
    if not entry_ids:
        return {}
    logs = db.query(PauseLog).filter(PauseLog.labor_entry_id.in_(entry_ids)).order_by(PauseLog.paused_at).all()
    grouped: dict = {}
    for log in logs:
        grouped.setdefault(log.labor_entry_id, []).append(log)
    result = {}
    for eid in entry_ids:
        entry_logs = grouped.get(eid, [])
        total_seconds = sum(l.duration_seconds or 0 for l in entry_logs)
        result[eid] = {
            "pause_logs": [PauseLogResponse.model_validate(l) for l in entry_logs],
            "total_pause_seconds": round(total_seconds, 1) if entry_logs else None,
            "pause_count": len(entry_logs) if entry_logs else None,
        }
    return result

def update_step_and_traveler_progress(db: Session, labor_entry: LaborEntry):
    """When a labor entry is completed, mark its linked process step as completed
    and update the traveler's status accordingly."""
    if not labor_entry.step_id:
        return

    step = db.query(ProcessStep).filter(ProcessStep.id == labor_entry.step_id).first()
    if not step or step.is_completed:
        return

    # Mark the step as completed
    step.is_completed = True
    step.completed_at = labor_entry.end_time or datetime.now()
    step.completed_by = labor_entry.employee_id

    # Update traveler status
    traveler = db.query(Traveler).filter(Traveler.id == labor_entry.traveler_id).first()
    if not traveler:
        return

    # Move to IN_PROGRESS if still in CREATED or DRAFT
    if traveler.status in (TravelerStatus.CREATED, TravelerStatus.DRAFT):
        traveler.status = TravelerStatus.IN_PROGRESS

    # Shipping is the terminal step, but completing it must NOT mark the
    # traveler done while REQUIRED upstream steps are still unchecked (e.g. an
    # operator closing shipping out of order). Optional steps may remain
    # unchecked. For non-shipping steps, the traveler completes only when every
    # step is checked off.
    is_shipping_step = (step.operation or "").strip().upper() == "SHIPPING"
    all_steps = db.query(ProcessStep).filter(ProcessStep.traveler_id == traveler.id).all()

    if is_shipping_step:
        required_done = all(s.is_completed for s in all_steps if s.is_required)
        if required_done:
            traveler.status = TravelerStatus.COMPLETED
            traveler.completed_at = datetime.now()
    else:
        if all_steps and all(s.is_completed for s in all_steps):
            traveler.status = TravelerStatus.COMPLETED
            traveler.completed_at = datetime.now()

    db.flush()

# Zero qty is allowed but must be justified — we require a non-empty comment on
# any payload that sets qty_completed to 0 and audit the submission so
# reporting can trace "no units produced" entries back to the operator and the
# stated reason.
ZERO_QTY_COMMENT_ERROR = (
    "A quantity of 0 requires an explanation — enter the reason in the "
    "Comment field before submitting."
)


class LaborEntryCreate(BaseModel):
    traveler_id: int
    step_id: Optional[int] = None
    start_time: datetime
    end_time: Optional[datetime] = None
    description: str
    is_completed: Optional[bool] = None
    employee_id: Optional[int] = None  # Admin can specify a different employee
    comment: Optional[str] = None
    qty_completed: Optional[int] = None

    @model_validator(mode="after")
    def _require_comment_on_zero_qty(self):
        if self.qty_completed == 0 and not (self.comment and self.comment.strip()):
            raise ValueError(ZERO_QTY_COMMENT_ERROR)
        return self


class LaborEntryUpdate(BaseModel):
    pause_time: Optional[datetime] = None
    clear_pause: Optional[bool] = None  # Set to true to resume (clear pause_time)
    pause_comment: Optional[str] = None  # Comment for pause/resume
    pause_reason: Optional[str] = None   # 'BREAK' (default) or 'WAITING_PARTS'
    end_time: Optional[datetime] = None
    description: Optional[str] = None
    is_completed: Optional[bool] = None
    qty_completed: Optional[int] = None
    comment: Optional[str] = None
    start_time: Optional[datetime] = None

    @model_validator(mode="after")
    def _require_qty_on_stop(self):
        # Stopping a timer (is_completed=True) must carry a qty_completed value.
        # Blank/null qty was the hole that let rapid double-clicks close out
        # sessions with no production data recorded.
        if self.is_completed is True and self.qty_completed is None:
            raise ValueError(
                "qty_completed is required when stopping a timer. "
                "Enter the units completed (use 0 with a reason if none)."
            )
        if self.qty_completed is not None and self.qty_completed < 0:
            raise ValueError("qty_completed must be zero or a positive integer.")
        if self.qty_completed == 0 and not (self.comment and self.comment.strip()):
            raise ValueError(ZERO_QTY_COMMENT_ERROR)
        return self


def _write_zero_qty_audit(
    db: Session,
    labor_entry: LaborEntry,
    user: User,
    previous_qty: Optional[int],
    comment: Optional[str],
    request: Optional[Request] = None,
) -> None:
    """Append an AuditLog row whenever qty_completed is set to 0 so reports
    can trace who entered the zero, when, and the justification they gave."""
    ip = request.client.host if request and request.client else None
    ua = request.headers.get("user-agent") if request else None
    audit = AuditLog(
        traveler_id=labor_entry.traveler_id,
        user_id=user.id,
        action="LABOR_ZERO_QTY",
        field_changed="qty_completed",
        old_value=(str(previous_qty) if previous_qty is not None else None),
        new_value=f"0 | {(comment or '').strip()}",
        ip_address=ip,
        user_agent=ua,
    )
    db.add(audit)

class PauseLogResponse(BaseModel):
    id: int
    paused_at: datetime
    resumed_at: Optional[datetime] = None
    duration_seconds: Optional[float] = None
    comment: Optional[str] = None
    reason: Optional[str] = None

    class Config:
        from_attributes = True

from utils.job_display import rma_job_display, is_rma


class LaborEntryResponse(BaseModel):
    id: int
    traveler_id: int
    step_id: Optional[int]
    employee_id: Optional[int] = None
    employee_name: Optional[str] = None
    job_number: Optional[str] = None
    # Display label combining RMA number + job number for RMA travelers
    job_display: Optional[str] = None
    start_time: datetime
    pause_time: Optional[datetime] = None
    end_time: Optional[datetime]
    hours_worked: float
    description: Optional[str] = ""
    is_completed: bool
    work_center: Optional[str] = None
    work_center_code: Optional[str] = None
    sequence_number: Optional[int] = None
    qty_completed: Optional[int] = None
    comment: Optional[str] = None
    created_at: datetime
    # Traveler information
    work_order: Optional[str] = None
    po_number: Optional[str] = None
    part_number: Optional[str] = None
    quantity: Optional[int] = None
    # Pause history
    pause_logs: Optional[List[PauseLogResponse]] = None
    total_pause_seconds: Optional[float] = None
    pause_count: Optional[int] = None

    class Config:
        from_attributes = True

@router.get("/scan")
async def scan_qr_lookup(
    qr_data: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Parse a NEXUS-STEP QR code and return all fields from the database.
    QR format: NEXUS-STEP|traveler_id|job_number|work_order|work_center_code|step_number|operation|step_type|step_id|company_code
    """
    if not qr_data.startswith("NEXUS-STEP|"):
        raise HTTPException(status_code=400, detail="Invalid QR code format")

    parts = qr_data.split("|")
    if len(parts) < 10:
        raise HTTPException(status_code=400, detail="Incomplete QR code data")

    try:
        qr_step_id = int(parts[8])
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Invalid step_id in QR code")

    # Determine step type from QR data
    qr_step_type = parts[7] if len(parts) > 7 else "PROCESS"

    if qr_step_type == "MANUAL":
        # Look up manual step. Fall back to (traveler, description) match
        # across both the QR's traveler_id and any sibling traveler with the
        # same job_number + work_order — handles cases where the original
        # traveler was deleted/replaced after the label was printed.
        manual_step = db.query(ManualStep).filter(ManualStep.id == qr_step_id).first()
        if not manual_step:
            try:
                qr_traveler_id = int(parts[1])
            except (ValueError, IndexError):
                qr_traveler_id = None
            qr_job_number_fb = parts[2] if len(parts) > 2 else None
            qr_work_order_fb = parts[3] if len(parts) > 3 else None
            qr_description = parts[6] if len(parts) > 6 else (parts[4] if len(parts) > 4 else None)

            candidate_traveler_ids: list = []
            qr_traveler = None
            if qr_traveler_id:
                candidate_traveler_ids.append(qr_traveler_id)
                qr_traveler = db.query(Traveler).filter(Traveler.id == qr_traveler_id).first()
            if qr_job_number_fb:
                sibling_q = db.query(Traveler.id).filter(Traveler.job_number == qr_job_number_fb)
                if qr_work_order_fb:
                    sibling_q = sibling_q.filter(Traveler.work_order_number == qr_work_order_fb)
                # Same RMA/original split as the PROCESS branch below: never let
                # an RMA scan fall back onto the traveler for the job it reworks.
                if qr_traveler is not None:
                    sibling_q = sibling_q.filter(Traveler.traveler_type == qr_traveler.traveler_type)
                    if is_rma(qr_traveler):
                        sibling_q = sibling_q.filter(Traveler.rma_number == qr_traveler.rma_number)
                for (tid,) in sibling_q.all():
                    if tid not in candidate_traveler_ids:
                        candidate_traveler_ids.append(tid)

            if qr_description and candidate_traveler_ids:
                for tid in candidate_traveler_ids:
                    manual_step = db.query(ManualStep).filter(
                        ManualStep.traveler_id == tid,
                        ManualStep.description == qr_description,
                    ).first()
                    if manual_step:
                        logger.warning(
                            "scan_qr_lookup stale MANUAL step_id=%s recovered via "
                            "fallback to step_id=%s (qr_traveler_id=%s qr_job=%s "
                            "qr_wo=%s desc=%s) live_traveler_id=%s user=%s",
                            qr_step_id, manual_step.id, qr_traveler_id,
                            qr_job_number_fb, qr_work_order_fb, qr_description,
                            manual_step.traveler_id, current_user.username,
                        )
                        break
            if not manual_step:
                raise HTTPException(
                    status_code=404,
                    detail=(
                        f"Manual step {qr_step_id} not found. The traveler may "
                        f"have been deleted or replaced after this label was "
                        f"printed — please reprint."
                    ),
                )

        traveler = db.query(Traveler).filter(Traveler.id == manual_step.traveler_id).first()
        if not traveler:
            raise HTTPException(status_code=404, detail="Traveler not found for this step")

        return {
            "step_id": manual_step.id,
            "traveler_id": traveler.id,
            "job_number": traveler.job_number,
            "rma_number": traveler.rma_number,
            "traveler_type": traveler.traveler_type.value if hasattr(traveler.traveler_type, 'value') else str(traveler.traveler_type),
            "job_display": rma_job_display(traveler),
            "work_order": traveler.work_order_number,
            "operation": manual_step.description,  # e.g. "Manual Insertion"
            "work_center_code": manual_step.description,
            "work_center_name": manual_step.description,
            "step_number": 0,
            "step_type": "MANUAL",
            "quantity": traveler.quantity,
            "part_number": traveler.part_number,
            "po_number": traveler.po_number,
            "company_code": parts[9] if len(parts) > 9 else None,
            "is_step_completed": manual_step.is_completed if hasattr(manual_step, 'is_completed') else False,
        }

    # Look up process step from DB. The printed QR's step_id can go stale when
    # the traveler is edited (steps reordered/replaced) — those old step rows
    # get deleted if no labor was logged against them. The QR's traveler_id
    # can also go stale (traveler deleted/replaced/recloned). Fall back to
    # matching by what's stable on the printed label: job_number + work_order
    # to find the live traveler, then step_number + operation/work_center to
    # find the live step. Works across travelers too — not job-specific.
    step = db.query(ProcessStep).filter(ProcessStep.id == qr_step_id).first()
    if not step:
        try:
            qr_traveler_id = int(parts[1])
        except (ValueError, IndexError):
            qr_traveler_id = None
        qr_job_number_fb = parts[2] if len(parts) > 2 else None
        qr_work_order_fb = parts[3] if len(parts) > 3 else None
        try:
            qr_step_number = int(parts[5]) if parts[5] else None
        except (ValueError, IndexError):
            qr_step_number = None
        qr_work_center = parts[4] if len(parts) > 4 else None
        qr_operation = parts[6] if len(parts) > 6 else None

        # Build the candidate set of traveler_ids to search across — start
        # with the QR's traveler_id, then widen to (job_number + work_order)
        # in case the original traveler was replaced.
        candidate_traveler_ids: list = []
        qr_traveler = None
        if qr_traveler_id:
            candidate_traveler_ids.append(qr_traveler_id)
            qr_traveler = db.query(Traveler).filter(Traveler.id == qr_traveler_id).first()
        if qr_job_number_fb:
            sibling_q = db.query(Traveler.id).filter(Traveler.job_number == qr_job_number_fb)
            if qr_work_order_fb:
                sibling_q = sibling_q.filter(Traveler.work_order_number == qr_work_order_fb)
            # An RMA traveler shares its job_number with the job it reworks, so
            # widening by job_number alone can land an RMA scan on the ORIGINAL
            # job's traveler (or vice versa) — logging rework hours against the
            # wrong traveler. Keep the fallback on the scanned traveler's own
            # side of that line: same type, and same RMA number when it is one.
            if qr_traveler is not None:
                sibling_q = sibling_q.filter(Traveler.traveler_type == qr_traveler.traveler_type)
                if is_rma(qr_traveler):
                    sibling_q = sibling_q.filter(Traveler.rma_number == qr_traveler.rma_number)
            for (tid,) in sibling_q.all():
                if tid not in candidate_traveler_ids:
                    candidate_traveler_ids.append(tid)
        # Last-ditch: if still empty (no job_number on QR somehow), search by
        # step_number + operation across all travelers — bounded by the
        # uniqueness of (operation + step_number) so it's safe enough.
        candidate = None
        if candidate_traveler_ids:
            for tid in candidate_traveler_ids:
                base_q = db.query(ProcessStep).filter(ProcessStep.traveler_id == tid)
                if qr_step_number is not None and qr_operation:
                    candidate = base_q.filter(
                        ProcessStep.step_number == qr_step_number,
                        ProcessStep.operation == qr_operation,
                    ).first()
                    if candidate:
                        break
                if qr_step_number is not None and qr_work_center:
                    candidate = base_q.filter(
                        ProcessStep.step_number == qr_step_number,
                        ProcessStep.work_center_code == qr_work_center,
                    ).first()
                    if candidate:
                        break
                if qr_operation:
                    candidate = base_q.filter(ProcessStep.operation == qr_operation).first()
                    if candidate:
                        break
                if qr_work_center:
                    candidate = base_q.filter(ProcessStep.work_center_code == qr_work_center).first()
                    if candidate:
                        break
        if candidate:
            logger.warning(
                "scan_qr_lookup stale step_id=%s recovered via fallback to step_id=%s "
                "(qr_traveler_id=%s qr_job=%s qr_wo=%s step_number=%s op=%s wc=%s) "
                "live_traveler_id=%s user=%s",
                qr_step_id, candidate.id, qr_traveler_id, qr_job_number_fb,
                qr_work_order_fb, qr_step_number, qr_operation, qr_work_center,
                candidate.traveler_id, current_user.username,
            )
            step = candidate
        if not step:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"Process step {qr_step_id} not found and could not be matched "
                    f"by job/WO/step number/operation. The traveler may have been "
                    f"deleted or replaced after this label was printed — please reprint."
                ),
            )

    # Look up traveler
    traveler = db.query(Traveler).filter(Traveler.id == step.traveler_id).first()
    if not traveler:
        raise HTTPException(status_code=404, detail="Traveler not found for this step")

    # Instrumentation for the "wrong WO on shared job number" floor report.
    # Logs which traveler/WO the scanned step_id resolved to so we can confirm
    # from server logs whether the QR itself encodes the wrong step or the
    # downstream code was mis-binding.
    qr_work_order = parts[3] if len(parts) > 3 else None
    qr_job_number = parts[2] if len(parts) > 2 else None
    if qr_work_order and traveler.work_order_number and qr_work_order != traveler.work_order_number:
        logger.warning(
            "scan_qr_lookup WO mismatch: step_id=%s qr_job=%s qr_wo=%s "
            "-> traveler_id=%s traveler_job=%s traveler_wo=%s user=%s",
            qr_step_id, qr_job_number, qr_work_order,
            traveler.id, traveler.job_number, traveler.work_order_number,
            current_user.username,
        )
    else:
        logger.info(
            "scan_qr_lookup: step_id=%s -> traveler_id=%s job=%s wo=%s op=%s user=%s",
            qr_step_id, traveler.id, traveler.job_number,
            traveler.work_order_number, step.operation, current_user.username,
        )

    # Look up work center for display name
    work_center = None
    if step.work_center_code:
        work_center = db.query(WorkCenter).filter(WorkCenter.code == step.work_center_code).first()

    return {
        "step_id": step.id,
        "traveler_id": traveler.id,
        "job_number": traveler.job_number,
        "rma_number": traveler.rma_number,
        "traveler_type": traveler.traveler_type.value if hasattr(traveler.traveler_type, 'value') else str(traveler.traveler_type),
        "job_display": rma_job_display(traveler),
        "work_order": traveler.work_order_number,
        "operation": step.operation,  # e.g. "AOI", "FEEDER LOAD" — the display name
        "work_center_code": step.work_center_code,
        "work_center_name": work_center.name if work_center else step.operation,
        "step_number": step.step_number,
        "step_type": "PROCESS",
        "quantity": traveler.quantity,
        "part_number": traveler.part_number,
        "po_number": traveler.po_number,
        "company_code": traveler.company_code if hasattr(traveler, 'company_code') else parts[9] if len(parts) > 9 else None,
        "is_step_completed": step.is_completed,
    }


@router.post("/", response_model=LaborEntryResponse)
@router.post("", response_model=LaborEntryResponse, include_in_schema=False)
async def start_labor_entry(
    labor_data: LaborEntryCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Start a new labor entry"""

    # Verify traveler exists
    traveler = db.query(Traveler).filter(Traveler.id == labor_data.traveler_id).first()
    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Traveler not found"
        )

    # Server-side job-number guard: the traveler we're attaching this labor
    # entry to must actually have a job_number. A scanner mis-configured to
    # send only the WC QR (no job scan) used to slip empty-job entries past
    # the client-side check; this is the last line of defense.
    if not (traveler.job_number and str(traveler.job_number).strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot start labor entry: traveler has no job number. Scan or select a Job Number first."
        )

    # Verify step exists if provided and extract sequence number
    sequence_num = None
    work_center_name = None
    step_id = labor_data.step_id

    if step_id:
        step = db.query(ProcessStep).filter(ProcessStep.id == step_id).first()
        if not step:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Process step not found"
            )
        sequence_num = step.step_number
        work_center_name = step.operation
        # Defense-in-depth for the "3 travelers, same job number, wrong WO
        # logged" floor report: a scanned WC QR carries the exact step_id of
        # the traveler the operator is working. That step is pinned to one
        # traveler via step.traveler_id, so trust it over the client-supplied
        # traveler_id — which can go stale when the operator swaps between
        # breakouts of the same job. Rebind the traveler here so the labor
        # entry always lands on the correct WO.
        if step.traveler_id and step.traveler_id != labor_data.traveler_id:
            rebound = db.query(Traveler).filter(Traveler.id == step.traveler_id).first()
            if rebound:
                logger.warning(
                    "start_labor_entry traveler_id rebind: client sent "
                    "traveler_id=%s job=%s wo=%s but step_id=%s belongs to "
                    "traveler_id=%s job=%s wo=%s -- using step's traveler. user=%s",
                    traveler.id, traveler.job_number, traveler.work_order_number,
                    step_id, rebound.id, rebound.job_number, rebound.work_order_number,
                    current_user.username,
                )
                traveler = rebound
                labor_data.traveler_id = rebound.id
    else:
        # If no step_id provided, try to find it from description
        # Description format: "WORK_CENTER - OPERATOR"
        if labor_data.description and ' - ' in labor_data.description:
            work_center_from_desc = labor_data.description.split(' - ')[0].strip()

            # Query all process steps for this traveler
            process_steps = db.query(ProcessStep).filter(
                ProcessStep.traveler_id == labor_data.traveler_id
            ).all()

            # Try to find matching step with fuzzy matching
            import re
            def strip_numeric_prefix(s):
                """Strip leading numeric prefix like '18 WASH' → 'WASH', '5. SMT TOP' → 'SMT TOP'"""
                return re.sub(r'^\d+[\.\s]+', '', s).strip()

            for ps in process_steps:
                ps_operation_upper = ps.operation.upper() if ps.operation else ""
                wc_upper = work_center_from_desc.upper()

                # Also compare with numeric prefixes stripped
                ps_stripped = strip_numeric_prefix(ps_operation_upper)
                wc_stripped = strip_numeric_prefix(wc_upper)

                # Check various matching patterns
                if (
                    # Exact match (case-insensitive)
                    ps_operation_upper == wc_upper or
                    ps_operation_upper.replace('_', ' ') == wc_upper.replace('_', ' ') or
                    ps_operation_upper.replace(' ', '_') == wc_upper.replace(' ', '_') or
                    # Match with numeric prefix stripped (e.g., "18 WASH" matches "WASH")
                    ps_stripped == wc_stripped or
                    ps_operation_upper == wc_stripped or
                    ps_stripped == wc_upper or
                    ps_stripped.replace('_', ' ') == wc_stripped.replace('_', ' ') or
                    # One contains the other (e.g., "18 WASH" contains "WASH")
                    (len(ps_operation_upper) >= 3 and ps_operation_upper in wc_upper) or
                    (len(wc_upper) >= 3 and wc_upper in ps_operation_upper) or
                    # Handle common variations
                    (wc_stripped == 'AUTO_INSERTION' and ps_stripped == 'AUTO INSERT') or
                    (wc_stripped == 'AUTO INSERT' and ps_stripped == 'AUTO_INSERTION') or
                    (wc_stripped == 'E-TEST' and ps_stripped == 'ETEST') or
                    (wc_stripped == 'ETEST' and ps_stripped == 'E-TEST') or
                    (wc_stripped == 'MAKE_BOM' and ps_stripped == 'MAKE BOM') or
                    (wc_stripped == 'MAKE BOM' and ps_stripped == 'MAKE_BOM')
                ):
                    # Found matching step
                    step_id = ps.id
                    sequence_num = ps.step_number
                    work_center_name = ps.operation
                    break

            # If still no match found, use the work center from description as-is
            if not work_center_name:
                work_center_name = work_center_from_desc

    # Determine effective employee - admin can override
    effective_employee_id = current_user.id
    effective_employee = current_user
    if labor_data.employee_id and labor_data.employee_id != current_user.id:
        # Only admin can assign labor to another user
        if current_user.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only administrators can create labor entries for other users"
            )
        target_employee = db.query(User).filter(User.id == labor_data.employee_id).first()
        if not target_employee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Specified employee not found"
            )
        effective_employee_id = target_employee.id
        effective_employee = target_employee

    # Check if user has an active labor entry
    # BUT: Allow manual entries (which have end_time already set) even if user has active entry
    if not labor_data.end_time:  # Only check for active entry if this is NOT a manual entry
        active_entry = db.query(LaborEntry).filter(
            (LaborEntry.employee_id == effective_employee_id) &
            (LaborEntry.end_time.is_(None)) &
            (LaborEntry.is_completed == False)
        ).first()

        if active_entry:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You already have an active labor entry. Please complete it first."
            )

    # Create labor entry
    db_labor_entry = LaborEntry(
        traveler_id=labor_data.traveler_id,
        step_id=step_id,
        employee_id=effective_employee_id,
        start_time=labor_data.start_time,
        end_time=labor_data.end_time,  # Support manual entries with end_time
        description=labor_data.description,
        comment=labor_data.comment,
        is_completed=labor_data.is_completed if labor_data.is_completed is not None else False,
        qty_completed=labor_data.qty_completed,
        work_center=work_center_name,
        sequence_number=sequence_num
    )

    # If end_time is provided, calculate hours_worked automatically
    if labor_data.end_time:
        # Validate that end_time is after start_time (prevent negative hours)
        if labor_data.end_time <= labor_data.start_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="End time must be after start time. Please check your times and try again."
            )

        duration = labor_data.end_time - labor_data.start_time
        total_seconds = duration.total_seconds()

        # Additional safety check for negative seconds
        if total_seconds < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Calculated time is negative. End time must be after start time."
            )

        hours_worked = round(total_seconds / 3600, 2)

        # Final validation that hours are not negative
        if hours_worked < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Calculated hours ({hours_worked}) is negative. Please verify your times."
            )

        db_labor_entry.hours_worked = hours_worked

    db.add(db_labor_entry)
    db.flush()

    # For manual entries (created with end_time), update step and traveler progress
    if labor_data.end_time and db_labor_entry.is_completed:
        update_step_and_traveler_progress(db, db_labor_entry)

    # Audit zero-quantity submissions for accountability.
    if labor_data.qty_completed == 0:
        _write_zero_qty_audit(
            db,
            db_labor_entry,
            current_user,
            previous_qty=None,
            comment=labor_data.comment,
            request=request,
        )

    db.commit()
    db.refresh(db_labor_entry)

    # Add employee name and job number for response
    db_labor_entry.employee_name = f"{effective_employee.first_name} {effective_employee.last_name}"
    traveler = db.query(Traveler).filter(Traveler.id == db_labor_entry.traveler_id).first()
    db_labor_entry.job_number = traveler.job_number if traveler else None

    # Create notification for all admins — include details for data recovery
    created_by_label = current_user.username
    if effective_employee_id != current_user.id:
        created_by_label = f"{current_user.username} (for {effective_employee.first_name})"
    start_msg = f"{created_by_label} started labor entry for {traveler.job_number if traveler else 'Unknown Job'} - {work_center_name or 'Unknown Work Center'}"
    start_details = []
    if db_labor_entry.qty_completed:
        start_details.append(f"QTY: {db_labor_entry.qty_completed}")
    if db_labor_entry.comment:
        start_details.append(f"Comment: {db_labor_entry.comment}")
    if start_details:
        start_msg += " | " + " | ".join(start_details)
    create_notification_for_admins(
        db=db,
        notification_type=NotificationType.LABOR_ENTRY_CREATED,
        title="New Labor Entry Started",
        message=start_msg,
        reference_id=db_labor_entry.id,
        reference_type="labor_entry",
        created_by_username=current_user.username
    )

    return db_labor_entry

@router.put("/{labor_id}", response_model=LaborEntryResponse)
async def update_labor_entry(
    labor_id: int,
    labor_data: LaborEntryUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update/complete a labor entry"""

    labor_entry = db.query(LaborEntry).filter(LaborEntry.id == labor_id).first()
    if not labor_entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Labor entry not found"
        )

    # Check if user owns this labor entry or is admin
    if (labor_entry.employee_id != current_user.id and
        current_user.role != UserRole.ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this labor entry"
        )

    # Idempotent stop: if the entry is already closed and this is another
    # stop attempt (end_time + is_completed=True), return the current state
    # instead of re-running the validators / progress updates. Handles the
    # "first stop fails, second stop works" report where a retried Stop after
    # a network blip or scanner-triggered Enter produces a duplicate PUT.
    if (
        labor_entry.is_completed
        and labor_entry.end_time is not None
        and labor_data.is_completed is True
        and labor_data.end_time is not None
        and labor_data.pause_time is None
        and not labor_data.clear_pause
    ):
        traveler = db.query(Traveler).filter(Traveler.id == labor_entry.traveler_id).first()
        employee = db.query(User).filter(User.id == labor_entry.employee_id).first()
        labor_entry.employee_name = f"{employee.first_name} {employee.last_name}" if employee else "Unknown"
        labor_entry.job_number = traveler.job_number if traveler else None
        return labor_entry

    # Capture original state before updates (for notification logic + audit)
    had_end_time_before = labor_entry.end_time is not None
    previous_qty = labor_entry.qty_completed

    # Log pause event
    if labor_data.pause_time:
        reason = (labor_data.pause_reason or "BREAK").upper()
        if reason not in ("BREAK", "WAITING_PARTS"):
            reason = "BREAK"
        pause_log = PauseLog(
            labor_entry_id=labor_entry.id,
            paused_at=labor_data.pause_time,
            comment=labor_data.pause_comment,
            reason=reason,
        )
        db.add(pause_log)

    # Handle resume (clear pause_time) and close the open pause log
    if labor_data.clear_pause:
        labor_entry.pause_time = None
        # Find the open pause log (no resumed_at) and close it
        open_pause = db.query(PauseLog).filter(
            PauseLog.labor_entry_id == labor_entry.id,
            PauseLog.resumed_at.is_(None)
        ).order_by(PauseLog.paused_at.desc()).first()
        if open_pause:
            now = datetime.now(open_pause.paused_at.tzinfo) if open_pause.paused_at.tzinfo else datetime.utcnow()
            open_pause.resumed_at = now
            open_pause.duration_seconds = (now - open_pause.paused_at).total_seconds()
            if labor_data.pause_comment:
                open_pause.comment = labor_data.pause_comment

    # Update fields
    update_data = labor_data.model_dump(exclude_unset=True, exclude={'clear_pause'})
    for field, value in update_data.items():
        setattr(labor_entry, field, value)

    # Calculate hours worked if end_time is provided
    if labor_data.end_time and labor_entry.start_time:
        # Validate that end_time is after start_time (prevent negative hours)
        if labor_data.end_time <= labor_entry.start_time:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="End time must be after start time. Please check your times and try again."
            )

        time_diff = labor_data.end_time - labor_entry.start_time
        total_seconds = time_diff.total_seconds()

        # Additional safety check for negative seconds
        if total_seconds < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Calculated time is negative. End time must be after start time."
            )

        # Subtract total pause duration from worked time
        pause_logs = db.query(PauseLog).filter(PauseLog.labor_entry_id == labor_entry.id).all()
        total_pause_secs = sum(l.duration_seconds or 0 for l in pause_logs)
        effective_seconds = max(total_seconds - total_pause_secs, 0)

        hours_worked = round(effective_seconds / 3600, 2)

        # Final validation that hours are not negative
        if hours_worked < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Calculated hours ({hours_worked}) is negative. Please verify your times."
            )

        labor_entry.hours_worked = hours_worked
        # Auto-mark as completed when end_time is set (e.g. admin editing an active entry)
        labor_entry.is_completed = True

    # When labor entry is completed, update linked step and traveler progress
    if labor_data.end_time and labor_entry.is_completed:
        update_step_and_traveler_progress(db, labor_entry)

    # Audit any transition into qty_completed == 0 so reporting can surface
    # who entered it and the justification they gave.
    if (
        "qty_completed" in labor_data.model_fields_set
        and labor_data.qty_completed == 0
        and previous_qty != 0
    ):
        _write_zero_qty_audit(
            db,
            labor_entry,
            current_user,
            previous_qty=previous_qty,
            comment=labor_data.comment if labor_data.comment is not None else labor_entry.comment,
            request=request,
        )

    db.commit()
    db.refresh(labor_entry)

    # Add employee name and job number for response
    employee = db.query(User).filter(User.id == labor_entry.employee_id).first()
    labor_entry.employee_name = f"{employee.first_name} {employee.last_name}" if employee else "Unknown"
    traveler = db.query(Traveler).filter(Traveler.id == labor_entry.traveler_id).first()
    labor_entry.job_number = traveler.job_number if traveler else None

    # Create notification for all admins — include comments, qty, hours for data recovery
    if labor_data.pause_time:
        action = "paused"
    elif labor_data.clear_pause:
        action = "resumed"
    elif labor_data.end_time and not had_end_time_before:
        action = "stopped"
    else:
        action = "updated"

    # Suppress duplicate "stopped" notifications when an operator stops a second
    # labor entry on the same step that was already completed. This happens when
    # an operator needs to log more time on a step they already finished — the
    # admin doesn't need two "stopped" notifications for the same work.
    suppress_notification = False
    if action == "stopped" and labor_entry.step_id:
        from models import Notification
        recent_stop = db.query(Notification).filter(
            Notification.notification_type == NotificationType.LABOR_ENTRY_UPDATED,
            Notification.title == "Labor Entry Stopped",
            Notification.message.like(f"%{labor_entry.work_center}%"),
            Notification.created_by_username == current_user.username,
            Notification.created_at >= datetime.now(timezone.utc) - timedelta(hours=12),
            Notification.reference_type == "labor_entry",
        ).first()
        if recent_stop:
            # Check if the recent notification was for the same job
            prev_entry = db.query(LaborEntry).filter(LaborEntry.id == recent_stop.reference_id).first()
            if prev_entry and prev_entry.traveler_id == labor_entry.traveler_id:
                suppress_notification = True

    if not suppress_notification:
        job_label = traveler.job_number if traveler else 'Unknown Job'
        wc_label = labor_entry.work_center or 'Unknown Work Center'
        notif_msg = f"{current_user.username} {action} labor entry for {job_label} - {wc_label}"

        # Append details so they're captured in notification history
        details = []
        if action == "paused" and labor_data.pause_comment:
            details.append(f"Reason: {labor_data.pause_comment}")
        if action == "resumed" and labor_data.pause_comment:
            details.append(f"Resume note: {labor_data.pause_comment}")
        if action == "stopped" and labor_entry.hours_worked:
            details.append(f"Hours: {labor_entry.hours_worked}h")
        if labor_entry.qty_completed:
            details.append(f"QTY: {labor_entry.qty_completed}")
        if labor_entry.comment:
            details.append(f"Comment: {labor_entry.comment}")
        if details:
            notif_msg += " | " + " | ".join(details)

        create_notification_for_admins(
            db=db,
            notification_type=NotificationType.LABOR_ENTRY_UPDATED,
            title=f"Labor Entry {action.capitalize()}",
            message=notif_msg,
            reference_id=labor_entry.id,
            reference_type="labor_entry",
            created_by_username=current_user.username
        )

    # Build response with pause data
    response_dict = {
        "id": labor_entry.id,
        "traveler_id": labor_entry.traveler_id,
        "step_id": labor_entry.step_id,
        "employee_id": labor_entry.employee_id,
        "employee_name": labor_entry.employee_name,
        "job_number": labor_entry.job_number,
        "job_display": rma_job_display(traveler),
        "start_time": labor_entry.start_time,
        "pause_time": labor_entry.pause_time,
        "end_time": labor_entry.end_time,
        "hours_worked": labor_entry.hours_worked,
        "description": labor_entry.description,
        "is_completed": labor_entry.is_completed,
        "work_center": labor_entry.work_center,
        "sequence_number": labor_entry.sequence_number,
        "qty_completed": labor_entry.qty_completed,
        "comment": labor_entry.comment,
        "created_at": labor_entry.created_at,
        **get_pause_data(db, labor_entry.id)
    }
    return LaborEntryResponse(**response_dict)

@router.delete("/{labor_id}")
async def delete_labor_entry(
    labor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a labor entry (Admin only).

    Soft delete — the row is never removed from the database. It is stamped with
    deleted_at/deleted_by and disappears from every read, so the hours come out
    of all totals while the record itself remains recoverable.
    """

    # Check if user is admin
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only administrators can delete labor entries. Your role: {current_user.role}"
        )

    labor_entry = db.query(LaborEntry).filter(LaborEntry.id == labor_id).first()
    if not labor_entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Labor entry not found"
        )

    # Capture ALL info before deletion for notification (data recovery backup)
    traveler = db.query(Traveler).filter(Traveler.id == labor_entry.traveler_id).first()
    job_number = traveler.job_number if traveler else 'Unknown Job'
    work_center = labor_entry.work_center or 'Unknown Work Center'
    del_details = []
    if labor_entry.hours_worked:
        del_details.append(f"Hours: {labor_entry.hours_worked}h")
    if labor_entry.qty_completed:
        del_details.append(f"QTY: {labor_entry.qty_completed}")
    if labor_entry.comment:
        del_details.append(f"Comment: {labor_entry.comment}")
    if labor_entry.start_time:
        del_details.append(f"Start: {labor_entry.start_time.strftime('%m/%d %H:%M')}")
    if labor_entry.end_time:
        del_details.append(f"End: {labor_entry.end_time.strftime('%m/%d %H:%M')}")
    # Capture pause info
    pause_logs = db.query(PauseLog).filter(PauseLog.labor_entry_id == labor_entry.id).all()
    for pl in pause_logs:
        if pl.comment:
            del_details.append(f"Pause reason: {pl.comment}")

    # Soft delete: the row stays in the database for good. Its hours leave every
    # total because models.install_soft_delete_filter drops stamped rows from all
    # ORM reads. An open (running) timer is also closed out — the partial unique
    # index uq_one_open_labor_entry_per_employee still sees soft-deleted rows, so
    # leaving end_time NULL would block the employee from starting a new entry.
    if labor_entry.end_time is None:
        labor_entry.end_time = datetime.now(timezone.utc)
        labor_entry.is_completed = True
    labor_entry.deleted_at = datetime.now(timezone.utc)
    labor_entry.deleted_by = current_user.id
    for _pl in pause_logs:
        _pl.deleted_at = labor_entry.deleted_at
        _pl.deleted_by = current_user.id
    db.commit()

    del_msg = f"{current_user.username} deleted labor entry for {job_number} - {work_center}"
    if del_details:
        del_msg += " | " + " | ".join(del_details)

    create_notification_for_admins(
        db=db,
        notification_type=NotificationType.LABOR_ENTRY_DELETED,
        title="Labor Entry Deleted",
        message=del_msg,
        reference_id=labor_id,
        reference_type="labor_entry",
        created_by_username=current_user.username
    )

    return {"message": "Labor entry deleted successfully", "id": labor_id}


class AdminPauseLogCreate(BaseModel):
    paused_at: datetime
    resumed_at: datetime
    comment: Optional[str] = None


@router.post("/{labor_id}/pauses")
async def add_pause_log(
    labor_id: int,
    pause_data: AdminPauseLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Admin: Add a pause log to a labor entry and recalculate hours"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    labor_entry = db.query(LaborEntry).filter(LaborEntry.id == labor_id).first()
    if not labor_entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Labor entry not found")

    if pause_data.resumed_at <= pause_data.paused_at:
        raise HTTPException(status_code=400, detail="Resumed time must be after paused time")

    duration_seconds = (pause_data.resumed_at - pause_data.paused_at).total_seconds()

    pause_log = PauseLog(
        labor_entry_id=labor_id,
        paused_at=pause_data.paused_at,
        resumed_at=pause_data.resumed_at,
        duration_seconds=round(duration_seconds, 1),
        comment=pause_data.comment
    )
    db.add(pause_log)

    # Recalculate hours_worked subtracting all pauses
    if labor_entry.start_time and labor_entry.end_time:
        total_seconds = (labor_entry.end_time - labor_entry.start_time).total_seconds()
        all_pauses = db.query(PauseLog).filter(PauseLog.labor_entry_id == labor_id).all()
        total_pause_secs = sum(p.duration_seconds or 0 for p in all_pauses) + duration_seconds
        labor_entry.hours_worked = round(max(total_seconds - total_pause_secs, 0) / 3600, 2)

    db.commit()
    return {"message": "Pause added", "id": pause_log.id, "duration_seconds": pause_log.duration_seconds}


@router.delete("/{labor_id}/pauses/{pause_id}")
async def delete_pause_log(
    labor_id: int,
    pause_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Admin: Delete a pause log and recalculate hours.

    Soft delete — the row is never removed, only stamped and filtered out.
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    pause_log = db.query(PauseLog).filter(PauseLog.id == pause_id, PauseLog.labor_entry_id == labor_id).first()
    if not pause_log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pause log not found")

    # Soft delete — the pause row stays; the flush is required because the
    # session runs with autoflush=False, and the recalculation below must not
    # count a pause that has just been stamped.
    pause_log.deleted_at = datetime.now(timezone.utc)
    pause_log.deleted_by = current_user.id
    db.flush()

    # Recalculate hours_worked
    labor_entry = db.query(LaborEntry).filter(LaborEntry.id == labor_id).first()
    if labor_entry and labor_entry.start_time and labor_entry.end_time:
        total_seconds = (labor_entry.end_time - labor_entry.start_time).total_seconds()
        remaining_pauses = db.query(PauseLog).filter(PauseLog.labor_entry_id == labor_id).all()
        total_pause_secs = sum(p.duration_seconds or 0 for p in remaining_pauses)
        labor_entry.hours_worked = round(max(total_seconds - total_pause_secs, 0) / 3600, 2)

    db.commit()
    return {"message": "Pause deleted", "id": pause_id}


@router.get("/", response_model=List[LaborEntryResponse])
@router.get("", response_model=List[LaborEntryResponse], include_in_schema=False)
async def get_all_labor_entries(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all labor entries"""

    labor_entries = db.query(LaborEntry).order_by(LaborEntry.created_at.desc()).all()

    # Batch-fetch all related users and travelers to avoid N+1 queries
    employee_ids = list(set(e.employee_id for e in labor_entries if e.employee_id))
    traveler_ids = list(set(e.traveler_id for e in labor_entries if e.traveler_id))

    employees = {u.id: u for u in db.query(User).filter(User.id.in_(employee_ids)).all()} if employee_ids else {}
    travelers = {t.id: t for t in db.query(Traveler).filter(Traveler.id.in_(traveler_ids)).all()} if traveler_ids else {}

    result = []
    for entry in labor_entries:
        employee = employees.get(entry.employee_id)
        traveler = travelers.get(entry.traveler_id)

        entry_dict = {
            "id": entry.id,
            "traveler_id": entry.traveler_id,
            "step_id": entry.step_id,
            "employee_id": entry.employee_id,
            "employee_name": f"{employee.first_name} {employee.last_name}" if employee else "Unknown",
            "job_number": traveler.job_number if traveler else None,
            "job_display": rma_job_display(traveler),
            "start_time": entry.start_time,
            "pause_time": entry.pause_time,
            "end_time": entry.end_time,
            "hours_worked": entry.hours_worked,
            "description": entry.description,
            "is_completed": entry.is_completed,
            "work_center": entry.work_center,
            "sequence_number": entry.sequence_number,
            "created_at": entry.created_at,
            "work_order": traveler.work_order_number if traveler else None,
            "po_number": traveler.po_number if traveler else None,
            "part_number": traveler.part_number if traveler else None,
            "quantity": traveler.quantity if traveler else None,
            "qty_completed": entry.qty_completed,
            "comment": entry.comment,
            **get_pause_data(db, entry.id)
        }
        result.append(LaborEntryResponse(**entry_dict))

    return result

@router.get("/traveler/{traveler_id}", response_model=List[LaborEntryResponse])
async def get_traveler_labor_entries(
    traveler_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all labor entries for a traveler"""

    # Verify traveler exists
    traveler = db.query(Traveler).filter(Traveler.id == traveler_id).first()
    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Traveler not found"
        )

    labor_entries = db.query(LaborEntry).filter(LaborEntry.traveler_id == traveler_id).all()

    # Add employee names and job numbers
    result = []
    for entry in labor_entries:
        employee = db.query(User).filter(User.id == entry.employee_id).first()
        entry_dict = {
            "id": entry.id,
            "traveler_id": entry.traveler_id,
            "step_id": entry.step_id,
            "employee_id": entry.employee_id,
            "employee_name": f"{employee.first_name} {employee.last_name}" if employee else "Unknown",
            "job_number": traveler.job_number,
            "job_display": rma_job_display(traveler),
            "start_time": entry.start_time,
            "pause_time": entry.pause_time,
            "end_time": entry.end_time,
            "hours_worked": entry.hours_worked,
            "description": entry.description,
            "is_completed": entry.is_completed,
            "work_center": entry.work_center,
            "sequence_number": entry.sequence_number,
            "qty_completed": entry.qty_completed,
            "comment": entry.comment,
            "created_at": entry.created_at,
            **get_pause_data(db, entry.id)
        }
        result.append(LaborEntryResponse(**entry_dict))

    return result


@router.get("/init")
async def get_labor_init(
    days: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Combined endpoint: returns active entry + my entries + auto-stop check in one call.
    days=0 (default) returns all entries with no time limit."""
    from sqlalchemy import func as sqlfunc

    # 1. Active entry
    active_entry = None
    active_labor = db.query(LaborEntry).filter(
        LaborEntry.employee_id == current_user.id,
        LaborEntry.is_completed == False,
        LaborEntry.end_time.is_(None)
    ).order_by(LaborEntry.start_time.desc()).first()

    if active_labor:
        employee = db.query(User).filter(User.id == active_labor.employee_id).first()
        traveler = db.query(Traveler).filter(Traveler.id == active_labor.traveler_id).first()
        active_entry = {
            "id": active_labor.id, "traveler_id": active_labor.traveler_id,
            "step_id": active_labor.step_id, "employee_id": active_labor.employee_id,
            "employee_name": f"{employee.first_name} {employee.last_name}" if employee else "Unknown",
            "job_number": traveler.job_number if traveler else None,
            "job_display": rma_job_display(traveler),
            "start_time": str(active_labor.start_time), "pause_time": str(active_labor.pause_time) if active_labor.pause_time else None,
            "end_time": None, "hours_worked": active_labor.hours_worked or 0,
            "description": active_labor.description or "", "is_completed": False,
            "work_center": active_labor.work_center, "sequence_number": active_labor.sequence_number,
            "qty_completed": active_labor.qty_completed, "comment": active_labor.comment,
            "created_at": str(active_labor.created_at),
            "work_order": traveler.work_order_number if traveler else None,
            "po_number": traveler.po_number if traveler else None,
            "part_number": traveler.part_number if traveler else None,
            "quantity": traveler.quantity if traveler else None,
            **get_pause_data(db, active_labor.id)
        }

    # 2. My entries (same logic as /my-entries) — always return all, no time limit
    base_query = db.query(LaborEntry)
    if current_user.role != UserRole.ADMIN:
        base_query = base_query.filter(LaborEntry.employee_id == current_user.id)
    labor_entries = base_query.order_by(LaborEntry.created_at.desc()).all()

    employee_ids = list(set(e.employee_id for e in labor_entries if e.employee_id))
    traveler_ids = list(set(e.traveler_id for e in labor_entries if e.traveler_id))
    entry_ids = [e.id for e in labor_entries]
    employees = {u.id: u for u in db.query(User).filter(User.id.in_(employee_ids)).all()} if employee_ids else {}
    travelers = {t.id: t for t in db.query(Traveler).filter(Traveler.id.in_(traveler_ids)).all()} if traveler_ids else {}
    pause_map = get_pause_data_batch(db, entry_ids)

    entries = []
    for entry in labor_entries:
        emp = employees.get(entry.employee_id)
        trav = travelers.get(entry.traveler_id)
        entry_dict = {
            "id": entry.id, "traveler_id": entry.traveler_id, "step_id": entry.step_id,
            "employee_id": entry.employee_id,
            "employee_name": f"{emp.first_name} {emp.last_name}" if emp else "Unknown",
            "job_number": trav.job_number if trav else None,
            "job_display": rma_job_display(trav),
            "start_time": entry.start_time, "pause_time": entry.pause_time,
            "end_time": entry.end_time, "hours_worked": entry.hours_worked or 0,
            "description": entry.description or "", "is_completed": entry.is_completed,
            "work_center": entry.work_center, "work_center_code": None,
            "sequence_number": entry.sequence_number, "qty_completed": entry.qty_completed,
            "comment": entry.comment, "created_at": entry.created_at,
            "work_order": trav.work_order_number if trav else None,
            "po_number": trav.po_number if trav else None,
            "part_number": trav.part_number if trav else None,
            "quantity": trav.quantity if trav else None,
            **pause_map.get(entry.id, {"pause_logs": [], "total_pause_seconds": None, "pause_count": None})
        }
        entries.append(entry_dict)

    # 3. Auto-stop check (5pm)
    auto_stopped = 0
    now = datetime.now()
    if now.hour >= 17:
        running = db.query(LaborEntry).filter(LaborEntry.is_completed == False, LaborEntry.end_time.is_(None)).all()
        for le in running:
            if le.start_time and le.start_time.replace(tzinfo=None).date() < now.date():
                end_dt = datetime.combine(le.start_time.replace(tzinfo=None).date(), datetime.strptime("17:00", "%H:%M").time())
                if le.start_time.tzinfo is not None:
                    end_dt = end_dt.replace(tzinfo=le.start_time.tzinfo)
                le.end_time = end_dt
                le.is_completed = True
                if le.start_time:
                    start_naive = le.start_time.replace(tzinfo=None)
                    end_naive = le.end_time.replace(tzinfo=None) if le.end_time else start_naive
                    diff = (end_naive - start_naive).total_seconds()
                    pause_secs = sum(p.duration_seconds or 0 for p in db.query(PauseLog).filter(PauseLog.labor_entry_id == le.id).all())
                    le.hours_worked = round(max(diff - pause_secs, 0) / 3600, 2)
                auto_stopped += 1
        if auto_stopped > 0:
            db.commit()

    return {
        "active_entry": active_entry,
        "entries": entries,
        "auto_stopped": auto_stopped,
    }


@router.get("/my-entries", response_model=List[LaborEntryResponse])
async def get_my_labor_entries(
    days: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get labor entries - for ADMIN shows all entries, for others shows only their entries.
    days=0 (default) returns all entries with no time limit."""

    # Admin can see all entries, others see only their own. Always all-time, no limit.
    base_query = db.query(LaborEntry)
    if current_user.role != UserRole.ADMIN:
        base_query = base_query.filter(LaborEntry.employee_id == current_user.id)
    labor_entries = base_query.order_by(LaborEntry.created_at.desc()).all()

    # Batch-fetch all related users, travelers, and pause logs to avoid N+1 queries
    employee_ids = list(set(e.employee_id for e in labor_entries if e.employee_id))
    traveler_ids = list(set(e.traveler_id for e in labor_entries if e.traveler_id))
    entry_ids = [e.id for e in labor_entries]

    employees = {u.id: u for u in db.query(User).filter(User.id.in_(employee_ids)).all()} if employee_ids else {}
    travelers = {t.id: t for t in db.query(Traveler).filter(Traveler.id.in_(traveler_ids)).all()} if traveler_ids else {}
    pause_map = get_pause_data_batch(db, entry_ids)

    result = []
    for entry in labor_entries:
        employee = employees.get(entry.employee_id)
        traveler = travelers.get(entry.traveler_id)

        entry_dict = {
            "id": entry.id,
            "traveler_id": entry.traveler_id,
            "step_id": entry.step_id,
            "employee_id": entry.employee_id,
            "employee_name": f"{employee.first_name} {employee.last_name}" if employee else "Unknown",
            "job_number": traveler.job_number if traveler else None,
            "job_display": rma_job_display(traveler),
            "start_time": entry.start_time,
            "pause_time": entry.pause_time,
            "end_time": entry.end_time,
            "hours_worked": entry.hours_worked,
            "description": entry.description,
            "is_completed": entry.is_completed,
            "work_center": entry.work_center,
            "sequence_number": entry.sequence_number,
            "qty_completed": entry.qty_completed,
            "comment": entry.comment,
            "created_at": entry.created_at,
            "work_order": traveler.work_order_number if traveler else None,
            "po_number": traveler.po_number if traveler else None,
            "part_number": traveler.part_number if traveler else None,
            "quantity": traveler.quantity if traveler else None,
            **pause_map.get(entry.id, {"pause_logs": [], "total_pause_seconds": None, "pause_count": None})
        }
        result.append(LaborEntryResponse(**entry_dict))

    return result

@router.get("/active", response_model=Optional[LaborEntryResponse])
async def get_active_labor_entry(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get current user's active labor entry"""

    active_entry = db.query(LaborEntry).filter(
        (LaborEntry.employee_id == current_user.id) &
        (LaborEntry.end_time.is_(None)) &
        (LaborEntry.is_completed == False)
    ).first()

    if not active_entry:
        return None

    # Get the work_center_code from the linked process step (for QR auto-stop matching)
    work_center_code = active_entry.work_center or ''
    if active_entry.step_id:
        step = db.query(ProcessStep).filter(ProcessStep.id == active_entry.step_id).first()
        if step:
            work_center_code = step.work_center_code or ''

    # Get the traveler's quantity for the qty modal
    traveler_qty = None
    traveler = None
    if active_entry.traveler_id:
        traveler = db.query(Traveler).filter(Traveler.id == active_entry.traveler_id).first()
        if traveler:
            traveler_qty = traveler.quantity

    entry_dict = {
        "id": active_entry.id,
        "traveler_id": active_entry.traveler_id,
        "step_id": active_entry.step_id,
        "employee_id": active_entry.employee_id,
        "employee_name": f"{current_user.first_name} {current_user.last_name}",
        "job_number": active_entry.job_number,
        "job_display": rma_job_display(traveler) or active_entry.job_number,
        "start_time": active_entry.start_time,
        "pause_time": active_entry.pause_time,
        "end_time": active_entry.end_time,
        "hours_worked": active_entry.hours_worked,
        "description": active_entry.description,
        "is_completed": active_entry.is_completed,
        "work_center": active_entry.work_center,
        "work_center_code": work_center_code,
        "sequence_number": active_entry.sequence_number,
        "comment": active_entry.comment,
        "created_at": active_entry.created_at,
        "quantity": traveler_qty,
        **get_pause_data(db, active_entry.id)
    }

    return LaborEntryResponse(**entry_dict)

@router.post("/auto-stop-5pm")
async def auto_stop_entries_at_5pm(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Auto-stop all active labor entries at 5pm (17:00)
    This can be called by a scheduled task or manually by admin"""

    # Only admin can trigger this
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can trigger auto-stop"
        )

    # Get all active (uncompleted) entries
    active_entries = db.query(LaborEntry).filter(
        (LaborEntry.end_time.is_(None)) &
        (LaborEntry.is_completed == False)
    ).all()

    # Set end time to 5pm (17:00) of today
    today = datetime.now().date()
    end_time_5pm = datetime.combine(today, datetime.strptime("17:00:00", "%H:%M:%S").time())

    completed_count = 0
    for entry in active_entries:
        # Only auto-stop if entry started before 5pm
        if entry.start_time < end_time_5pm:
            entry.end_time = end_time_5pm
            entry.is_completed = True
            # Calculate hours worked
            time_diff = end_time_5pm - entry.start_time
            entry.hours_worked = round(time_diff.total_seconds() / 3600, 2)
            update_step_and_traveler_progress(db, entry)
            completed_count += 1

    db.commit()

    return {
        "message": f"Auto-stopped {completed_count} active entries at 5pm",
        "completed_count": completed_count,
        "end_time": end_time_5pm.isoformat()
    }

@router.get("/check-auto-stop")
async def check_and_auto_stop(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Check if it's past 5pm and auto-stop any active entries from today
    This should be called when page loads to ensure entries are auto-stopped"""

    now = datetime.now()
    today = now.date()
    five_pm = datetime.combine(today, datetime.strptime("17:00:00", "%H:%M:%S").time())

    # Only process if current time is past 5pm
    if now < five_pm:
        return {
            "message": "Not yet 5pm, no auto-stop performed",
            "current_time": now.isoformat(),
            "cutoff_time": five_pm.isoformat(),
            "completed_count": 0
        }

    # Get all active entries that started today (or earlier) and before 5pm
    active_entries = db.query(LaborEntry).filter(
        (LaborEntry.end_time.is_(None)) &
        (LaborEntry.is_completed == False) &
        (LaborEntry.start_time < five_pm)
    ).all()

    completed_count = 0
    for entry in active_entries:
        entry.end_time = five_pm
        entry.is_completed = True
        # Calculate hours worked
        time_diff = five_pm - entry.start_time
        entry.hours_worked = round(time_diff.total_seconds() / 3600, 2)
        update_step_and_traveler_progress(db, entry)
        completed_count += 1

    if completed_count > 0:
        db.commit()

    return {
        "message": f"Auto-stopped {completed_count} entries at 5pm cutoff",
        "current_time": now.isoformat(),
        "cutoff_time": five_pm.isoformat(),
        "completed_count": completed_count
    }

@router.get("/summary")
async def get_labor_summary(
    days: int = 7,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get labor summary statistics"""

    start_date = datetime.now() - timedelta(days=days)

    # Get labor entries for the period
    labor_entries = db.query(LaborEntry).filter(
        LaborEntry.created_at >= start_date
    )

    # For non-admin users, filter to their own entries
    if current_user.role != UserRole.ADMIN:
        labor_entries = labor_entries.filter(LaborEntry.employee_id == current_user.id)

    labor_entries = labor_entries.all()

    # Calculate statistics
    total_hours = sum(entry.hours_worked for entry in labor_entries)
    total_entries = len(labor_entries)
    completed_entries = len([entry for entry in labor_entries if entry.is_completed])
    active_entries = len([entry for entry in labor_entries if not entry.is_completed and entry.end_time is None])

    return {
        "period_days": days,
        "total_hours": round(total_hours, 2),
        "total_entries": total_entries,
        "completed_entries": completed_entries,
        "active_entries": active_entries,
        "completion_rate": round((completed_entries / total_entries * 100) if total_entries > 0 else 0, 1)
    }

@router.get("/hours-summary")
async def get_labor_hours_summary(
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get labor hours summary report with weekly and monthly breakdowns per employee"""

    from collections import defaultdict
    from datetime import date

    start_date = datetime.now() - timedelta(days=days)

    # Get labor entries for the period (completed only)
    labor_entries = db.query(LaborEntry).filter(
        (LaborEntry.created_at >= start_date) &
        (LaborEntry.is_completed == True) &
        (LaborEntry.end_time.isnot(None))
    ).all()

    # Group entries by employee
    employee_data = defaultdict(lambda: {
        "employee_id": None,
        "employee_name": "",
        "weekly_hours": defaultdict(float),
        "monthly_hours": defaultdict(float),
        "daily_hours": defaultdict(float),
        "total_hours": 0
    })

    for entry in labor_entries:
        # Get employee info
        employee = db.query(User).filter(User.id == entry.employee_id).first()
        if not employee:
            continue

        employee_key = entry.employee_id
        employee_name = f"{employee.first_name} {employee.last_name}"

        if employee_data[employee_key]["employee_id"] is None:
            employee_data[employee_key]["employee_id"] = entry.employee_id
            employee_data[employee_key]["employee_name"] = employee_name

        # Parse start time to get week and month
        entry_date = entry.start_time.date() if isinstance(entry.start_time, datetime) else entry.start_time

        # Calculate week start (Monday)
        week_start = entry_date - timedelta(days=entry_date.weekday())
        week_key = week_start.strftime("%Y-%m-%d")  # Week starting Monday

        # Calculate month
        month_key = entry_date.strftime("%Y-%m")  # YYYY-MM format

        # Calculate day
        day_key = entry_date.strftime("%Y-%m-%d")

        # Add hours to respective buckets
        hours = entry.hours_worked or 0
        employee_data[employee_key]["weekly_hours"][week_key] += hours
        employee_data[employee_key]["monthly_hours"][month_key] += hours
        employee_data[employee_key]["daily_hours"][day_key] += hours
        employee_data[employee_key]["total_hours"] += hours

    # Format response
    summary = []
    for emp_id, data in employee_data.items():
        # Convert weekly hours to list format
        weekly_breakdown = [
            {
                "week_start": week,
                "week_end": (datetime.strptime(week, "%Y-%m-%d") + timedelta(days=6)).strftime("%Y-%m-%d"),
                "hours": round(hours, 2)
            }
            for week, hours in sorted(data["weekly_hours"].items())
        ]

        # Convert monthly hours to list format
        monthly_breakdown = [
            {
                "month": month,
                "month_name": datetime.strptime(month + "-01", "%Y-%m-%d").strftime("%B %Y"),
                "hours": round(hours, 2)
            }
            for month, hours in sorted(data["monthly_hours"].items())
        ]

        # Convert daily hours to list format
        daily_breakdown = [
            {
                "date": day,
                "hours": round(hours, 2)
            }
            for day, hours in sorted(data["daily_hours"].items())
        ]

        summary.append({
            "employee_id": data["employee_id"],
            "employee_name": data["employee_name"],
            "total_hours": round(data["total_hours"], 2),
            "weekly_breakdown": weekly_breakdown,
            "monthly_breakdown": monthly_breakdown,
            "daily_breakdown": daily_breakdown
        })

    # Sort by employee name
    summary.sort(key=lambda x: x["employee_name"])

    return {
        "period_days": days,
        "employees": summary,
        "total_employees": len(summary)
    }

@router.get("/category-report")
async def get_labor_by_category(
    category: Optional[str] = None,
    job_number: Optional[str] = None,
    work_order: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get labor entries grouped by work center category (e.g. SMT hrs. Actual, HAND hrs. Actual)"""
    from sqlalchemy import func as sql_func

    # Build a lookup of work center name -> category
    work_centers = db.query(WorkCenter).all()
    wc_category_map = {}
    for wc in work_centers:
        if wc.name and wc.category:
            wc_category_map[wc.name.upper().strip()] = wc.category

    # Get all labor entries
    query = db.query(LaborEntry)
    labor_entries = query.order_by(LaborEntry.created_at.desc()).all()

    # Batch-fetch related data
    employee_ids = list(set(e.employee_id for e in labor_entries if e.employee_id))
    traveler_ids = list(set(e.traveler_id for e in labor_entries if e.traveler_id))
    employees = {u.id: u for u in db.query(User).filter(User.id.in_(employee_ids)).all()} if employee_ids else {}
    travelers = {t.id: t for t in db.query(Traveler).filter(Traveler.id.in_(traveler_ids)).all()} if traveler_ids else {}

    results = []
    for entry in labor_entries:
        traveler = travelers.get(entry.traveler_id)
        employee = employees.get(entry.employee_id)

        # Determine category from work center name
        wc_name = (entry.work_center or '').upper().strip()
        entry_category = wc_category_map.get(wc_name, None)

        # Filter by category if specified
        if category and category.strip():
            if not entry_category or entry_category.lower() != category.lower():
                continue

        # Filter by job number. Strip the search term before comparing — inputs
        # arrive with stray leading/trailing spaces (e.g. " 24133-50" from a
        # copy-paste or QR scan), and comparing the un-stripped value against the
        # clean stored value matched nothing, emptying the whole report.
        if job_number and job_number.strip():
            job = (traveler.job_number if traveler else '') or ''
            if job_number.strip().lower() not in job.lower():
                continue

        # Filter by work order (same strip — a leading space here was the actual
        # cause of "No labor entries found" on jobs that clearly had labor).
        if work_order and work_order.strip():
            wo = (traveler.work_order_number if traveler else '') or ''
            if work_order.strip().lower() not in wo.lower():
                continue

        # Filter by date range
        if start_date and entry.start_time:
            entry_date = entry.start_time.strftime('%Y-%m-%d')
            if entry_date < start_date:
                continue
        if end_date and entry.start_time:
            entry_date = entry.start_time.strftime('%Y-%m-%d')
            if entry_date > end_date:
                continue

        results.append({
            "id": entry.id,
            "traveler_id": entry.traveler_id,
            "employee_id": entry.employee_id,
            "employee_name": f"{employee.first_name} {employee.last_name}" if employee else "Unknown",
            "job_number": traveler.job_number if traveler else None,
            "job_display": rma_job_display(traveler),
            "work_order": traveler.work_order_number if traveler else None,
            "po_number": traveler.po_number if traveler else None,
            "part_number": traveler.part_number if traveler else None,
            "quantity": traveler.quantity if traveler else None,
            "work_center": entry.work_center,
            "category": entry_category or "Uncategorized",
            "step_id": entry.step_id,
            "start_time": entry.start_time.isoformat() if entry.start_time else None,
            "end_time": entry.end_time.isoformat() if entry.end_time else None,
            "hours_worked": entry.hours_worked or 0,
            "qty_completed": entry.qty_completed,
            "is_completed": entry.is_completed,
            "description": entry.description,
        })

    return results