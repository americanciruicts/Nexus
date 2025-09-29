from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from typing import List

from database import get_db
from models import User, Approval, Traveler, AuditLog
from schemas.traveler_schemas import ApprovalCreate, Approval as ApprovalSchema
from routers.auth import get_current_user
from services.email_service import send_approval_notification

router = APIRouter()

@router.post("/", response_model=ApprovalSchema)
async def create_approval_request(
    approval_data: ApprovalCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create approval request"""

    # Verify traveler exists
    traveler = db.query(Traveler).filter(Traveler.id == approval_data.traveler_id).first()
    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Traveler not found"
        )

    # Create approval request
    db_approval = Approval(
        traveler_id=approval_data.traveler_id,
        requested_by=current_user.id,
        request_type=approval_data.request_type,
        request_details=approval_data.request_details
    )

    db.add(db_approval)
    db.commit()
    db.refresh(db_approval)

    # Send email notification to approvers
    await send_approval_notification(
        traveler_id=approval_data.traveler_id,
        requested_by=current_user.username,
        request_type=approval_data.request_type,
        db=db
    )

    # Create audit log
    audit_log = AuditLog(
        traveler_id=approval_data.traveler_id,
        user_id=current_user.id,
        action="APPROVAL_REQUESTED",
        new_value=f"{approval_data.request_type}: {approval_data.request_details}",
        ip_address="127.0.0.1",
        user_agent="NEXUS-Frontend"
    )
    db.add(audit_log)
    db.commit()

    return db_approval

@router.get("/", response_model=List[ApprovalSchema])
async def get_pending_approvals(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get pending approvals (for approvers only)"""
    if not current_user.is_approver and current_user.username not in ["Kris", "Adam"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only approvers can view pending approvals"
        )

    approvals = db.query(Approval).filter(Approval.status == "PENDING").all()
    return approvals

@router.post("/{approval_id}/approve")
async def approve_request(
    approval_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Approve a request (Kris/Adam only)"""
    if not current_user.is_approver and current_user.username not in ["Kris", "Adam"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Kris and Adam can approve requests"
        )

    approval = db.query(Approval).filter(Approval.id == approval_id).first()
    if not approval:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval request not found"
        )

    if approval.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Approval request already processed"
        )

    # Update approval
    approval.status = "APPROVED"
    approval.approved_by = current_user.id
    approval.approved_at = func.now()

    db.commit()

    # Create audit log
    audit_log = AuditLog(
        traveler_id=approval.traveler_id,
        user_id=current_user.id,
        action="APPROVED",
        new_value=f"Approved {approval.request_type} request",
        ip_address="127.0.0.1",
        user_agent="NEXUS-Frontend"
    )
    db.add(audit_log)
    db.commit()

    return {"message": "Request approved successfully"}

@router.post("/{approval_id}/reject")
async def reject_request(
    approval_id: int,
    rejection_reason: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Reject a request (Kris/Adam only)"""
    if not current_user.is_approver and current_user.username not in ["Kris", "Adam"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Kris and Adam can reject requests"
        )

    approval = db.query(Approval).filter(Approval.id == approval_id).first()
    if not approval:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval request not found"
        )

    if approval.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Approval request already processed"
        )

    # Update approval
    approval.status = "REJECTED"
    approval.rejected_by = current_user.id
    approval.rejected_at = func.now()
    approval.rejection_reason = rejection_reason

    db.commit()

    # Create audit log
    audit_log = AuditLog(
        traveler_id=approval.traveler_id,
        user_id=current_user.id,
        action="REJECTED",
        new_value=f"Rejected {approval.request_type} request: {rejection_reason}",
        ip_address="127.0.0.1",
        user_agent="NEXUS-Frontend"
    )
    db.add(audit_log)
    db.commit()

    return {"message": "Request rejected"}

@router.get("/my-requests", response_model=List[ApprovalSchema])
async def get_my_approval_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get current user's approval requests"""
    approvals = db.query(Approval).filter(Approval.requested_by == current_user.id).all()
    return approvals