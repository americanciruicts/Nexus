from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from typing import List, Optional
from pydantic import BaseModel
from datetime import date, datetime
import models
from database import get_db
from routers.auth import get_current_user

router = APIRouter()

class TravelerCompletionReport(BaseModel):
    total_travelers: int
    completed_travelers: int
    in_progress_travelers: int
    completion_rate: float
    by_type: List[dict]

class LaborEfficiencyReport(BaseModel):
    total_hours_logged: float
    average_hours_per_traveler: float
    efficiency_by_user: List[dict]

@router.get("/traveler-completion")
async def get_traveler_completion_report(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Base query
    query = db.query(models.Traveler)

    if start_date:
        query = query.filter(models.Traveler.created_at >= start_date)
    if end_date:
        query = query.filter(models.Traveler.created_at <= end_date)

    travelers = query.all()

    total_travelers = len(travelers)
    completed_travelers = len([t for t in travelers if t.status == "completed"])
    in_progress_travelers = len([t for t in travelers if t.status == "in_progress"])

    completion_rate = (completed_travelers / total_travelers * 100) if total_travelers > 0 else 0

    # Group by type
    type_stats = db.query(
        models.TravelerType.type_name,
        func.count(models.Traveler.id).label('count'),
        func.count(func.nullif(models.Traveler.status != 'completed', True)).label('completed')
    ).join(models.Traveler).group_by(models.TravelerType.type_name).all()

    by_type = [
        {
            "type": stat.type_name,
            "total": stat.count,
            "completed": stat.completed or 0,
            "completion_rate": ((stat.completed or 0) / stat.count * 100) if stat.count > 0 else 0
        }
        for stat in type_stats
    ]

    return {
        "total_travelers": total_travelers,
        "completed_travelers": completed_travelers,
        "in_progress_travelers": in_progress_travelers,
        "completion_rate": completion_rate,
        "by_type": by_type
    }

@router.get("/labor-efficiency")
async def get_labor_efficiency_report(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Base query for labor logs
    query = db.query(models.LaborLog)

    if start_date:
        query = query.filter(models.LaborLog.created_at >= start_date)
    if end_date:
        query = query.filter(models.LaborLog.created_at <= end_date)

    labor_logs = query.all()

    total_hours = sum([log.hours_logged or 0 for log in labor_logs])
    unique_travelers = len(set([log.traveler_id for log in labor_logs]))
    avg_hours_per_traveler = total_hours / unique_travelers if unique_travelers > 0 else 0

    # Efficiency by user
    user_stats = db.query(
        models.User.username,
        models.User.first_name,
        models.User.last_name,
        func.sum(models.LaborLog.hours_logged).label('total_hours'),
        func.count(func.distinct(models.LaborLog.traveler_id)).label('travelers_worked')
    ).join(models.LaborLog).group_by(
        models.User.id, models.User.username, models.User.first_name, models.User.last_name
    ).all()

    efficiency_by_user = [
        {
            "username": stat.username,
            "name": f"{stat.first_name or ''} {stat.last_name or ''}".strip(),
            "total_hours": float(stat.total_hours or 0),
            "travelers_worked": stat.travelers_worked,
            "avg_hours_per_traveler": float(stat.total_hours or 0) / stat.travelers_worked if stat.travelers_worked > 0 else 0
        }
        for stat in user_stats
    ]

    return {
        "total_hours_logged": total_hours,
        "average_hours_per_traveler": avg_hours_per_traveler,
        "efficiency_by_user": efficiency_by_user
    }

@router.get("/coating-status")
async def get_coating_status_report(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    coating_logs = db.query(models.CoatingLog).all()

    status_counts = {}
    for log in coating_logs:
        status = log.status
        if status in status_counts:
            status_counts[status] += 1
        else:
            status_counts[status] = 1

    total_coatings = len(coating_logs)

    return {
        "total_coating_jobs": total_coatings,
        "status_breakdown": [
            {
                "status": status,
                "count": count,
                "percentage": (count / total_coatings * 100) if total_coatings > 0 else 0
            }
            for status, count in status_counts.items()
        ]
    }

@router.get("/dashboard-stats")
async def get_dashboard_stats(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Quick stats for dashboard
    total_travelers = db.query(models.Traveler).count()
    active_travelers = db.query(models.Traveler).filter(models.Traveler.status == "in_progress").count()
    completed_today = db.query(models.Traveler).filter(
        and_(
            models.Traveler.status == "completed",
            func.date(models.Traveler.updated_at) == func.current_date()
        )
    ).count()

    total_users = db.query(models.User).count()

    return {
        "total_travelers": total_travelers,
        "active_travelers": active_travelers,
        "completed_today": completed_today,
        "total_users": total_users
    }