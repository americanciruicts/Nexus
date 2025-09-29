from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel

from database import get_db
from models import User, LaborEntry, Traveler, ProcessStep
from routers.auth import get_current_user

router = APIRouter()

class LaborEntryCreate(BaseModel):
    traveler_id: int
    step_id: Optional[int] = None
    start_time: datetime
    description: str

class LaborEntryUpdate(BaseModel):
    end_time: Optional[datetime] = None
    description: Optional[str] = None
    is_completed: Optional[bool] = None

class LaborEntryResponse(BaseModel):
    id: int
    traveler_id: int
    step_id: Optional[int]
    employee_id: int
    employee_name: str
    start_time: datetime
    end_time: Optional[datetime]
    hours_worked: float
    description: str
    is_completed: bool
    created_at: datetime

    class Config:
        from_attributes = True

@router.post("/", response_model=LaborEntryResponse)
async def start_labor_entry(
    labor_data: LaborEntryCreate,
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

    # Verify step exists if provided
    if labor_data.step_id:
        step = db.query(ProcessStep).filter(ProcessStep.id == labor_data.step_id).first()
        if not step:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Process step not found"
            )

    # Check if user has an active labor entry
    active_entry = db.query(LaborEntry).filter(
        (LaborEntry.employee_id == current_user.id) &
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
        step_id=labor_data.step_id,
        employee_id=current_user.id,
        start_time=labor_data.start_time,
        description=labor_data.description
    )

    db.add(db_labor_entry)
    db.commit()
    db.refresh(db_labor_entry)

    # Add employee name for response
    db_labor_entry.employee_name = f"{current_user.first_name} {current_user.last_name}"

    return db_labor_entry

@router.put("/{labor_id}", response_model=LaborEntryResponse)
async def update_labor_entry(
    labor_id: int,
    labor_data: LaborEntryUpdate,
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

    # Check if user owns this labor entry or is supervisor/admin
    if (labor_entry.employee_id != current_user.id and
        current_user.role not in ["ADMIN", "SUPERVISOR"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to update this labor entry"
        )

    # Update fields
    update_data = labor_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(labor_entry, field, value)

    # Calculate hours worked if end_time is provided
    if labor_data.end_time and labor_entry.start_time:
        time_diff = labor_data.end_time - labor_entry.start_time
        labor_entry.hours_worked = round(time_diff.total_seconds() / 3600, 2)

    db.commit()
    db.refresh(labor_entry)

    # Add employee name for response
    employee = db.query(User).filter(User.id == labor_entry.employee_id).first()
    labor_entry.employee_name = f"{employee.first_name} {employee.last_name}"

    return labor_entry

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

    # Add employee names
    result = []
    for entry in labor_entries:
        employee = db.query(User).filter(User.id == entry.employee_id).first()
        entry_dict = {
            "id": entry.id,
            "traveler_id": entry.traveler_id,
            "step_id": entry.step_id,
            "employee_id": entry.employee_id,
            "employee_name": f"{employee.first_name} {employee.last_name}",
            "start_time": entry.start_time,
            "end_time": entry.end_time,
            "hours_worked": entry.hours_worked,
            "description": entry.description,
            "is_completed": entry.is_completed,
            "created_at": entry.created_at
        }
        result.append(LaborEntryResponse(**entry_dict))

    return result

@router.get("/my-entries", response_model=List[LaborEntryResponse])
async def get_my_labor_entries(
    days: int = 7,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get current user's labor entries for the last N days"""

    start_date = datetime.now() - timedelta(days=days)

    labor_entries = db.query(LaborEntry).filter(
        (LaborEntry.employee_id == current_user.id) &
        (LaborEntry.created_at >= start_date)
    ).all()

    result = []
    for entry in labor_entries:
        entry_dict = {
            "id": entry.id,
            "traveler_id": entry.traveler_id,
            "step_id": entry.step_id,
            "employee_id": entry.employee_id,
            "employee_name": f"{current_user.first_name} {current_user.last_name}",
            "start_time": entry.start_time,
            "end_time": entry.end_time,
            "hours_worked": entry.hours_worked,
            "description": entry.description,
            "is_completed": entry.is_completed,
            "created_at": entry.created_at
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

    entry_dict = {
        "id": active_entry.id,
        "traveler_id": active_entry.traveler_id,
        "step_id": active_entry.step_id,
        "employee_id": active_entry.employee_id,
        "employee_name": f"{current_user.first_name} {current_user.last_name}",
        "start_time": active_entry.start_time,
        "end_time": active_entry.end_time,
        "hours_worked": active_entry.hours_worked,
        "description": active_entry.description,
        "is_completed": active_entry.is_completed,
        "created_at": active_entry.created_at
    }

    return LaborEntryResponse(**entry_dict)

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
    if current_user.role not in ["ADMIN", "SUPERVISOR"]:
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