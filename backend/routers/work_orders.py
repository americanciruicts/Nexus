from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from database import get_db
from models import User, WorkOrder
from routers.auth import get_current_user

router = APIRouter()

@router.get("/")
async def get_work_orders(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get list of work orders"""
    work_orders = db.query(WorkOrder).filter(WorkOrder.is_active == True).offset(skip).limit(limit).all()

    return [
        {
            "id": wo.id,
            "job_number": wo.job_number,
            "work_order_number": wo.work_order_number,
            "part_number": wo.part_number,
            "part_description": wo.part_description,
            "revision": wo.revision,
            "quantity": wo.quantity,
            "customer_code": wo.customer_code,
            "customer_name": wo.customer_name,
            "work_center": wo.work_center,
            "priority": wo.priority.value,
            "created_at": wo.created_at
        }
        for wo in work_orders
    ]

@router.get("/search/{identifier}")
async def search_work_order(
    identifier: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Search work order by job number or work order number"""
    work_order = db.query(WorkOrder).filter(
        (WorkOrder.job_number.ilike(f"%{identifier}%")) |
        (WorkOrder.work_order_number.ilike(f"%{identifier}%"))
    ).first()

    if not work_order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Work order not found"
        )

    return {
        "id": work_order.id,
        "job_number": work_order.job_number,
        "work_order_number": work_order.work_order_number,
        "part_number": work_order.part_number,
        "part_description": work_order.part_description,
        "revision": work_order.revision,
        "quantity": work_order.quantity,
        "customer_code": work_order.customer_code,
        "customer_name": work_order.customer_name,
        "work_center": work_order.work_center,
        "priority": work_order.priority.value
    }