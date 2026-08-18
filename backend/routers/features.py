"""Phase 3: Shifts, Labor Rates, Job Documents, Quality Checklists,
Communication Logs, and Admin Override UI data.

Provides CRUD endpoints for each new model plus the kitting timer
admin override listing endpoint.
"""
import os
import uuid
import shutil
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import (
    Shift, LaborRate, JobDocument, QualityCheckItem, CommunicationLog,
    User, Traveler, ProcessStep, KittingTimerSession, KittingEventLog,
    UserRole,
)
from routers.auth import get_current_user

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "uploads", "documents")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ═══════════════════════════════════════════════════════════════════
# SHIFTS
# ═══════════════════════════════════════════════════════════════════

class ShiftCreate(BaseModel):
    name: str
    start_hour: int = 7
    end_hour: int = 15

class ShiftOut(BaseModel):
    id: int; name: str; start_hour: int; end_hour: int; is_active: bool
    class Config:
        from_attributes = True

@router.get("/shifts", response_model=List[ShiftOut])
def list_shifts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Shift).filter(Shift.is_active == True).order_by(Shift.start_hour).all()

@router.post("/shifts", response_model=ShiftOut)
def create_shift(body: ShiftCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    s = Shift(name=body.name, start_hour=body.start_hour, end_hour=body.end_hour)
    db.add(s); db.commit(); db.refresh(s)
    return s

@router.delete("/shifts/{shift_id}")
def delete_shift(shift_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    s = db.query(Shift).filter(Shift.id == shift_id).first()
    if not s: raise HTTPException(404, "Shift not found")
    s.is_active = False; db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════
# LABOR RATES
# ═══════════════════════════════════════════════════════════════════

class LaborRateCreate(BaseModel):
    name: str
    rate_per_hour: float = 35.0
    department: Optional[str] = None
    is_default: bool = False

class LaborRateOut(BaseModel):
    id: int; name: str; rate_per_hour: float; department: Optional[str]; is_default: bool; is_active: bool
    class Config:
        from_attributes = True

@router.get("/labor-rates", response_model=List[LaborRateOut])
def list_labor_rates(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(LaborRate).filter(LaborRate.is_active == True).order_by(LaborRate.is_default.desc(), LaborRate.name).all()

@router.post("/labor-rates", response_model=LaborRateOut)
def create_labor_rate(body: LaborRateCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if body.is_default:
        db.query(LaborRate).filter(LaborRate.is_default == True).update({"is_default": False})
    r = LaborRate(name=body.name, rate_per_hour=body.rate_per_hour, department=body.department, is_default=body.is_default)
    db.add(r); db.commit(); db.refresh(r)
    return r

@router.put("/labor-rates/{rate_id}", response_model=LaborRateOut)
def update_labor_rate(rate_id: int, body: LaborRateCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    r = db.query(LaborRate).filter(LaborRate.id == rate_id).first()
    if not r: raise HTTPException(404, "Rate not found")
    if body.is_default:
        db.query(LaborRate).filter(LaborRate.is_default == True, LaborRate.id != rate_id).update({"is_default": False})
    r.name = body.name; r.rate_per_hour = body.rate_per_hour; r.department = body.department; r.is_default = body.is_default
    db.commit(); db.refresh(r)
    return r

@router.delete("/labor-rates/{rate_id}")
def delete_labor_rate(rate_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    r = db.query(LaborRate).filter(LaborRate.id == rate_id).first()
    if not r: raise HTTPException(404, "Rate not found")
    r.is_active = False; db.commit()
    return {"ok": True}

def get_effective_rate(db: Session, department: Optional[str] = None) -> float:
    """Get the effective labor rate. Checks department-specific first, then default, then $35."""
    if department:
        r = db.query(LaborRate).filter(LaborRate.department == department, LaborRate.is_active == True).first()
        if r: return r.rate_per_hour
    r = db.query(LaborRate).filter(LaborRate.is_default == True, LaborRate.is_active == True).first()
    if r: return r.rate_per_hour
    return 35.0


# ═══════════════════════════════════════════════════════════════════
# JOB DOCUMENTS (file upload/download)
# ═══════════════════════════════════════════════════════════════════

class DocumentOut(BaseModel):
    id: int; traveler_id: int; filename: str; original_name: str;
    file_size: Optional[int]; content_type: Optional[str]; category: str;
    uploaded_by: Optional[int]; note: Optional[str]; created_at: datetime
    class Config:
        from_attributes = True

@router.get("/documents/{traveler_id}", response_model=List[DocumentOut])
def list_documents(traveler_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(JobDocument).filter(JobDocument.traveler_id == traveler_id).order_by(JobDocument.created_at.desc()).all()

@router.post("/documents/{traveler_id}", response_model=DocumentOut)
async def upload_document(
    traveler_id: int,
    file: UploadFile = File(...),
    category: str = Form("general"),
    note: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(403, "Only admins can add documents")
    traveler = db.query(Traveler).filter(Traveler.id == traveler_id).first()
    if not traveler: raise HTTPException(404, "Traveler not found")

    # Generate unique filename
    ext = os.path.splitext(file.filename or "file")[1]
    unique_name = f"{traveler_id}_{uuid.uuid4().hex[:8]}{ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_name)

    # Stream to disk in chunks so large files don't get fully buffered in RAM.
    size = 0
    with open(file_path, "wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)  # 1MB
            if not chunk:
                break
            f.write(chunk)
            size += len(chunk)

    doc = JobDocument(
        traveler_id=traveler_id,
        filename=unique_name,
        original_name=file.filename or "file",
        file_path=file_path,
        file_size=size,
        content_type=file.content_type,
        category=category,
        uploaded_by=current_user.id,
        note=note or None,
    )
    db.add(doc); db.commit(); db.refresh(doc)
    return doc

@router.delete("/documents/file/{doc_id}")
def delete_document(doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(403, "Only admins can delete documents")
    doc = db.query(JobDocument).filter(JobDocument.id == doc_id).first()
    if not doc: raise HTTPException(404, "Document not found")
    # Soft delete. The row is stamped and filtered out of every read, and the
    # uploaded file is deliberately LEFT on disk — deleting it would make the
    # record unrecoverable, which is exactly what must not happen here.
    doc.deleted_at = datetime.now(timezone.utc)
    doc.deleted_by = current_user.id
    db.commit()
    return {"ok": True}

@router.get("/documents/file/{doc_id}/raw")
def get_document_raw(doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Serve the original uploaded file bytes so the traveler can render the
    document inline (image preview, or PDF rasterized client-side) on screen
    and in print, exactly as uploaded."""
    doc = db.query(JobDocument).filter(JobDocument.id == doc_id).first()
    if not doc: raise HTTPException(404, "Document not found")
    if not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(404, "File missing on disk")
    return FileResponse(
        doc.file_path,
        media_type=doc.content_type or "application/octet-stream",
        filename=doc.original_name,
        content_disposition_type="inline",
    )


# ═══════════════════════════════════════════════════════════════════
# QUALITY CHECKLIST
# ═══════════════════════════════════════════════════════════════════

class CheckItemCreate(BaseModel):
    check_name: str
    description: Optional[str] = None
    sort_order: int = 0
    is_required: bool = True

class CheckItemUpdate(BaseModel):
    passed: Optional[bool] = None
    fail_note: Optional[str] = None

class CheckItemOut(BaseModel):
    id: int; step_id: int; check_name: str; description: Optional[str];
    sort_order: int; is_required: bool; passed: Optional[bool];
    checked_by: Optional[int]; checked_at: Optional[datetime]; fail_note: Optional[str]
    class Config:
        from_attributes = True

@router.get("/quality/{step_id}", response_model=List[CheckItemOut])
def list_checks(step_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(QualityCheckItem).filter(QualityCheckItem.step_id == step_id).order_by(QualityCheckItem.sort_order).all()

@router.post("/quality/{step_id}", response_model=CheckItemOut)
def add_check_item(step_id: int, body: CheckItemCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    step = db.query(ProcessStep).filter(ProcessStep.id == step_id).first()
    if not step: raise HTTPException(404, "Step not found")
    item = QualityCheckItem(
        step_id=step_id, check_name=body.check_name, description=body.description,
        sort_order=body.sort_order, is_required=body.is_required,
    )
    db.add(item); db.commit(); db.refresh(item)
    return item

@router.put("/quality/check/{check_id}", response_model=CheckItemOut)
def update_check(check_id: int, body: CheckItemUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(QualityCheckItem).filter(QualityCheckItem.id == check_id).first()
    if not item: raise HTTPException(404, "Check item not found")
    if body.passed is not None:
        item.passed = body.passed
        item.checked_by = current_user.id
        item.checked_at = datetime.now(timezone.utc)
    if body.fail_note is not None:
        item.fail_note = body.fail_note
    db.commit(); db.refresh(item)
    return item

@router.delete("/quality/check/{check_id}")
def delete_check(check_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = db.query(QualityCheckItem).filter(QualityCheckItem.id == check_id).first()
    if not item: raise HTTPException(404)
    # Soft delete — the check item row is never removed.
    item.deleted_at = datetime.now(timezone.utc)
    item.deleted_by = current_user.id
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════
# COMMUNICATION LOG
# ═══════════════════════════════════════════════════════════════════

class CommLogCreate(BaseModel):
    comm_type: str = "note"  # note, email, phone, meeting
    direction: str = "internal"  # internal, outbound, inbound
    subject: Optional[str] = None
    message: str
    contact_name: Optional[str] = None

class CommLogOut(BaseModel):
    id: int; traveler_id: int; comm_type: str; direction: str;
    subject: Optional[str]; message: str; contact_name: Optional[str];
    created_by: Optional[int]; created_at: datetime
    class Config:
        from_attributes = True

@router.get("/comms/{traveler_id}", response_model=List[CommLogOut])
def list_comms(traveler_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(CommunicationLog).filter(
        CommunicationLog.traveler_id == traveler_id
    ).order_by(CommunicationLog.created_at.desc()).all()

@router.post("/comms/{traveler_id}", response_model=CommLogOut)
def add_comm(traveler_id: int, body: CommLogCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(Traveler).filter(Traveler.id == traveler_id).first()
    if not t: raise HTTPException(404, "Traveler not found")
    log = CommunicationLog(
        traveler_id=traveler_id, comm_type=body.comm_type, direction=body.direction,
        subject=body.subject, message=body.message, contact_name=body.contact_name,
        created_by=current_user.id,
    )
    db.add(log); db.commit(); db.refresh(log)
    return log

@router.delete("/comms/entry/{log_id}")
def delete_comm(log_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    log = db.query(CommunicationLog).filter(CommunicationLog.id == log_id).first()
    if not log: raise HTTPException(404)
    # Soft delete — the communication record is never removed.
    log.deleted_at = datetime.now(timezone.utc)
    log.deleted_by = current_user.id
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════
# KITTING TIMER ADMIN LISTING (for admin override UI)
# ═══════════════════════════════════════════════════════════════════

@router.get("/kitting-sessions")
def list_kitting_sessions(
    status: Optional[str] = None,  # "open" or "closed"
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all kitting timer sessions for admin review."""
    q = db.query(KittingTimerSession).order_by(KittingTimerSession.start_time.desc())
    if status == "open":
        q = q.filter(KittingTimerSession.end_time.is_(None))
    elif status == "closed":
        q = q.filter(KittingTimerSession.end_time.isnot(None))
    sessions = q.limit(100).all()

    result = []
    for s in sessions:
        traveler = db.query(Traveler).filter(Traveler.id == s.traveler_id).first()
        employee = db.query(User).filter(User.id == s.employee_id).first() if s.employee_id else None
        result.append({
            "id": s.id,
            "traveler_id": s.traveler_id,
            "job_number": traveler.job_number if traveler else None,
            "employee_name": f"{employee.first_name} {employee.last_name}".strip() if employee and employee.first_name else (employee.username if employee else None),
            "session_type": s.session_type,
            "start_time": str(s.start_time),
            "end_time": str(s.end_time) if s.end_time else None,
            "duration_seconds": s.duration_seconds,
            "note": s.note,
        })
    return result
