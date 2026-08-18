import os
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import func as sql_func
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

from database import get_db
from models import User, WorkCenter, WorkCenterAuditLog, UserRole, NotificationType
from routers.auth import get_current_user
from services.notification_service import create_notification_for_admins

router = APIRouter()


# ─── AUDIT + NOTIFICATION HELPERS ────────────────────────────────────────────

def _audit_wc(
    db: Session,
    user: User,
    action: str,
    wc: Optional[WorkCenter] = None,
    wc_id: Optional[int] = None,
    name: Optional[str] = None,
    code: Optional[str] = None,
    traveler_type: Optional[str] = None,
    field_changed: Optional[str] = None,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
    request: Optional[Request] = None,
) -> None:
    """Write a row to work_center_audit_logs. Caller commits."""
    ip = request.client.host if request and request.client else None
    ua = request.headers.get("user-agent") if request else None
    db.add(WorkCenterAuditLog(
        user_id=user.id,
        action=action,
        work_center_id=(wc.id if wc else wc_id),
        work_center_name=(wc.name if wc else name),
        work_center_code=(wc.code if wc else code),
        traveler_type=(wc.traveler_type if wc else traveler_type),
        field_changed=field_changed,
        old_value=old_value,
        new_value=new_value,
        ip_address=ip,
        user_agent=ua,
    ))


def _notify_admins_wc(
    db: Session,
    ntype: NotificationType,
    title: str,
    message: str,
    wc_id: Optional[int],
    username: str,
) -> None:
    """Wrapper around create_notification_for_admins that survives failures so
    an audit-path bug can never block a work-center write."""
    try:
        create_notification_for_admins(
            db=db,
            notification_type=ntype,
            title=title,
            message=message,
            reference_id=wc_id,
            reference_type="work_center",
            created_by_username=username,
        )
    except Exception as e:
        print(f"Warning: admin notification failed for {ntype}: {e}")


class WorkCenterCreate(BaseModel):
    name: str
    code: str
    description: str = ""
    traveler_type: Optional[str] = None
    category: Optional[str] = None
    department: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: bool = True


class WorkCenterUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    traveler_type: Optional[str] = None
    category: Optional[str] = None
    department: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class WorkCenterResponse(BaseModel):
    id: int
    name: str
    code: str
    description: Optional[str] = None
    traveler_type: Optional[str] = None
    category: Optional[str] = None
    department: Optional[str] = None
    sort_order: int = 0
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ReorderItem(BaseModel):
    id: int
    sort_order: int


class ReorderRequest(BaseModel):
    items: List[ReorderItem]


@router.get("/", response_model=List[WorkCenterResponse])
@router.get("", response_model=List[WorkCenterResponse], include_in_schema=False)
async def get_work_centers(
    traveler_type: Optional[str] = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all work centers, optionally filtered by traveler type"""
    query = db.query(WorkCenter)

    if not include_inactive:
        query = query.filter(WorkCenter.is_active == True)

    if traveler_type:
        query = query.filter(WorkCenter.traveler_type == traveler_type)

    return query.order_by(WorkCenter.sort_order, WorkCenter.id).all()


class WorkCenterAuditLogResponse(BaseModel):
    id: int
    user_id: int
    username: Optional[str] = None
    action: str
    work_center_id: Optional[int] = None
    work_center_name: Optional[str] = None
    work_center_code: Optional[str] = None
    traveler_type: Optional[str] = None
    field_changed: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    timestamp: datetime
    ip_address: Optional[str] = None


@router.get("/audit-log", response_model=List[WorkCenterAuditLogResponse])
async def get_work_center_audit_log(
    limit: int = 200,
    work_center_id: Optional[int] = None,
    traveler_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Most recent work-center changes. ADMIN only."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only admins can view the work center audit log")

    q = db.query(WorkCenterAuditLog)
    if work_center_id is not None:
        q = q.filter(WorkCenterAuditLog.work_center_id == work_center_id)
    if traveler_type:
        q = q.filter(WorkCenterAuditLog.traveler_type == traveler_type)
    rows = q.order_by(WorkCenterAuditLog.timestamp.desc()).limit(max(1, min(limit, 1000))).all()

    # Resolve usernames without N+1 — single IN query.
    user_ids = {r.user_id for r in rows}
    users = {u.id: u.username for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return [
        WorkCenterAuditLogResponse(
            id=r.id,
            user_id=r.user_id,
            username=users.get(r.user_id),
            action=r.action,
            work_center_id=r.work_center_id,
            work_center_name=r.work_center_name,
            work_center_code=r.work_center_code,
            traveler_type=r.traveler_type,
            field_changed=r.field_changed,
            old_value=r.old_value,
            new_value=r.new_value,
            timestamp=r.timestamp,
            ip_address=r.ip_address,
        )
        for r in rows
    ]


@router.post("/", response_model=WorkCenterResponse)
@router.post("", response_model=WorkCenterResponse, include_in_schema=False)
async def create_work_center(
    wc_data: WorkCenterCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new work center (Admin only) - added at the bottom"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only admins can create work centers")

    # Check if code already exists
    existing = db.query(WorkCenter).filter(WorkCenter.code == wc_data.code).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Work center with code '{wc_data.code}' already exists")

    # Determine sort_order: use provided value or append to bottom
    if wc_data.sort_order is not None and wc_data.sort_order > 0:
        target_order = wc_data.sort_order
        # Shift existing items at or after this position down by 1
        existing = db.query(WorkCenter).filter(
            WorkCenter.traveler_type == wc_data.traveler_type,
            WorkCenter.sort_order >= target_order
        ).all()
        for wc in existing:
            wc.sort_order += 1
    else:
        max_order = db.query(sql_func.max(WorkCenter.sort_order)).filter(
            WorkCenter.traveler_type == wc_data.traveler_type
        ).scalar() or 0
        target_order = max_order + 1

    db_wc = WorkCenter(
        name=wc_data.name,
        code=wc_data.code,
        description=wc_data.description,
        traveler_type=wc_data.traveler_type,
        category=wc_data.category,
        department=wc_data.department,
        sort_order=target_order,
        is_active=wc_data.is_active
    )
    db.add(db_wc)
    db.flush()
    _audit_wc(db, current_user, "CREATED", wc=db_wc, field_changed="*",
              new_value=f"name={db_wc.name}; code={db_wc.code}; type={db_wc.traveler_type}; sort={db_wc.sort_order}",
              request=request)
    db.commit()
    db.refresh(db_wc)
    _notify_admins_wc(
        db=db,
        ntype=NotificationType.WORK_CENTER_CREATED,
        title=f"Work center created: {db_wc.name}",
        message=(
            f"{current_user.username} created work center '{db_wc.name}' "
            f"(code={db_wc.code}, type={db_wc.traveler_type or '—'}, sort={db_wc.sort_order})."
        ),
        wc_id=db_wc.id,
        username=current_user.username,
    )
    return db_wc


@router.put("/reorder", response_model=dict)
async def reorder_work_centers(
    reorder_data: ReorderRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Reorder work centers (Admin only)"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only admins can reorder work centers")

    moves: List[str] = []
    for item in reorder_data.items:
        wc = db.query(WorkCenter).filter(WorkCenter.id == item.id).first()
        if wc and wc.sort_order != item.sort_order:
            _audit_wc(db, current_user, "REORDERED", wc=wc, field_changed="sort_order",
                      old_value=str(wc.sort_order), new_value=str(item.sort_order),
                      request=request)
            moves.append(f"{wc.name}: {wc.sort_order} → {item.sort_order}")
            wc.sort_order = item.sort_order
        elif wc:
            wc.sort_order = item.sort_order

    db.commit()
    if moves:
        _notify_admins_wc(
            db=db,
            ntype=NotificationType.WORK_CENTER_REORDERED,
            title=f"Work centers reordered ({len(moves)})",
            message=(
                f"{current_user.username} reordered {len(moves)} work center(s): "
                + "; ".join(moves[:10])
                + (" …" if len(moves) > 10 else "")
            ),
            wc_id=None,
            username=current_user.username,
        )
    return {"message": f"Reordered {len(reorder_data.items)} work centers"}


@router.put("/{wc_id}", response_model=WorkCenterResponse)
async def update_work_center(
    wc_id: int,
    wc_data: WorkCenterUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a work center (Admin only)"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only admins can update work centers")

    wc = db.query(WorkCenter).filter(WorkCenter.id == wc_id).first()
    if not wc:
        raise HTTPException(status_code=404, detail="Work center not found")

    # Check code uniqueness if changing
    if wc_data.code and wc_data.code != wc.code:
        existing = db.query(WorkCenter).filter(WorkCenter.code == wc_data.code).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Work center with code '{wc_data.code}' already exists")

    # Capture per-field old values for the audit trail before applying.
    update_data = wc_data.model_dump(exclude_unset=True)
    changes: List[str] = []
    for field, value in update_data.items():
        old = getattr(wc, field, None)
        if old != value:
            _audit_wc(db, current_user, "UPDATED", wc=wc, field_changed=field,
                      old_value=str(old) if old is not None else None,
                      new_value=str(value) if value is not None else None,
                      request=request)
            changes.append(f"{field}: {old!r} → {value!r}")
        setattr(wc, field, value)

    db.commit()
    db.refresh(wc)
    if changes:
        _notify_admins_wc(
            db=db,
            ntype=NotificationType.WORK_CENTER_UPDATED,
            title=f"Work center updated: {wc.name}",
            message=(
                f"{current_user.username} updated work center '{wc.name}' "
                f"(code={wc.code}). Changes: " + "; ".join(changes[:10])
                + (" …" if len(changes) > 10 else "")
            ),
            wc_id=wc.id,
            username=current_user.username,
        )
    return wc


@router.post("/reset-pcb-assembly")
async def reset_pcb_assembly(
    secret: str = "",
    db: Session = Depends(get_db),
):
    """Wipe all PCB_ASSEMBLY work centers and reinsert the correct 46 in order"""
    expected_secret = os.getenv("RESET_SECRET", "")
    if not expected_secret or secret != expected_secret:
        raise HTTPException(status_code=403, detail="Invalid secret")

    try:
        from sqlalchemy import text
        # Clear FK references in process_steps first, then delete work centers
        pcb_codes = [wc.code for wc in db.query(WorkCenter).filter(WorkCenter.traveler_type == 'PCB_ASSEMBLY').all()]
        if pcb_codes:
            db.execute(text("DELETE FROM process_steps WHERE work_center_code = ANY(:codes)"), {"codes": pcb_codes})
        deleted = db.query(WorkCenter).filter(WorkCenter.traveler_type == 'PCB_ASSEMBLY').delete()
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")

    PCB_ASSY = [
        ('ENGINEERING', 'Reverse engineering and design', 'Engineering/Prep', None),
        ('GENERATE CAD', 'Generate CAD design files', 'Engineering/Prep', None),
        ('VERIFY BOM', 'Verify no BOM or rev changes', 'Engineering/Prep', None),
        ('GENERATE GERBER', 'Generate Gerber files for PCB fabrication', 'Engineering/Prep', None),
        ('VERIFY GERBER', 'Verify Gerber files for accuracy', 'Engineering/Prep', None),
        ('MAKE SILKSCREEN', 'Create silkscreen layer for component identification', 'Engineering/Prep', None),
        ('CREATE BOM', 'Create Bill of Materials for the assembly', 'Engineering/Prep', None),
        ('KITTING', 'Pull parts from inventory to place in a kit for manufacturing', 'Receiving', None),
        ('COMPONENT PREP', 'Pre-bending of parts or any necessary alteration of a part prior to production', 'TH', None),
        ('PROGRAM PART', 'Parts that need to be programmed prior to SMT', 'Test/Soldering', 'SMT hrs. Actual'),
        ('HAND SOLDER', 'Anything that must be soldered by hand, no wave, no SMT', 'Soldering', 'HAND hrs. Actual'),
        ('SMT PROGRAMING', 'Programming the SMT placement machine', 'SMT', 'SMT hrs. Actual'),
        ('FEEDER LOAD', 'The time it takes to load all needed parts onto feeders/Matrix trays', 'SMT', 'SMT hrs. Actual'),
        ('SMT SET UP', 'The time it takes to align parts/make needed changes to programs', 'SMT', 'SMT hrs. Actual'),
        ('GLUE', 'Gluing done at SMT after paste to make sure parts stay on', 'SMT', 'SMT hrs. Actual'),
        ('SMT TOP', 'SMT top placed', 'SMT', 'SMT hrs. Actual'),
        ('SMT BOTTOM', 'SMT bottom placed', 'SMT', 'SMT hrs. Actual'),
        ('WASH', 'Process of cleaning a dirty PCB', 'ALL', 'HAND hrs. Actual'),
        ('X-RAY', 'Visual continuity check of components as requested by customer', 'SMT/Soldering/Test', None),
        ('MANUAL INSERTION', 'Install prepared parts before wave', 'TH', 'TH hrs. Actual'),
        ('WAVE', 'Wave soldering process', 'TH', 'TH hrs. Actual'),
        ('WASH', 'Post-wave cleaning process', 'ALL', 'HAND hrs. Actual'),
        ('CLEAN TEST', 'Use the ion tester to check cleanliness', 'ALL', None),
        ('TRIM', 'Cut excess leads on backside', 'TH/Soldering', 'HAND hrs. Actual'),
        ('PRESS FIT', 'Use pressure to insert a part on the PCB', 'Soldering', None),
        ('HAND ASSEMBLY', 'Assembly of parts after wave but before inspection', 'TH', 'HAND hrs. Actual'),
        ('AOI PROGRAMMING', 'Programming the AOI machine', 'Quality', 'AOI & Final Inspection, QC hrs. Actual'),
        ('AOI', 'Automated Optical Inspection of the PCB', 'Quality', 'AOI & Final Inspection, QC hrs. Actual'),
        ('SECONDARY ASSEMBLY', 'Anything assembled after ESS testing or inspection', 'Soldering', None),
        ('EPOXY', 'Anything that needs to be glued or epoxied', 'ALL', 'HAND hrs. Actual'),
        ('INTERNAL TESTING', 'In house test at ACI', 'Test', 'E-TEST hrs. Actual'),
        ('LABELING', 'Place a label on the board per BOM instructions', 'Shipping', 'Labelling, Packaging, Shipping hrs. Actual'),
        ('DEPANEL', 'Break panel into individual boards', 'Shipping', 'HAND hrs. Actual'),
        ('PRODUCT PICTURES', 'Take pictures of product before shipping', 'Quality/Shipping/Test', None),
        ('SEND TO EXTERNAL COATING', 'Operator to sign and ship to coating', 'Shipping', None),
        ('RETURN FROM EXTERNAL COATING', 'Operator to sign when received from coating', 'Receiving/Test', None),
        ('INTERNAL COATING', 'In house coating at ACI', 'Coating', 'HAND hrs. Actual'),
        ('INTERNAL TESTING', 'Post-coating in house test at ACI', 'Test', 'E-TEST hrs. Actual'),
        ('SEND TO ESS', 'Operator to sign and ship to ESS', 'Shipping', None),
        ('RETURN FROM ESS', 'Operator to sign when received from ESS', 'Receiving/Test', None),
        ('INTERNAL TESTING', 'Post-ESS in house test at ACI', 'Test', 'E-TEST hrs. Actual'),
        ('VISUAL INSPECTION', 'Human visual inspection parts and coating, no AOI', 'Quality', 'AOI & Final Inspection, QC hrs. Actual'),
        ('MANUAL ASSEMBLY', 'Put the assembly together by hand', 'Soldering/Cable', 'TH hrs. Actual'),
        ('BOX ASSEMBLY', 'Mechanical build consisting of the PCBA, hardware, and/or housings', 'Soldering/Cable', 'HAND hrs. Actual'),
        ('HARDWARE', 'Adding screws, nuts, bolts, brackets, displays, etc.', 'Soldering/Cable', 'Labelling, Packaging, Shipping hrs. Actual'),
        ('SHIPPING', 'Send product to customer per packing request', 'Shipping', 'Labelling, Packaging, Shipping hrs. Actual'),
    ]

    try:
        used_codes = set()
        for idx, (name, desc, dept, cat) in enumerate(PCB_ASSY):
            base_code = f"PCB_ASSEMBLY_{name.replace(' ', '_').replace('/', '_').replace('&', 'AND').replace('-', '_').upper()}"
            code = base_code
            if code in used_codes:
                code = f"{base_code}_{idx+1}"
            used_codes.add(code)
            db.add(WorkCenter(
                name=name, code=code, description=desc,
                traveler_type='PCB_ASSEMBLY', department=dept,
                category=cat, sort_order=idx + 1, is_active=True
            ))
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Insert failed: {str(e)}")

    return {"message": f"Deleted {deleted} old entries, inserted {len(PCB_ASSY)} PCB_ASSEMBLY work centers"}


@router.delete("/{wc_id}")
async def delete_work_center(
    wc_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a work center (Admin only).

    Deactivates it — the row is never removed, so historical labor and steps
    that reference it stay resolvable.
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only admins can delete work centers")

    wc = db.query(WorkCenter).filter(WorkCenter.id == wc_id).first()
    if not wc:
        raise HTTPException(status_code=404, detail="Work center not found")

    # Capture the row BEFORE delete so the audit + notification have details.
    deleted_snapshot = (
        f"name={wc.name}; code={wc.code}; type={wc.traveler_type}; "
        f"sort={wc.sort_order}; active={wc.is_active}"
    )
    deleted_name = wc.name
    deleted_code = wc.code
    deleted_type = wc.traveler_type
    _audit_wc(db, current_user, "DELETED", wc_id=wc.id,
              name=deleted_name, code=deleted_code, traveler_type=deleted_type,
              field_changed="*", old_value=deleted_snapshot,
              request=request)

    # Deactivate, never remove. Labor entries and process steps reference a work
    # center by code; dropping the row would leave that history pointing at a
    # work center nobody can look up. is_active=False takes it out of use.
    wc.is_active = False
    db.commit()
    _notify_admins_wc(
        db=db,
        ntype=NotificationType.WORK_CENTER_DELETED,
        title=f"Work center deleted: {deleted_name}",
        message=(
            f"{current_user.username} deleted work center '{deleted_name}' "
            f"(code={deleted_code}, type={deleted_type or '—'})."
        ),
        wc_id=wc_id,
        username=current_user.username,
    )
    return {"message": f"Work center '{deleted_name}' deleted successfully", "id": wc_id}
