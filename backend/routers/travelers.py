from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from pydantic import BaseModel
from typing import List, Optional
import json
import logging
import re
from datetime import datetime

from database import get_db
from models import User, Traveler, ProcessStep, SubStep, ManualStep, AuditLog, WorkOrder, WorkCenter, TravelerTrackingLog, NotificationType, TravelerStatus, LaborEntry, UserRole, RmaUnitTracking, TravelerGroup
from schemas.traveler_schemas import (
    TravelerCreate, Traveler as TravelerSchema, TravelerUpdate,
    TravelerList, ProcessStepCreate, ManualStepCreate,
    LinkTravelersRequest, TravelerGroupInfo, TravelerGroupMember
)
from schemas.tracking_schemas import TrackingScanRequest, TrackingScanResponse, TrackingLogResponse
from routers.auth import get_current_user, get_password_hash
from services.email_service import send_approval_notification
from services.notification_service import create_notification_for_admins

logger = logging.getLogger(__name__)

router = APIRouter()
security = HTTPBearer(auto_error=False)  # Don't auto-error on missing auth


# RMA / Modification travelers render a different header than the standard one,
# and that header has no "Quantity" field — the quantity the user actually fills
# in is "Quantity RMA issued for". The form therefore always posted quantity=1
# (its `Number(quantity) || 1` fallback over an untouched 0), so every RMA
# traveler card read "Qty: 1" no matter what the traveler itself said, and there
# was no field anywhere to raise it. Derive the real quantity instead.
RMA_TRAVELER_TYPES = {"RMA_SAME", "RMA_DIFF", "MODIFICATION"}


def resolve_traveler_quantity(traveler_data, rma_units=None, current=None):
    """Quantity to store for a traveler.

    Non-RMA travelers keep whatever the form posted — they have a real Quantity
    field. RMA/Modification travelers fall back through the RMA quantity fields
    in the order the header presents them, then to the number of unit rows.
    `current` keeps an existing value when an update omits the source fields.
    """
    posted = traveler_data.quantity
    raw_type = getattr(traveler_data, "traveler_type", None)
    type_name = getattr(raw_type, "value", raw_type)
    if type_name not in RMA_TRAVELER_TYPES:
        return posted if posted else (current or 1)

    for candidate in (
        traveler_data.quantity_rma_issued,
        traveler_data.units_received,
        traveler_data.units_shipped,
        len(rma_units) if rma_units else None,
    ):
        if candidate and candidate > 0:
            return candidate

    # Nothing to derive from. Honour an explicitly-set quantity over the
    # form's default of 1, and never downgrade a value already stored.
    if posted and posted > 1:
        return posted
    return current or posted or 1


# Every department name the traveler recognises. This is a PARSING allow-list:
# it is what lets a compound work-center department like "Receiving/Test" split
# into its parts. Names must stay here even when hidden from the UI — dropping
# one makes its compounds fail to split and surface as a literal
# "Receiving/Test" department row.
KNOWN_DEPTS = {'Engineering', 'Prep', 'Receiving', 'TH', 'Test', 'Soldering', 'SMT',
               'ALL', 'Quality', 'Shipping', 'Coating', 'Cable', 'Purchasing', 'Other'}

# Departments kept out of the DEPTS breakdown and out of the step-progress math.
# Receiving covers KITTING / INVENTORY / PCBA STOCK / RECEIVING: real work, but
# not time-tracked, so counting it only dilutes the completion percentage. The
# steps themselves still render on the traveler — this hides the department, not
# the work.
HIDDEN_DEPTS = {'Receiving'}


def split_departments(dept: Optional[str]) -> List[str]:
    """Split a work center's department string into individual department names.

    "SMT/Soldering/Test" -> [SMT, Soldering, Test]. A plain known name passes
    through as-is. Anything unrecognised is returned whole rather than guessed
    at, so a typo shows up as itself instead of silently fragmenting.
    """
    if dept in KNOWN_DEPTS:
        return [dept]
    parts = [d.strip() for d in (dept or '').split('/') if d.strip()]
    if len(parts) > 1 and all(p in KNOWN_DEPTS for p in parts):
        return parts
    return [dept] if dept else ['Other']


def visible_departments(dept: Optional[str]) -> List[str]:
    """A step's departments, minus the ones hidden from the traveler.

    A step keeps counting as long as it has at least one visible department, so
    "Receiving/Test" still counts under Test while plain "Receiving" drops out.
    """
    return [d for d in split_departments(dept) if d not in HIDDEN_DEPTS]


def counts_toward_progress(dept: Optional[str]) -> bool:
    """Whether a step belongs in the step-progress numerator/denominator."""
    return bool(visible_departments(dept))


# Work-center category -> the short label the traveler shows in its hours table.
CATEGORY_SHORT_NAMES = {
    'SMT hrs. Actual': 'SMT',
    'HAND hrs. Actual': 'Hand',
    'TH hrs. Actual': 'TH',
    'AOI & Final Inspection, QC hrs. Actual': 'AOI',
    'E-TEST hrs. Actual': 'E-Test',
    'Labelling, Packaging, Shipping hrs. Actual': 'Labeling',
}


def short_category(cat: Optional[str]) -> str:
    """Short label for a work-center category, falling back to its first word."""
    if not cat:
        return 'Other'
    return CATEGORY_SHORT_NAMES.get(cat, cat.split(' ')[0].strip().rstrip(','))


def is_completed_status(status) -> bool:
    """True for a COMPLETED traveler, whether status arrives as the enum or a
    plain string (both shapes reach the progress paths)."""
    value = status.value if hasattr(status, 'value') else status
    return str(value).upper() == 'COMPLETED'


def step_percent_complete(status, completed_steps: int, total_steps: int) -> float:
    """Step progress percentage as displayed for a traveler.

    COMPLETED means the job shipped, and shipping is the terminal step, so the
    job reads 100% no matter how many steps carry a check — jobs ship with
    optional steps left unsigned, which otherwise surfaces as a shipped job
    stuck at "4/13 = 30.8%".
    """
    if is_completed_status(status):
        return 100.0
    return round((completed_steps / total_steps) * 100, 1) if total_steps > 0 else 0.0


def displayed_step_counts(status, completed_steps: int, total_steps: int) -> tuple:
    """The completed/total pair as displayed, kept consistent with the percentage.

    A COMPLETED traveler reads N/N rather than its raw signed count: showing
    "100%" above "4/13" states two different things about the same job. The
    stored ProcessStep.is_completed flags are untouched — this is presentation
    only, so the underlying record of what was actually signed survives.
    """
    if is_completed_status(status):
        return total_steps, total_steps
    return completed_steps, total_steps

async def get_user_or_system(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    Get current authenticated user. Requires a valid Bearer token (JWT issued
    by /auth/login or /auth/sso/callback). Missing or invalid tokens return 401.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await get_current_user(credentials, db)

# Memory store for manufacturing process steps
MANUFACTURING_STEPS = {
    "PCB": [
        {
            "step_number": 1,
            "operation": "INCOMING INSPECTION",
            "work_center_code": "INCOMING",
            "instructions": "Verify PCB against specifications",
            "sub_steps": [
                {"step_number": "1.1", "description": "Check part number and revision"},
                {"step_number": "1.2", "description": "Verify quantity received"},
                {"step_number": "1.3", "description": "Visual inspection for damage"},
                {"step_number": "1.4", "description": "Dimensional verification"},
                {"step_number": "1.5", "description": "Documentation review"}
            ],
            "estimated_time": 30,
            "is_required": True
        },
        {
            "step_number": 2,
            "operation": "PCB PREP",
            "work_center_code": "PCB_PREP",
            "instructions": "Prepare PCB for assembly process",
            "sub_steps": [
                {"step_number": "2.1", "description": "Clean PCB surface"},
                {"step_number": "2.2", "description": "Apply conformal coating if required"},
                {"step_number": "2.3", "description": "Mark identification numbers"},
                {"step_number": "2.4", "description": "Pre-heat if specified"}
            ],
            "estimated_time": 45,
            "is_required": True
        }
    ],
    "ASSY": [
        {
            "step_number": 1,
            "operation": "KIT PREPARATION",
            "work_center_code": "KITTING",
            "instructions": "Prepare all components for assembly",
            "sub_steps": [
                {"step_number": "1.1", "description": "Gather all required parts"},
                {"step_number": "1.2", "description": "Verify part numbers and quantities"},
                {"step_number": "1.3", "description": "Check for damaged components"}
            ],
            "estimated_time": 60,
            "is_required": True
        }
    ],
    "CABLE": [
        {
            "step_number": 1,
            "operation": "CABLE PREPARATION",
            "work_center_code": "CABLE_PREP",
            "instructions": "Prepare cable for assembly",
            "sub_steps": [
                {"step_number": "1.1", "description": "Cut cable to specified length"},
                {"step_number": "1.2", "description": "Strip wire ends"},
                {"step_number": "1.3", "description": "Identify conductor wires"}
            ],
            "estimated_time": 45,
            "is_required": True
        }
    ]
}
# Add PCB_ASSEMBLY as an alias for ASSY manufacturing steps
MANUFACTURING_STEPS["PCB_ASSEMBLY"] = MANUFACTURING_STEPS["ASSY"]

# RMA Router - Same Job/Rev, PO & WO (from Word template)
MANUFACTURING_STEPS["RMA_SAME"] = [
    {"step_number": 1, "operation": "INCOMING INSPECTION", "work_center_code": "RMA_INCOMING_INSPEC", "instructions": "Inspect incoming RMA units, verify quantity and condition", "sub_steps": [], "estimated_time": 30, "is_required": True},
    {"step_number": 2, "operation": "REPAIR", "work_center_code": "RMA_REPAIR", "instructions": "Repair defective units per customer complaint", "sub_steps": [], "estimated_time": 60, "is_required": True},
    {"step_number": 3, "operation": "COATING", "work_center_code": "RMA_COATING", "instructions": "Apply conformal coating if required", "sub_steps": [], "estimated_time": 30, "is_required": False},
    {"step_number": 4, "operation": "TESTING", "work_center_code": "RMA_TESTING", "instructions": "Test repaired units per original test procedures", "sub_steps": [], "estimated_time": 45, "is_required": True},
    {"step_number": 5, "operation": "INVENTORY", "work_center_code": "RMA_INVENTORY", "instructions": "Check parts before buying", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 6, "operation": "PURCHASING", "work_center_code": "RMA_PURCHASING", "instructions": "Parts ordered and waiting to be received for repair", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 7, "operation": "MISC.", "work_center_code": "RMA_MISC", "instructions": "Miscellaneous operations as needed", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 8, "operation": "FINAL INSPEC", "work_center_code": "RMA_FINAL_INSPEC", "instructions": "Final inspection - sample or 100% inspection", "sub_steps": [], "estimated_time": 30, "is_required": True},
    {"step_number": 9, "operation": "STOCK", "work_center_code": "RMA_STOCK", "instructions": "Check stock - do we have any PCBA or cable assemblies in stock?", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 10, "operation": "PACKING", "work_center_code": "RMA_PACKING", "instructions": "Pack repaired units for shipment", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 11, "operation": "PACKING AND SHIPPING", "work_center_code": "RMA_PACKING_AND_SHIPPING", "instructions": "Pack and ship repaired units back to customer", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 12, "operation": "SHIPPING", "work_center_code": "RMA_SHIPPING", "instructions": "Ship repaired units back to customer", "sub_steps": [], "estimated_time": 15, "is_required": True},
]

# RMA Router - Different Jobs/Rev, PO & WO (same work center steps, different header fields)
MANUFACTURING_STEPS["RMA_DIFF"] = [
    {"step_number": 1, "operation": "INCOMING INSPECTION", "work_center_code": "RMA_INCOMING_INSPEC", "instructions": "Inspect incoming RMA units, verify quantity and condition", "sub_steps": [], "estimated_time": 30, "is_required": True},
    {"step_number": 2, "operation": "REPAIR", "work_center_code": "RMA_REPAIR", "instructions": "Repair defective units per customer complaint", "sub_steps": [], "estimated_time": 60, "is_required": True},
    {"step_number": 3, "operation": "COATING", "work_center_code": "RMA_COATING", "instructions": "Apply conformal coating if required", "sub_steps": [], "estimated_time": 30, "is_required": False},
    {"step_number": 4, "operation": "TESTING", "work_center_code": "RMA_TESTING", "instructions": "Test repaired units per original test procedures", "sub_steps": [], "estimated_time": 45, "is_required": True},
    {"step_number": 5, "operation": "INVENTORY", "work_center_code": "RMA_INVENTORY", "instructions": "Check parts before buying", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 6, "operation": "PURCHASING", "work_center_code": "RMA_PURCHASING", "instructions": "Parts ordered and waiting to be received for repair", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 7, "operation": "MISC.", "work_center_code": "RMA_MISC", "instructions": "Miscellaneous operations as needed", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 8, "operation": "FINAL INSPEC", "work_center_code": "RMA_FINAL_INSPEC", "instructions": "Final inspection - sample or 100% inspection", "sub_steps": [], "estimated_time": 30, "is_required": True},
    {"step_number": 9, "operation": "STOCK", "work_center_code": "RMA_STOCK", "instructions": "Check stock - do we have any PCBA or cable assemblies in stock?", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 10, "operation": "PACKING", "work_center_code": "RMA_PACKING", "instructions": "Pack repaired units for shipment", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 11, "operation": "PACKING AND SHIPPING", "work_center_code": "RMA_PACKING_AND_SHIPPING", "instructions": "Pack and ship repaired units back to customer", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 12, "operation": "SHIPPING", "work_center_code": "RMA_SHIPPING", "instructions": "Ship repaired units back to customer", "sub_steps": [], "estimated_time": 15, "is_required": True},
]

# Modification RMA (no STOCK step per Word template)
MANUFACTURING_STEPS["MODIFICATION"] = [
    {"step_number": 1, "operation": "INCOMING INSPECTION", "work_center_code": "RMA_INCOMING_INSPEC", "instructions": "Inspect incoming modification units, verify quantity and condition", "sub_steps": [], "estimated_time": 30, "is_required": True},
    {"step_number": 2, "operation": "REPAIR", "work_center_code": "RMA_REPAIR", "instructions": "Perform required modifications per work order", "sub_steps": [], "estimated_time": 60, "is_required": True},
    {"step_number": 3, "operation": "COATING", "work_center_code": "RMA_COATING", "instructions": "Apply conformal coating if required", "sub_steps": [], "estimated_time": 30, "is_required": False},
    {"step_number": 4, "operation": "TESTING", "work_center_code": "RMA_TESTING", "instructions": "Test modified units per test procedures", "sub_steps": [], "estimated_time": 45, "is_required": True},
    {"step_number": 5, "operation": "INVENTORY", "work_center_code": "RMA_INVENTORY", "instructions": "Check parts before buying", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 6, "operation": "PURCHASING", "work_center_code": "RMA_PURCHASING", "instructions": "Parts ordered and waiting to be received", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 7, "operation": "MISC.", "work_center_code": "RMA_MISC", "instructions": "Miscellaneous operations as needed", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 8, "operation": "FINAL INSPEC", "work_center_code": "RMA_FINAL_INSPEC", "instructions": "Final inspection - sample or 100% inspection", "sub_steps": [], "estimated_time": 30, "is_required": True},
    {"step_number": 9, "operation": "PACKING", "work_center_code": "RMA_PACKING", "instructions": "Pack modified units for shipment", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 10, "operation": "PACKING AND SHIPPING", "work_center_code": "RMA_PACKING_AND_SHIPPING", "instructions": "Pack and ship modified units back to customer", "sub_steps": [], "estimated_time": 15, "is_required": False},
    {"step_number": 11, "operation": "SHIPPING", "work_center_code": "RMA_SHIPPING", "instructions": "Ship modified units back to customer", "sub_steps": [], "estimated_time": 15, "is_required": True},
]

@router.get("/next-work-order-number")
async def get_next_work_order_number(db: Session = Depends(get_db)):
    """Get the next sequential work order number (5-digit prefix).
    Only counts non-DRAFT travelers so that deleted drafts' work orders can be reused."""
    import re

    # Query work order numbers from non-DRAFT travelers only
    # This means drafts don't "consume" work order numbers permanently
    # If a draft is deleted, its work order becomes available again
    travelers = db.query(Traveler.work_order_number).filter(
        Traveler.work_order_number.isnot(None),
        Traveler.work_order_number != '',
        Traveler.status != 'DRAFT'  # Exclude drafts from the count
    ).all()

    max_prefix = 26014  # Starting number if no existing travelers

    for (work_order,) in travelers:
        if work_order:
            # Extract the numeric prefix before any dash
            # Format: "26015-1" -> extract "26015"
            # Format: "26015" -> extract "26015"
            match = re.match(r'^(\d{5})', str(work_order))
            if match:
                prefix_num = int(match.group(1))
                if prefix_num > max_prefix:
                    max_prefix = prefix_num

    next_number = max_prefix + 1
    # Ensure it's 5 digits with leading zeros if needed
    return {"next_work_order_prefix": str(next_number).zfill(5)}

@router.get("/manufacturing-steps/{traveler_type}")
async def get_manufacturing_steps(traveler_type: str):
    """Get manufacturing process steps for a specific traveler type"""
    if traveler_type not in MANUFACTURING_STEPS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Manufacturing steps not found for traveler type: {traveler_type}"
        )
    return MANUFACTURING_STEPS[traveler_type]

@router.get("/work-order/{identifier}")
async def get_work_order_data(identifier: str, db: Session = Depends(get_db)):
    """Auto-populate traveler data from job number or work order number"""
    work_order = db.query(WorkOrder).filter(
        (WorkOrder.job_number == identifier) |
        (WorkOrder.work_order_number == identifier)
    ).first()

    if not work_order:
        # Return mock data for demo purposes
        if identifier == "8414L":
            return {
                "job_number": "8414L",
                "work_order_number": "8414L",
                "traveler_type": "PCB_ASSEMBLY",
                "part_number": "METSHIFT",
                "part_description": "METSHIFT Assembly",
                "revision": "V0.2",
                "available_revisions": ["V0.1", "V0.2", "V1.0"],
                "quantity": 250,
                "customer_code": "750",
                "customer_name": "Customer Supply",
                "work_center": "ASSEMBLY",
                "priority": "NORMAL"
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Work order not found"
            )

    # Parse process template if available
    process_steps = []
    if work_order.process_template:
        try:
            process_steps = json.loads(work_order.process_template)
        except json.JSONDecodeError:
            pass

    return {
        "job_number": work_order.job_number,
        "work_order_number": work_order.work_order_number,
        "part_number": work_order.part_number,
        "part_description": work_order.part_description,
        "revision": work_order.revision,
        "quantity": work_order.quantity,
        "customer_code": work_order.customer_code,
        "customer_name": work_order.customer_name,
        "work_center": work_order.work_center,
        "priority": work_order.priority.value,
        "process_steps": process_steps
    }

@router.post("", response_model=TravelerSchema)
async def create_traveler(
    traveler_data: TravelerCreate,
    current_user: User = Depends(get_user_or_system),
    db: Session = Depends(get_db)
):
    """
    Create a new traveler.
    Supports optional authentication - uses authenticated user if token provided,
    otherwise falls back to system user for backward compatibility.
    """
    try:
        # Duplicate check: same job_number + revision is allowed when the
        # work_order_number OR po_number differs (multiple WO/PO against the
        # same job/rev is a normal workflow). Only block when job+rev AND
        # both work_order_number and po_number match an existing traveler.
        dup_query = db.query(Traveler).filter(
            Traveler.job_number == traveler_data.job_number,
            Traveler.revision == traveler_data.revision,
        )
        # Match NULL-to-NULL as well as value-to-value for WO and PO
        if traveler_data.work_order_number:
            dup_query = dup_query.filter(Traveler.work_order_number == traveler_data.work_order_number)
        else:
            dup_query = dup_query.filter(Traveler.work_order_number.is_(None))
        if traveler_data.po_number:
            dup_query = dup_query.filter(Traveler.po_number == traveler_data.po_number)
        else:
            dup_query = dup_query.filter(Traveler.po_number.is_(None))
        existing = dup_query.first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"A traveler with Job# {traveler_data.job_number} Rev {traveler_data.revision} "
                    f"and the same Work Order / PO already exists (ID: {existing.id}). "
                    "Change the Work Order Number or PO Number to create another traveler for this job/rev."
                )
            )

        # Determine labor hours based on traveler type
        # PCB parts don't need labor hours, all others do by default
        include_labor_hours = traveler_data.include_labor_hours if traveler_data.traveler_type != "PCB" else False

        resolved_quantity = resolve_traveler_quantity(traveler_data, traveler_data.rma_units)

        # Create traveler
        db_traveler = Traveler(
            job_number=traveler_data.job_number,
            work_order_number=traveler_data.work_order_number,
            po_number=traveler_data.po_number,
            traveler_type=traveler_data.traveler_type,
            part_number=traveler_data.part_number,
            part_description=traveler_data.part_description,
            revision=traveler_data.revision,
            customer_revision=traveler_data.customer_revision,
            quantity=resolved_quantity,
            customer_code=traveler_data.customer_code,
            customer_name=traveler_data.customer_name,
            priority=traveler_data.priority,
            work_center=traveler_data.work_center,
            notes=traveler_data.notes,
            specs=traveler_data.specs,
            specs_date=traveler_data.specs_date,
            from_stock=traveler_data.from_stock,
            to_stock=traveler_data.to_stock,
            ship_via=traveler_data.ship_via,
            comments=traveler_data.comments,
            start_date=traveler_data.start_date if traveler_data.start_date else datetime.now().strftime('%Y-%m-%d'),
            due_date=traveler_data.due_date,
            ship_date=traveler_data.ship_date,
            include_labor_hours=include_labor_hours,
            status=traveler_data.status if traveler_data.status else TravelerStatus.CREATED,
            is_active=traveler_data.is_active,
            created_by=current_user.id,
            # RMA-specific fields
            rma_number=traveler_data.rma_number,
            customer_contact=traveler_data.customer_contact,
            original_wo_number=traveler_data.original_wo_number,
            original_po_number=traveler_data.original_po_number,
            return_po_number=traveler_data.return_po_number,
            rma_po_number=traveler_data.rma_po_number,
            invoice_number=traveler_data.invoice_number,
            customer_ncr=traveler_data.customer_ncr,
            original_built_quantity=traveler_data.original_built_quantity,
            units_shipped=traveler_data.units_shipped,
            quantity_rma_issued=traveler_data.quantity_rma_issued,
            units_received=traveler_data.units_received,
            customer_revision_sent=traveler_data.customer_revision_sent,
            customer_revision_received=traveler_data.customer_revision_received,
            rma_notes=traveler_data.rma_notes,
            wo_type_label=traveler_data.wo_type_label,
            rma_table_columns=traveler_data.rma_table_columns,
        )

        # Build the entire traveler graph in ONE transaction. We flush (not
        # commit) to assign primary keys for FKs; the single commit at the end
        # makes creation atomic, so a failure on any step can't leave an
        # orphaned half-built traveler behind.
        db.add(db_traveler)
        db.flush()
        db.refresh(db_traveler)

        # Create process steps
        for step_data in traveler_data.process_steps:
            # Auto-create work center if it doesn't exist
            work_center = db.query(WorkCenter).filter(WorkCenter.code == step_data.work_center_code).first()
            if not work_center:
                work_center = WorkCenter(
                    code=step_data.work_center_code,
                    name=step_data.operation,
                    description=f"Auto-created from traveler",
                    is_active=True
                )
                db.add(work_center)
                db.flush()

            db_step = ProcessStep(
                traveler_id=db_traveler.id,
                step_number=step_data.step_number,
                operation=step_data.operation,
                work_center_code=step_data.work_center_code,
                instructions=step_data.instructions,
                estimated_time=step_data.estimated_time,
                is_required=step_data.is_required,
                quantity=step_data.quantity,
                accepted=step_data.accepted,
                rejected=step_data.rejected,
                sign=step_data.sign,
                completed_date=step_data.completed_date,
                completed_time=step_data.completed_time
            )
            db.add(db_step)
            db.flush()
            db.refresh(db_step)

            # Create sub-steps
            for sub_step_data in step_data.sub_steps:
                db_sub_step = SubStep(
                    process_step_id=db_step.id,
                    step_number=sub_step_data.step_number,
                    description=sub_step_data.description
                )
                db.add(db_sub_step)

        # Create manual steps
        for manual_step_data in traveler_data.manual_steps:
            db_manual_step = ManualStep(
                traveler_id=db_traveler.id,
                description=manual_step_data.description,
                added_by=current_user.id
            )
            db.add(db_manual_step)

        # Create RMA unit tracking entries
        for rma_unit_data in traveler_data.rma_units:
            db_rma_unit = RmaUnitTracking(
                traveler_id=db_traveler.id,
                unit_number=rma_unit_data.unit_number,
                serial_number=rma_unit_data.serial_number,
                customer_complaint=rma_unit_data.customer_complaint,
                incoming_inspection_notes=rma_unit_data.incoming_inspection_notes,
                disposition=rma_unit_data.disposition,
                troubleshooting_notes=rma_unit_data.troubleshooting_notes,
                repairing_notes=rma_unit_data.repairing_notes,
                final_inspection_notes=rma_unit_data.final_inspection_notes,
                customer_ncr=rma_unit_data.customer_ncr,
                original_po_number=rma_unit_data.original_po_number,
                original_wo_number=rma_unit_data.original_wo_number,
                customer_revision_sent=rma_unit_data.customer_revision_sent,
                customer_revision_received=rma_unit_data.customer_revision_received,
                original_built_quantity=rma_unit_data.original_built_quantity,
                units_shipped=rma_unit_data.units_shipped,
                custom_values=rma_unit_data.custom_values,
            )
            db.add(db_rma_unit)

        db.commit()

        # Create audit log
        audit_log = AuditLog(
            traveler_id=db_traveler.id,
            user_id=current_user.id,  # Fixed: use current_user
            action="CREATED",
            timestamp=db_traveler.created_at,
            ip_address="127.0.0.1",
            user_agent="NEXUS-Frontend"
        )
        db.add(audit_log)
        db.commit()

        # Create notification for all admins
        create_notification_for_admins(
            db=db,
            notification_type=NotificationType.TRAVELER_CREATED,
            title="New Traveler Created",
            message=f"{current_user.username} created traveler {db_traveler.job_number} - {db_traveler.part_description}",  # Fixed: use current_user
            reference_id=db_traveler.id,
            reference_type="traveler",
            created_by_username=current_user.username  # Fixed: use current_user
        )

        return db_traveler

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error creating traveler: {str(e)}"
        )

@router.get("")
async def get_travelers(
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_user_or_system),
    db: Session = Depends(get_db)
):
    """Get list of travelers with server-side pagination. Optimized: single bulk query for steps, labor, departments."""
    from sqlalchemy.orm import joinedload
    from sqlalchemy import func as sqlfunc, not_

    query = db.query(Traveler).options(joinedload(Traveler.process_steps))

    is_admin = current_user.role.value == 'ADMIN' if hasattr(current_user.role, 'value') else current_user.role == 'ADMIN'
    has_itar_access = getattr(current_user, 'is_itar', False)

    if not is_admin and not has_itar_access:
        query = query.filter(not_(Traveler.job_number.op('~')(r'[0-9]M[L[:space:]]|[0-9]M$|[0-9]ML$')))

    # Get total count first (for pagination)
    total_count = query.count()

    travelers = query.order_by(Traveler.created_at.desc()).offset(skip).limit(limit).all()
    if not travelers:
        return []

    traveler_ids = [t.id for t in travelers]

    # Bulk: work center -> department map (single query, cached)
    wc_dept_map = {wc.code: wc.department or 'Other' for wc in db.query(WorkCenter.code, WorkCenter.department).all()}

    # Per-traveler steps that count toward progress (hidden departments dropped).
    # Built before the labor rollup because the rollup's numerator has to be
    # scoped to the same set of steps as its denominator.
    progress_steps_by_traveler = {
        t.id: [s for s in (t.process_steps or [])
               if counts_toward_progress(wc_dept_map.get(s.work_center_code, 'Other'))]
        for t in travelers
    }
    progress_step_ids = [s.id for steps in progress_steps_by_traveler.values() for s in steps]

    # Bulk: labor stats per traveler (single query). Hours and entry counts cover
    # ALL labor on the job — kitting time was still worked and still belongs in
    # the total.
    from sqlalchemy import case, literal_column, Integer
    labor_stats = db.query(
        LaborEntry.traveler_id,
        sqlfunc.sum(LaborEntry.hours_worked).label('total_hours'),
        sqlfunc.count(LaborEntry.id).label('entry_count'),
        sqlfunc.sum(case((LaborEntry.is_completed == False, 1), else_=0)).label('active_count'),
    ).filter(
        LaborEntry.traveler_id.in_(traveler_ids)
    ).group_by(LaborEntry.traveler_id).all()

    labor_map = {r.traveler_id: r for r in labor_stats}

    # steps_with_labor is a progress ratio, so unlike the hour totals above it
    # counts only steps in the progress set — otherwise a job with kitting labor
    # reports more worked steps than it has steps, and percent exceeds 100.
    labor_steps_map = {}
    if progress_step_ids:
        labor_steps_map = {
            r.traveler_id: r.n
            for r in db.query(
                LaborEntry.traveler_id,
                sqlfunc.count(sqlfunc.distinct(LaborEntry.step_id)).label('n'),
            ).filter(
                LaborEntry.traveler_id.in_(traveler_ids),
                LaborEntry.step_id.in_(progress_step_ids),
            ).group_by(LaborEntry.traveler_id).all()
        }

    # Build results
    results = []
    for t in travelers:
        data = {c.name: getattr(t, c.name) for c in t.__table__.columns}
        all_steps = t.process_steps if t.process_steps else []
        # Steps in a hidden department (Receiving) stay on the traveler but are
        # left out of the progress math so they can't dilute the percentage.
        steps = progress_steps_by_traveler.get(t.id, [])
        total = len(steps)
        completed = sum(1 for s in steps if s.is_completed)
        shown_completed, shown_total = displayed_step_counts(t.status, completed, total)
        data['total_steps'] = shown_total
        data['completed_steps'] = shown_completed
        data['percent_complete'] = step_percent_complete(t.status, completed, total)

        # Department progress (computed from already-loaded steps — no extra queries)
        dept_progress = {}
        for step in all_steps:
            dept = wc_dept_map.get(step.work_center_code, 'Other')
            for d in visible_departments(dept):
                if d not in dept_progress:
                    dept_progress[d] = {'total': 0, 'completed': 0}
                dept_progress[d]['total'] += 1
                if step.is_completed:
                    dept_progress[d]['completed'] += 1

        # Resolved through the same helpers as the detail view's department
        # progress: a COMPLETED traveler reads N/N and 100% per department. Doing
        # the raw math here instead left a shipped job showing 100% overall on the
        # card while its own department chips underneath read 0%.
        data['department_progress'] = [
            {'department': dept,
             'completed_steps': displayed_step_counts(t.status, d['completed'], d['total'])[0],
             'total_steps': displayed_step_counts(t.status, d['completed'], d['total'])[1],
             'percent_complete': step_percent_complete(t.status, d['completed'], d['total'])}
            for dept, d in dept_progress.items()
        ]

        # Labor progress (from bulk query)
        ls = labor_map.get(t.id)
        if ls:
            total_hours = round(float(ls.total_hours or 0), 2)
            steps_with_labor = labor_steps_map.get(t.id, 0)
            data['labor_progress'] = {
                'total_hours': total_hours,
                'entries_count': ls.entry_count or 0,
                'active_entries': ls.active_count or 0,
                'steps_with_labor': steps_with_labor,
                'total_steps': total,
                'percent': round(steps_with_labor / total * 100, 1) if total > 0 else 0.0,
            }
        else:
            data['labor_progress'] = {'total_hours': 0, 'entries_count': 0, 'active_entries': 0, 'steps_with_labor': 0, 'total_steps': total, 'percent': 0.0}

        results.append(data)

    return results

@router.get("/latest-revision")
async def get_latest_revision_traveler(
    job_number: str,
    work_order: str,
    current_user: User = Depends(get_user_or_system),
    db: Session = Depends(get_db)
):
    """Get the latest revision traveler for a given job number and work order"""
    from sqlalchemy.orm import joinedload

    travelers = db.query(Traveler).options(
        joinedload(Traveler.process_steps)
    ).filter(
        Traveler.job_number == job_number,
        Traveler.work_order_number == work_order
    ).order_by(Traveler.revision.desc()).all()

    if not travelers:
        return None

    # Return the traveler with the highest revision
    traveler = travelers[0]

    # ITAR access check
    is_admin = current_user.role.value == 'ADMIN' if hasattr(current_user.role, 'value') else current_user.role == 'ADMIN'
    has_itar_access = getattr(current_user, 'is_itar', False)
    is_itar_job = bool(re.search(r'[0-9]M[L\s]|[0-9]M$|[0-9]ML$', traveler.job_number))
    if is_itar_job and not is_admin and not has_itar_access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ITAR restricted: You do not have permission to view this traveler")

    # Manually serialize to ensure process_steps are included
    result = {
        "id": traveler.id,
        "job_number": traveler.job_number,
        "work_order_number": traveler.work_order_number,
        "po_number": traveler.po_number,
        "traveler_type": traveler.traveler_type.value if hasattr(traveler.traveler_type, 'value') else str(traveler.traveler_type),
        "part_number": traveler.part_number,
        "part_description": traveler.part_description,
        "revision": traveler.revision,
        "customer_revision": traveler.customer_revision,
        "part_revision": getattr(traveler, 'part_revision', ''),
        "quantity": traveler.quantity,
        "customer_code": traveler.customer_code,
        "customer_name": traveler.customer_name,
        "priority": traveler.priority.value if hasattr(traveler.priority, 'value') else str(traveler.priority),
        "work_center": traveler.work_center,
        "status": traveler.status.value if hasattr(traveler.status, 'value') else str(traveler.status),
        "is_active": traveler.is_active,
        "notes": traveler.notes,
        "specs": traveler.specs,
        "specs_date": traveler.specs_date,
        "from_stock": traveler.from_stock,
        "to_stock": traveler.to_stock,
        "ship_via": traveler.ship_via,
        "comments": traveler.comments,
        "start_date": traveler.start_date,
        "due_date": traveler.due_date,
        "ship_date": traveler.ship_date,
        "include_labor_hours": traveler.include_labor_hours,
        "is_lead_free": getattr(traveler, 'is_lead_free', False),
        "is_itar": getattr(traveler, 'is_itar', False),
        "created_by": traveler.created_by,
        "created_at": traveler.created_at.isoformat() if traveler.created_at else None,
        "updated_at": traveler.updated_at.isoformat() if traveler.updated_at else None,
        "completed_at": traveler.completed_at.isoformat() if traveler.completed_at else None,
        "process_steps": [
            {
                "id": step.id,
                "step_number": step.step_number,
                "operation": step.operation,
                "work_center_code": step.work_center_code,
                "instructions": step.instructions,
                "quantity": step.quantity,
                "accepted": step.accepted,
                "rejected": step.rejected,
                "sign": step.sign,
                "completed_date": step.completed_date,
                "completed_time": step.completed_time,
                "estimated_time": step.estimated_time,
                "is_required": step.is_required,
                "is_completed": step.is_completed,
            }
            for step in sorted(traveler.process_steps, key=lambda s: s.step_number)
        ]
    }

    print(f"Returning traveler with {len(result['process_steps'])} process steps")
    return result


_RMA_TRAVELER_TYPE_VALUES = ("RMA_SAME", "RMA_DIFF", "MODIFICATION")


@router.get("/original-by-work-order/{work_order}")
async def get_original_by_work_order(
    work_order: str,
    current_user: User = Depends(get_user_or_system),
    db: Session = Depends(get_db)
):
    """Look up the original (non-RMA) traveler for a work order number so an RMA
    traveler can auto-fill the original job's details. Returns the latest-revision
    normal traveler matching the WO, or null if none exists."""
    wo = (work_order or "").strip()
    if not wo:
        return None

    traveler = db.query(Traveler).filter(
        Traveler.work_order_number == wo,
        Traveler.traveler_type.notin_(_RMA_TRAVELER_TYPE_VALUES),
    ).order_by(Traveler.revision.desc()).first()

    if not traveler:
        return None

    # ITAR access check — mirror the other traveler lookups.
    is_admin = current_user.role.value == 'ADMIN' if hasattr(current_user.role, 'value') else current_user.role == 'ADMIN'
    has_itar_access = getattr(current_user, 'is_itar', False)
    is_itar_job = bool(re.search(r'[0-9]M[L\s]|[0-9]M$|[0-9]ML$', traveler.job_number or ''))
    if is_itar_job and not is_admin and not has_itar_access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ITAR restricted: You do not have permission to view this traveler")

    return {
        "id": traveler.id,
        "job_number": traveler.job_number,
        "work_order_number": traveler.work_order_number,
        "po_number": traveler.po_number,
        "part_number": traveler.part_number,
        "part_description": traveler.part_description,
        "revision": traveler.revision,
        "customer_revision": traveler.customer_revision,
        "part_revision": getattr(traveler, 'part_revision', ''),
        "quantity": traveler.quantity,
        "customer_code": traveler.customer_code,
        "customer_name": traveler.customer_name,
    }

## ── Traveler Group endpoints ──

@router.post("/groups")
async def create_traveler_group(
    request: LinkTravelersRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a group and link travelers together"""
    if len(request.traveler_ids) < 2:
        raise HTTPException(status_code=400, detail="A group must have at least 2 travelers")
    if len(request.traveler_ids) != len(request.labels):
        raise HTTPException(status_code=400, detail="Must provide a label for each traveler")

    # Verify all travelers exist
    travelers = db.query(Traveler).filter(Traveler.id.in_(request.traveler_ids)).all()
    if len(travelers) != len(request.traveler_ids):
        raise HTTPException(status_code=404, detail="One or more travelers not found")

    # Check none are already in a group
    for t in travelers:
        if t.group_id is not None:
            raise HTTPException(status_code=400, detail=f"Traveler {t.job_number} (ID {t.id}) is already in a group. Remove it first.")

    # Create the group
    group = TravelerGroup(name=request.group_name or None, created_by=current_user.id)
    db.add(group)
    db.flush()

    # Link travelers with sequence and label
    traveler_map = {t.id: t for t in travelers}
    for i, tid in enumerate(request.traveler_ids):
        t = traveler_map[tid]
        t.group_id = group.id
        t.group_sequence = i + 1
        t.group_label = request.labels[i]

    db.commit()
    db.refresh(group)

    members = []
    for t in sorted(group.travelers, key=lambda x: x.group_sequence or 0):
        members.append({
            "id": t.id,
            "job_number": t.job_number,
            "traveler_type": t.traveler_type.value if hasattr(t.traveler_type, 'value') else str(t.traveler_type),
            "group_sequence": t.group_sequence,
            "group_label": t.group_label,
            "quantity": t.quantity,
            "status": t.status.value if hasattr(t.status, 'value') else str(t.status),
            "work_order_number": t.work_order_number
        })

    return {"id": group.id, "name": group.name, "members": members}

@router.put("/groups/{group_id}")
async def update_traveler_group(
    group_id: int,
    request: LinkTravelersRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a traveler group (reorder, add/remove members, rename)"""
    group = db.query(TravelerGroup).filter(TravelerGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    if len(request.traveler_ids) < 2:
        raise HTTPException(status_code=400, detail="A group must have at least 2 travelers")
    if len(request.traveler_ids) != len(request.labels):
        raise HTTPException(status_code=400, detail="Must provide a label for each traveler")

    # Unlink travelers no longer in the group
    old_members = db.query(Traveler).filter(Traveler.group_id == group_id).all()
    new_ids = set(request.traveler_ids)
    for t in old_members:
        if t.id not in new_ids:
            t.group_id = None
            t.group_sequence = None
            t.group_label = None

    # Verify new travelers exist
    travelers = db.query(Traveler).filter(Traveler.id.in_(request.traveler_ids)).all()
    if len(travelers) != len(request.traveler_ids):
        raise HTTPException(status_code=404, detail="One or more travelers not found")

    # Check new members aren't in a different group
    for t in travelers:
        if t.group_id is not None and t.group_id != group_id:
            raise HTTPException(status_code=400, detail=f"Traveler {t.job_number} (ID {t.id}) is already in another group")

    # Update group
    group.name = request.group_name or group.name

    # Assign sequence and label
    traveler_map = {t.id: t for t in travelers}
    for i, tid in enumerate(request.traveler_ids):
        t = traveler_map[tid]
        t.group_id = group_id
        t.group_sequence = i + 1
        t.group_label = request.labels[i]

    db.commit()
    db.refresh(group)

    members = []
    for t in sorted(group.travelers, key=lambda x: x.group_sequence or 0):
        members.append({
            "id": t.id,
            "job_number": t.job_number,
            "traveler_type": t.traveler_type.value if hasattr(t.traveler_type, 'value') else str(t.traveler_type),
            "group_sequence": t.group_sequence,
            "group_label": t.group_label,
            "quantity": t.quantity,
            "status": t.status.value if hasattr(t.status, 'value') else str(t.status),
            "work_order_number": t.work_order_number
        })

    return {"id": group.id, "name": group.name, "members": members}

@router.delete("/groups/{group_id}")
async def delete_traveler_group(
    group_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Dissolve a traveler group"""
    group = db.query(TravelerGroup).filter(TravelerGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    # Unlink all travelers
    for t in group.travelers:
        t.group_id = None
        t.group_sequence = None
        t.group_label = None

    db.delete(group)
    db.commit()
    return {"detail": "Group dissolved"}

@router.get("/groups/{group_id}")
async def get_traveler_group(
    group_id: int,
    current_user: User = Depends(get_user_or_system),
    db: Session = Depends(get_db)
):
    """Get group info with all members"""
    group = db.query(TravelerGroup).filter(TravelerGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    # ITAR filtering on members
    is_admin = current_user.role.value == 'ADMIN' if hasattr(current_user.role, 'value') else current_user.role == 'ADMIN'
    has_itar_access = getattr(current_user, 'is_itar', False)

    members = []
    for t in sorted(group.travelers, key=lambda x: x.group_sequence or 0):
        is_itar_job = bool(re.search(r'[0-9]M[L\s]|[0-9]M$|[0-9]ML$', t.job_number))
        if is_itar_job and not is_admin and not has_itar_access:
            members.append({
                "id": t.id,
                "job_number": "ITAR Restricted",
                "traveler_type": "RESTRICTED",
                "group_sequence": t.group_sequence,
                "group_label": t.group_label,
                "quantity": 0,
                "status": "RESTRICTED",
                "work_order_number": None
            })
        else:
            members.append({
                "id": t.id,
                "job_number": t.job_number,
                "traveler_type": t.traveler_type.value if hasattr(t.traveler_type, 'value') else str(t.traveler_type),
                "group_sequence": t.group_sequence,
                "group_label": t.group_label,
                "quantity": t.quantity,
                "status": t.status.value if hasattr(t.status, 'value') else str(t.status),
                "work_order_number": t.work_order_number
            })

    return {"id": group.id, "name": group.name, "total_count": len(members), "members": members}

def _lookup_candidates(raw: str) -> list:
    """Break a user-typed job lookup into the values worth matching on.

    RMA and MODIFICATION travelers carry the RMA number in work_order_number
    and the original job in job_number, and people write them together in
    every shape: "1108", "8500L", "1108 RMA JOB 8500L", "1108 RMA JOB NO 8500L",
    "1108 MOD JOB 8500L". Any of those should find the same traveler.
    """
    text = re.sub(r'\s+', ' ', (raw or '')).strip()
    if not text:
        return []

    candidates = [text]
    # Split on the connector words people put between the RMA/MOD number and
    # the job, e.g. "1108 RMA JOB NO 8500L" -> ["1108", "8500L"].
    parts = re.split(
        r'\s*(?:RMA|MOD(?:IFICATION)?)?\s*JOB(?:\s*(?:NO|NUMBER|#))?\s*|\s+(?:RMA|MOD(?:IFICATION)?)\s+',
        text,
        flags=re.IGNORECASE,
    )
    for part in parts:
        part = part.strip()
        if part and part.upper() not in {'RMA', 'MOD', 'MODIFICATION', 'JOB', 'NO'}:
            candidates.append(part)

    # De-dupe, preserve order
    seen = set()
    result = []
    for c in candidates:
        key = c.upper()
        if key not in seen:
            seen.add(key)
            result.append(c)
    return result


def _find_travelers_for_lookup(db: Session, raw: str):
    """Travelers matching a job lookup, best match first.

    Matches job_number OR work_order_number (case-insensitive) so RMA/MOD
    travelers — whose RMA number lives in work_order_number — are findable.
    Exact job-number hits rank ahead of work-order hits. When nothing matches
    exactly, retries on the leading token so a bare "8689L" finds the traveler
    filed as "8689L CABLE ASSY".
    """
    from sqlalchemy.orm import joinedload

    candidates = _lookup_candidates(raw)
    if not candidates:
        return []

    upper = [c.upper() for c in candidates]
    base = db.query(Traveler).options(joinedload(Traveler.process_steps))

    travelers = base.filter(
        or_(
            func.upper(Traveler.job_number).in_(upper),
            func.upper(Traveler.work_order_number).in_(upper),
            func.upper(Traveler.po_number).in_(upper),
        )
    ).all()

    match_terms = upper
    if not travelers:
        # Nothing filed under exactly what was typed. Travelers carry a work
        # descriptor on the job — "8689L CABLE ASSY", "8762L KANBAN" — while
        # operators type the bare job, and sometimes the other way round. Retry
        # on the leading token, in both directions.
        #
        # Fallback only, never widening: when an exact job exists, callers that
        # refuse to guess between multiple hits (labor tracking makes the
        # operator scan the WC QR) must keep seeing that single exact match.
        heads = []
        for c in upper:
            head = c.split(' ')[0]
            if head and head not in heads:
                heads.append(head)
        match_terms = heads

        conditions = [func.upper(Traveler.job_number).in_(heads)]
        for c in heads:
            escaped = c.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
            conditions.append(
                func.upper(Traveler.job_number).like(f'{escaped} %', escape='\\')
            )
        travelers = base.filter(or_(*conditions)).all()

    typed = (raw or '').strip().upper()

    def rank(t):
        job = (t.job_number or '').upper()
        wo = (t.work_order_number or '').upper()
        po = (t.po_number or '').upper()
        if job == typed or wo == typed or (po and po == typed):
            return 0          # exactly what the user typed
        if wo in match_terms:
            return 1          # RMA/MOD number pulled out of a composite string
        if job in match_terms:
            return 2          # the job half of a composite string
        if any(job.startswith(f'{c} ') for c in match_terms):
            return 3          # same job, plus a work descriptor ("CABLE ASSY")
        return 4              # PO number

    # Latest revision first within a rank (preserves the previous
    # "latest revision wins" behaviour for plain job-number lookups).
    by_revision = sorted(
        travelers,
        key=lambda t: ((t.revision or ''), (t.work_order_number or '')),
        reverse=True,
    )
    return sorted(by_revision, key=rank)


@router.get("/by-job-number/{job_number}/all-work-orders")
async def get_all_work_orders_for_job(
    job_number: str,
    current_user: User = Depends(get_user_or_system),
    db: Session = Depends(get_db)
):
    """Get all travelers (work orders) for a given job number.
    Returns a list of work orders with their details so the user can select one.
    Also resolves RMA/MOD numbers and composite strings like "1108 RMA JOB 8500L"."""
    # ITAR access check
    is_admin = current_user.role.value == 'ADMIN' if hasattr(current_user.role, 'value') else current_user.role == 'ADMIN'
    has_itar_access = getattr(current_user, 'is_itar', False)
    is_itar_job = bool(re.search(r'[0-9]M[L\s]|[0-9]M$|[0-9]ML$', job_number))
    if is_itar_job and not is_admin and not has_itar_access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ITAR restricted: You do not have permission to view this traveler")

    travelers = _find_travelers_for_lookup(db, job_number)

    if not travelers:
        return []

    results = []
    for traveler in travelers:
        results.append({
            "id": traveler.id,
            "job_number": traveler.job_number,
            "work_order_number": traveler.work_order_number,
            "po_number": traveler.po_number,
            "traveler_type": traveler.traveler_type.value if hasattr(traveler.traveler_type, 'value') else str(traveler.traveler_type),
            "part_number": traveler.part_number,
            "part_description": traveler.part_description,
            "revision": traveler.revision,
            "customer_revision": traveler.customer_revision,
            "part_revision": getattr(traveler, 'part_revision', ''),
            "quantity": traveler.quantity,
            "customer_code": traveler.customer_code,
            "customer_name": traveler.customer_name,
            "priority": traveler.priority.value if hasattr(traveler.priority, 'value') else str(traveler.priority),
            "work_center": traveler.work_center,
            "status": traveler.status.value if hasattr(traveler.status, 'value') else str(traveler.status),
            "is_active": traveler.is_active,
            "notes": traveler.notes,
            "specs": traveler.specs,
            "specs_date": traveler.specs_date,
            "from_stock": traveler.from_stock,
            "to_stock": traveler.to_stock,
            "ship_via": traveler.ship_via,
            "comments": traveler.comments,
            "start_date": traveler.start_date,
            "due_date": traveler.due_date,
            "ship_date": traveler.ship_date,
            "include_labor_hours": traveler.include_labor_hours,
            "is_lead_free": getattr(traveler, 'is_lead_free', False),
            "is_itar": getattr(traveler, 'is_itar', False),
            "created_at": traveler.created_at.isoformat() if traveler.created_at else None,
            "process_steps": [
                {
                    "id": step.id,
                    "step_number": step.step_number,
                    "operation": step.operation,
                    "work_center_code": step.work_center_code,
                    "instructions": step.instructions,
                    "quantity": step.quantity,
                    "accepted": step.accepted,
                    "rejected": step.rejected,
                    "sign": step.sign,
                    "completed_date": step.completed_date,
                    "completed_time": step.completed_time,
                    "estimated_time": step.estimated_time,
                    "is_required": step.is_required,
                    "is_completed": step.is_completed,
                }
                for step in sorted(traveler.process_steps, key=lambda s: s.step_number)
            ]
        })

    return results

@router.get("/by-job-number/{job_number}")
async def get_traveler_by_job_number(
    job_number: str,
    current_user: User = Depends(get_user_or_system),
    db: Session = Depends(get_db)
):
    """Get the best-matching traveler for a job lookup (no work order required).
    Accepts a job number, an RMA/MOD work order number, or a composite string."""
    # ITAR access check
    is_admin = current_user.role.value == 'ADMIN' if hasattr(current_user.role, 'value') else current_user.role == 'ADMIN'
    has_itar_access = getattr(current_user, 'is_itar', False)
    is_itar_job = bool(re.search(r'[0-9]M[L\s]|[0-9]M$|[0-9]ML$', job_number))
    if is_itar_job and not is_admin and not has_itar_access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="ITAR restricted: You do not have permission to view this traveler")

    travelers = _find_travelers_for_lookup(db, job_number)

    if not travelers:
        return None

    traveler = travelers[0]

    result = {
        "id": traveler.id,
        "job_number": traveler.job_number,
        "work_order_number": traveler.work_order_number,
        "po_number": traveler.po_number,
        "traveler_type": traveler.traveler_type.value if hasattr(traveler.traveler_type, 'value') else str(traveler.traveler_type),
        "part_number": traveler.part_number,
        "part_description": traveler.part_description,
        "revision": traveler.revision,
        "customer_revision": traveler.customer_revision,
        "part_revision": getattr(traveler, 'part_revision', ''),
        "quantity": traveler.quantity,
        "customer_code": traveler.customer_code,
        "customer_name": traveler.customer_name,
        "priority": traveler.priority.value if hasattr(traveler.priority, 'value') else str(traveler.priority),
        "work_center": traveler.work_center,
        "status": traveler.status.value if hasattr(traveler.status, 'value') else str(traveler.status),
        "is_active": traveler.is_active,
        "notes": traveler.notes,
        "specs": traveler.specs,
        "specs_date": traveler.specs_date,
        "from_stock": traveler.from_stock,
        "to_stock": traveler.to_stock,
        "ship_via": traveler.ship_via,
        "comments": traveler.comments,
        "start_date": traveler.start_date,
        "due_date": traveler.due_date,
        "ship_date": traveler.ship_date,
        "include_labor_hours": traveler.include_labor_hours,
        "is_lead_free": getattr(traveler, 'is_lead_free', False),
        "is_itar": getattr(traveler, 'is_itar', False),
        "created_at": traveler.created_at.isoformat() if traveler.created_at else None,
        "process_steps": [
            {
                "id": step.id,
                "step_number": step.step_number,
                "operation": step.operation,
                "work_center_code": step.work_center_code,
                "instructions": step.instructions,
                "quantity": step.quantity,
                "accepted": step.accepted,
                "rejected": step.rejected,
                "sign": step.sign,
                "completed_date": step.completed_date,
                "completed_time": step.completed_time,
                "estimated_time": step.estimated_time,
                "is_required": step.is_required,
                "is_completed": step.is_completed,
            }
            for step in sorted(traveler.process_steps, key=lambda s: s.step_number)
        ]
    }

    return result

@router.get("/dashboard-summary")
async def get_dashboard_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_user_or_system),
    db: Session = Depends(get_db)
):
    """Get active travelers with progress/step data for the dashboard, filtered by due_date/ship_date range."""
    from sqlalchemy.orm import joinedload
    from sqlalchemy import func, or_, and_

    query = db.query(Traveler).options(
        joinedload(Traveler.process_steps)
    ).filter(
        ~Traveler.status.in_([TravelerStatus.ARCHIVED, TravelerStatus.CANCELLED])
    )

    # Filter by due_date or ship_date falling within the selected range
    if start_date and end_date:
        query = query.filter(
            or_(
                and_(Traveler.due_date.isnot(None), Traveler.due_date >= start_date, Traveler.due_date <= end_date),
                and_(Traveler.ship_date.isnot(None), Traveler.ship_date >= start_date, Traveler.ship_date <= end_date),
                # Also include travelers with no dates set (so they aren't hidden)
                and_(Traveler.due_date.is_(None), Traveler.ship_date.is_(None))
            )
        )

    # ITAR filtering for non-privileged users
    is_admin = current_user.role.value == 'ADMIN' if hasattr(current_user.role, 'value') else current_user.role == 'ADMIN'
    has_itar_access = getattr(current_user, 'is_itar', False)
    if not is_admin and not has_itar_access:
        from sqlalchemy import not_
        query = query.filter(not_(Traveler.job_number.op('~')(r'[0-9]M[L[:space:]]|[0-9]M$|[0-9]ML$')))

    travelers = query.order_by(Traveler.created_at.desc()).all()

    # Get latest tracking locations in bulk
    latest_scans = {}
    if travelers:
        traveler_ids = [t.id for t in travelers]
        # Subquery to get max scanned_at per traveler
        subq = db.query(
            TravelerTrackingLog.traveler_id,
            func.max(TravelerTrackingLog.scanned_at).label('max_scan')
        ).filter(
            TravelerTrackingLog.traveler_id.in_(traveler_ids),
            TravelerTrackingLog.scan_type == "WORK_CENTER"
        ).group_by(TravelerTrackingLog.traveler_id).subquery()

        scans = db.query(TravelerTrackingLog).join(
            subq,
            (TravelerTrackingLog.traveler_id == subq.c.traveler_id) &
            (TravelerTrackingLog.scanned_at == subq.c.max_scan)
        ).all()

        for scan in scans:
            latest_scans[scan.traveler_id] = scan.work_center

    # Build work center -> department map for all work centers
    all_work_centers = db.query(WorkCenter).all()
    wc_dept_map = {wc.code: wc.department or 'Other' for wc in all_work_centers}

    # Get labor entries for all dashboard travelers in bulk
    dash_traveler_ids = [t.id for t in travelers]
    dash_labor_entries = db.query(LaborEntry).filter(LaborEntry.traveler_id.in_(dash_traveler_ids)).all() if dash_traveler_ids else []
    dash_labor_by_traveler = {}
    for le in dash_labor_entries:
        dash_labor_by_traveler.setdefault(le.traveler_id, []).append(le)

    results = []
    for t in travelers:
        steps = sorted(t.process_steps, key=lambda s: s.step_number)
        # Progress ignores hidden-department steps (Receiving); current step and
        # the qty rollups below still consider every step on the traveler.
        progress_steps = [s for s in steps
                          if counts_toward_progress(wc_dept_map.get(s.work_center_code, 'Other'))]
        raw_total = len(progress_steps)
        raw_completed = sum(1 for s in progress_steps if s.is_completed)
        percent_complete = step_percent_complete(t.status, raw_completed, raw_total)
        completed_steps, total_steps = displayed_step_counts(t.status, raw_completed, raw_total)

        # Current step = first incomplete step
        current_step_obj = next((s for s in steps if not s.is_completed), None)
        current_step = current_step_obj.operation if current_step_obj else ("Complete" if total_steps > 0 else "No steps")
        current_work_center = current_step_obj.work_center_code if current_step_obj else None

        # Sum accepted/rejected across all steps
        qty_accepted = sum(s.accepted or 0 for s in steps)
        qty_rejected = sum(s.rejected or 0 for s in steps)

        # Department progress
        dept_progress = {}
        for step in steps:
            dept = wc_dept_map.get(step.work_center_code, 'Other')
            for individual_dept in visible_departments(dept):
                if individual_dept not in dept_progress:
                    dept_progress[individual_dept] = {'total': 0, 'completed': 0}
                dept_progress[individual_dept]['total'] += 1
                if step.is_completed:
                    dept_progress[individual_dept]['completed'] += 1

        department_progress = [
            {
                'department': dept,
                'total_steps': data['total'],
                'completed_steps': data['completed'],
                'percent_complete': round((data['completed'] / data['total']) * 100, 1) if data['total'] > 0 else 0,
            }
            for dept, data in dept_progress.items()
        ]

        # Labor progress
        t_labor = dash_labor_by_traveler.get(t.id, [])
        total_labor_hours = round(sum(le.hours_worked or 0 for le in t_labor), 2)
        labor_entries_count = len(t_labor)
        active_labor = sum(1 for le in t_labor if not le.is_completed)
        steps_with_labor = len(set(le.step_id for le in t_labor if le.step_id))
        labor_percent = round((steps_with_labor / total_steps) * 100, 1) if total_steps > 0 else 0.0

        results.append({
            "id": t.id,
            "job_number": t.job_number,
            "part_number": t.part_number,
            "part_description": t.part_description,
            "traveler_type": t.traveler_type.value if hasattr(t.traveler_type, 'value') else str(t.traveler_type),
            "quantity": t.quantity,
            "status": t.status.value if hasattr(t.status, 'value') else str(t.status),
            "priority": t.priority.value if hasattr(t.priority, 'value') else str(t.priority),
            "work_center": t.work_center,
            "due_date": t.due_date,
            "ship_date": t.ship_date,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "total_steps": total_steps,
            "completed_steps": completed_steps,
            "percent_complete": percent_complete,
            "current_step": current_step,
            "current_work_center": current_work_center or latest_scans.get(t.id),
            "qty_accepted": qty_accepted,
            "qty_rejected": qty_rejected,
            "department_progress": department_progress,
            "labor_progress": {
                "total_hours": total_labor_hours,
                "entries_count": labor_entries_count,
                "active_entries": active_labor,
                "steps_with_labor": steps_with_labor,
                "total_steps": total_steps,
                "percent": labor_percent,
            },
        })

    return results

@router.get("/department-progress/{traveler_id}")
async def get_department_progress(
    traveler_id: int,
    current_user: User = Depends(get_user_or_system),
    db: Session = Depends(get_db)
):
    """Get department-wise and step-wise progress for a traveler.
    Returns progress grouped by department with individual step completion status."""
    from sqlalchemy.orm import joinedload

    traveler = db.query(Traveler).options(
        joinedload(Traveler.process_steps)
    ).filter(Traveler.id == traveler_id).first()

    if not traveler:
        raise HTTPException(status_code=404, detail="Traveler not found")

    steps = sorted(traveler.process_steps, key=lambda s: s.step_number)

    # Get department mapping from work centers
    wc_codes = list(set(s.work_center_code for s in steps))
    work_centers = db.query(WorkCenter).filter(WorkCenter.code.in_(wc_codes)).all()
    wc_dept_map = {wc.code: wc.department or 'Other' for wc in work_centers}

    # Build department progress
    departments = {}
    for step in steps:
        dept = wc_dept_map.get(step.work_center_code, 'Other')
        # Multi-department work centers ("SMT/Soldering/Test") land in each of
        # their departments; hidden ones (Receiving) are dropped here.
        split_depts = visible_departments(dept)

        step_data = {
            'id': step.id,
            'step_number': step.step_number,
            'operation': step.operation,
            'work_center_code': step.work_center_code,
            'is_completed': step.is_completed,
            'completed_by': step.completed_by,
            'completed_at': step.completed_at.isoformat() if step.completed_at else None,
            'department': dept,
        }

        for individual_dept in split_depts:
            if individual_dept not in departments:
                departments[individual_dept] = {
                    'department': individual_dept,
                    'total_steps': 0,
                    'completed_steps': 0,
                    'percent_complete': 0,
                    'steps': []
                }

            departments[individual_dept]['total_steps'] += 1
            if step.is_completed:
                departments[individual_dept]['completed_steps'] += 1

            departments[individual_dept]['steps'].append(step_data)

    # Calculate percentages. A COMPLETED traveler resolves every department to
    # N/N and 100% for the same reason the overall figure does: shipping is the
    # terminal step, so the work is done even where a department's steps went
    # unsigned. Otherwise the card contradicts the 100% shown right above it.
    for dept_data in departments.values():
        total = dept_data['total_steps']
        completed = dept_data['completed_steps']
        dept_data['percent_complete'] = step_percent_complete(traveler.status, completed, total)
        dept_data['completed_steps'], dept_data['total_steps'] = displayed_step_counts(
            traveler.status, completed, total)

    # Overall progress — hidden-department steps (Receiving) sit out of the math
    progress_steps = [s for s in steps
                      if counts_toward_progress(wc_dept_map.get(s.work_center_code, 'Other'))]
    raw_total = len(progress_steps)
    raw_completed = sum(1 for s in progress_steps if s.is_completed)
    overall_percent = step_percent_complete(traveler.status, raw_completed, raw_total)
    completed_steps, total_steps = displayed_step_counts(traveler.status, raw_completed, raw_total)

    # Labor progress for this traveler
    labor_entries = db.query(LaborEntry).filter(LaborEntry.traveler_id == traveler_id).all()
    total_labor_hours = round(sum(le.hours_worked or 0 for le in labor_entries), 2)
    labor_entries_count = len(labor_entries)
    active_labor = sum(1 for le in labor_entries if not le.is_completed)
    # Numerator must match total_steps' denominator: KITTING carries labor but is
    # no longer in the progress set, and counting it here would push labor_percent
    # past 100%.
    progress_step_ids = {s.id for s in progress_steps}
    steps_with_labor = len({le.step_id for le in labor_entries
                            if le.step_id in progress_step_ids})
    labor_percent = round((steps_with_labor / total_steps) * 100, 1) if total_steps > 0 else 0.0

    # Labor hours per department
    labor_by_step_id = {}
    for le in labor_entries:
        if le.step_id:
            labor_by_step_id.setdefault(le.step_id, []).append(le)

    for dept_data in departments.values():
        dept_labor_hours = 0
        dept_steps_with_labor = 0
        for s in dept_data['steps']:
            step_labor = labor_by_step_id.get(s['id'], [])
            step_hours = sum(le.hours_worked or 0 for le in step_labor)
            dept_labor_hours += step_hours
            if step_labor:
                dept_steps_with_labor += 1
            s['labor_hours'] = round(step_hours, 2)
            s['has_labor'] = len(step_labor) > 0
        dept_data['labor_hours'] = round(dept_labor_hours, 2)
        dept_data['steps_with_labor'] = dept_steps_with_labor
        dept_data['labor_percent'] = round((dept_steps_with_labor / dept_data['total_steps']) * 100, 1) if dept_data['total_steps'] > 0 else 0

    # Labor hours grouped by work center category (e.g. SMT, Hand, TH, AOI, etc.)
    wc_category_map = {wc.code: wc.category for wc in work_centers if wc.category}
    # Also map by name for labor entries that use work_center name
    wc_name_category_map = {wc.name.upper().strip(): wc.category for wc in work_centers if wc.name and wc.category}
    # Map code to name
    wc_code_name_map = {wc.code: wc.name for wc in work_centers if wc.name}

    category_hours: dict = {}

    # Seed 0.00 for every category this job's steps actually cover. That is what
    # lets the traveler tell "has a testing step, nobody has clocked it yet"
    # (E-Test present at 0.00) apart from "this job has no testing at all"
    # (E-Test absent, so the UI omits the row) — the table used to hardcode six
    # rows and show both cases identically.
    for step in steps:
        cat = wc_category_map.get(step.work_center_code)
        if cat:
            category_hours.setdefault(short_category(cat), 0.0)

    for le in labor_entries:
        # Try to get category from work_center code or name
        cat = None
        if le.work_center:
            wc_upper = le.work_center.upper().strip()
            # Try by code first
            cat = wc_category_map.get(le.work_center)
            if not cat:
                cat = wc_name_category_map.get(wc_upper)
        if not cat and le.step_id:
            # Try from the step's work center code
            for step in steps:
                if step.id == le.step_id:
                    cat = wc_category_map.get(step.work_center_code)
                    break
        cat_short = short_category(cat)
        category_hours[cat_short] = round(category_hours.get(cat_short, 0) + (le.hours_worked or 0), 2)

    return {
        'traveler_id': traveler_id,
        'overall': {
            'total_steps': total_steps,
            'completed_steps': completed_steps,
            'percent_complete': overall_percent,
        },
        'labor': {
            'total_hours': total_labor_hours,
            'entries_count': labor_entries_count,
            'active_entries': active_labor,
            'steps_with_labor': steps_with_labor,
            'total_steps': total_steps,
            'percent': labor_percent,
        },
        'category_hours': category_hours,
        'departments': list(departments.values()),
    }

@router.get("/by-job/{job_number}", response_model=TravelerSchema)
async def get_traveler_by_job(
    job_number: str,
    current_user: User = Depends(get_user_or_system),
    db: Session = Depends(get_db)
):
    """Get a specific traveler by job number"""
    traveler = db.query(Traveler).filter(Traveler.job_number == job_number).first()
    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Traveler not found"
        )

    # Check ITAR access - if job_number contains 'M', only ADMIN users or users with is_itar=True can view
    is_admin = current_user.role.value == 'ADMIN' if hasattr(current_user.role, 'value') else current_user.role == 'ADMIN'
    has_itar_access = getattr(current_user, 'is_itar', False)

    is_itar_job = bool(re.search(r'[0-9]M[L\s]|[0-9]M$|[0-9]ML$', traveler.job_number))
    if is_itar_job and not is_admin and not has_itar_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ITAR restricted: You do not have permission to view this traveler"
        )

    return traveler

class StepCompletionUpdate(BaseModel):
    is_completed: bool


@router.patch("/{traveler_id}/steps/{step_id}/completion")
async def set_step_completion(
    traveler_id: int,
    step_id: int,
    payload: StepCompletionUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin override for a single step's completion, driven from the traveler's
    Department Progress card.

    Steps normally complete as a side effect of closing a labor entry; this is
    the manual path for work that was done but never clocked.

    Status follows the same rule as the labor flow: SHIPPING is the terminal
    step, so ticking it completes the traveler and unticking it reopens one that
    was completed. No other step moves status — a mid-route step being marked
    done says nothing about whether the job shipped.

    completed_by / completed_at record who overrode it, which is also what the
    traveler prints in the SIGN column for a step carrying no labor.
    """
    is_admin = current_user.role.value == 'ADMIN' if hasattr(current_user.role, 'value') else current_user.role == 'ADMIN'
    if not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can change step completion",
        )

    step = db.query(ProcessStep).filter(
        ProcessStep.id == step_id,
        ProcessStep.traveler_id == traveler_id,
    ).first()
    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Step not found on this traveler",
        )

    was_completed = bool(step.is_completed)
    if was_completed == payload.is_completed:
        return {'step_id': step.id, 'is_completed': was_completed, 'changed': False}

    step.is_completed = payload.is_completed
    if payload.is_completed:
        step.completed_by = current_user.id
        step.completed_at = datetime.now()
    else:
        # Clearing a step drops the override marks too, so its sign-off falls
        # back to whatever labor was actually logged against it.
        step.completed_by = None
        step.completed_at = None

    db.add(AuditLog(
        traveler_id=traveler_id,
        user_id=current_user.id,
        action="UPDATED",
        field_changed=f"step_{step.step_number}_is_completed",
        old_value=str(was_completed),
        new_value=str(payload.is_completed),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get('user-agent'),
    ))

    # Shipping is the terminal step: ticking it means the job went out the door.
    status_changed = None
    if (step.operation or "").strip().upper() == "SHIPPING":
        traveler = db.query(Traveler).filter(Traveler.id == traveler_id).first()
        if traveler:
            old_status = traveler.status.value if hasattr(traveler.status, 'value') else str(traveler.status)
            if payload.is_completed and not is_completed_status(traveler.status):
                traveler.status = TravelerStatus.COMPLETED
                traveler.completed_at = datetime.now()
                status_changed = f"{old_status} -> COMPLETED"
            elif not payload.is_completed and is_completed_status(traveler.status):
                # Reopening shipping reopens the job, so a mis-tick is undoable
                # rather than permanently sealing the traveler as shipped.
                traveler.status = TravelerStatus.IN_PROGRESS
                traveler.completed_at = None
                status_changed = f"{old_status} -> IN_PROGRESS"
            if status_changed:
                db.add(AuditLog(
                    traveler_id=traveler_id,
                    user_id=current_user.id,
                    action="UPDATED",
                    field_changed="status",
                    old_value=old_status,
                    new_value=traveler.status.value,
                    ip_address=request.client.host if request.client else None,
                    user_agent=request.headers.get('user-agent'),
                ))

    db.commit()

    logger.info(
        "step completion override: traveler=%s step=%s (%s) %s -> %s by %s%s",
        traveler_id, step.id, step.operation, was_completed, payload.is_completed,
        current_user.username, f" | status {status_changed}" if status_changed else "",
    )
    return {
        'step_id': step.id,
        'is_completed': step.is_completed,
        'changed': True,
        'status_changed': status_changed,
    }


def _signer_initial(first_name: Optional[str]) -> Optional[str]:
    """Operator sign-off name: the first name as-is (Bharat, Yullia)."""
    cleaned = (first_name or "").strip()
    return cleaned or None


def _attach_labor_signoff(db: Session, traveler: Traveler, result: dict) -> None:
    """Populate each step's sign-off values from recorded labor.

    Rolls labor_entries up per step_id — summed hours_worked, the most recent
    entry's timestamp, and an initial for every operator who logged against the
    step — and writes them onto the serialized steps as labor_total_hours /
    labor_latest_date / labor_signers. Joins on step_id rather than the
    LaborEntry.work_center name string, which is fuzzy-matched from the operator's
    description (see labor.py) and is not a reliable key.

    Read-time derivation, not a write: the numbers pick up new labor on the next
    fetch, and a step with no labor keeps whatever was entered by hand.
    """
    from sqlalchemy import func as sqlfunc

    steps = result.get("process_steps") or []
    step_ids = [s.id for s in traveler.process_steps]
    if not step_ids or not steps:
        return

    rows = db.query(
        LaborEntry.step_id,
        sqlfunc.sum(LaborEntry.hours_worked).label("total_hours"),
        sqlfunc.max(sqlfunc.coalesce(LaborEntry.end_time, LaborEntry.start_time)).label("latest"),
    ).filter(
        LaborEntry.step_id.in_(step_ids)
    ).group_by(LaborEntry.step_id).all()
    rollup = {r.step_id: r for r in rows}

    # One row per (step, operator), ordered so the signatures read in the order
    # people actually started working the step.
    signer_rows = db.query(
        LaborEntry.step_id,
        User.first_name,
        sqlfunc.min(LaborEntry.start_time).label("first_at"),
    ).join(
        User, User.id == LaborEntry.employee_id
    ).filter(
        LaborEntry.step_id.in_(step_ids)
    ).group_by(
        LaborEntry.step_id, User.id, User.first_name
    ).all()

    signers: dict = {}
    for r in sorted(signer_rows, key=lambda r: (r.first_at is None, r.first_at)):
        name = _signer_initial(r.first_name)
        # Dedupe on the name, not the user: two operators sharing a first name
        # would otherwise sign the step "Bharat, Bharat".
        if name and name not in signers.setdefault(r.step_id, []):
            signers[r.step_id].append(name)

    # A step an admin ticked complete by hand carries no labor, so it would print
    # with an empty sign-off. Fall back to whoever overrode it (completed_by /
    # completed_at) so the paper traveler still shows a signature and a date. No
    # hours are invented — nobody clocked any.
    override_by_step = {
        s.id: (s.completed_by, s.completed_at)
        for s in traveler.process_steps
        if s.is_completed and s.completed_by and s.id not in signers
    }
    override_names = {}
    override_ids = {uid for uid, _ in override_by_step.values()}
    if override_ids:
        override_names = {
            u.id: u.first_name
            for u in db.query(User).filter(User.id.in_(override_ids)).all()
        }

    for step in steps:
        step_id = step.get("id")
        step["labor_signers"] = signers.get(step_id, [])

        if step_id in override_by_step:
            uid, when = override_by_step[step_id]
            initial = _signer_initial(override_names.get(uid))
            if initial:
                step["labor_signers"] = [initial]
            if when is not None:
                step["labor_latest_date"] = (
                    when.strftime("%Y-%m-%d") if hasattr(when, "strftime") else str(when)[:10]
                )

        row = rollup.get(step_id)
        if not row:
            continue
        step["labor_total_hours"] = round(float(row.total_hours or 0), 2)
        latest = row.latest
        if latest is not None:
            # SQLite hands back a string here; Postgres a datetime.
            step["labor_latest_date"] = (
                latest.strftime("%Y-%m-%d") if hasattr(latest, "strftime") else str(latest)[:10]
            )


@router.get("/{traveler_id}")
async def get_traveler(
    traveler_id: int,
    current_user: User = Depends(get_user_or_system),
    db: Session = Depends(get_db)
):
    """Get a specific traveler by ID, includes group_info if traveler is in a group"""
    from sqlalchemy.orm import joinedload

    traveler = db.query(Traveler).options(
        joinedload(Traveler.process_steps)
    ).filter(Traveler.id == traveler_id).first()
    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Traveler not found"
        )

    # Check ITAR access - if job_number contains 'M', only ADMIN users or users with is_itar=True can view
    is_admin = current_user.role.value == 'ADMIN' if hasattr(current_user.role, 'value') else current_user.role == 'ADMIN'
    has_itar_access = getattr(current_user, 'is_itar', False)

    is_itar_job = bool(re.search(r'[0-9]M[L\s]|[0-9]M$|[0-9]ML$', traveler.job_number))
    if is_itar_job and not is_admin and not has_itar_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ITAR restricted: You do not have permission to view this traveler"
        )

    # Build group_info if traveler is in a group
    group_info = None
    if traveler.group_id:
        siblings = db.query(Traveler).filter(Traveler.group_id == traveler.group_id).order_by(Traveler.group_sequence).all()
        group = db.query(TravelerGroup).filter(TravelerGroup.id == traveler.group_id).first()
        members = []
        for s in siblings:
            s_itar = bool(re.search(r'[0-9]M[L\s]|[0-9]M$|[0-9]ML$', s.job_number))
            if s_itar and not is_admin and not has_itar_access:
                members.append({
                    "id": s.id, "job_number": "ITAR Restricted", "traveler_type": "RESTRICTED",
                    "group_sequence": s.group_sequence, "group_label": s.group_label,
                    "quantity": 0, "status": "RESTRICTED", "work_order_number": None
                })
            else:
                members.append({
                    "id": s.id, "job_number": s.job_number,
                    "traveler_type": s.traveler_type.value if hasattr(s.traveler_type, 'value') else str(s.traveler_type),
                    "group_sequence": s.group_sequence, "group_label": s.group_label,
                    "quantity": s.quantity,
                    "status": s.status.value if hasattr(s.status, 'value') else str(s.status),
                    "work_order_number": s.work_order_number
                })
        group_info = {
            "group_id": traveler.group_id,
            "group_name": group.name if group else None,
            "current_sequence": traveler.group_sequence,
            "total_count": len(members),
            "members": members
        }

    # Serialize traveler using the schema, then add group_info
    from schemas.traveler_schemas import Traveler as TravelerSchema
    result = TravelerSchema.model_validate(traveler).model_dump()
    result["group_info"] = group_info
    _attach_labor_signoff(db, traveler, result)
    return result

@router.put("/{traveler_id}", response_model=TravelerSchema)
async def update_traveler(
    traveler_id: int,
    traveler_data: TravelerCreate,
    current_user: User = Depends(get_user_or_system),
    db: Session = Depends(get_db)
):
    """Update a traveler. PRESERVES labor entries — only updates step metadata."""
    traveler = db.query(Traveler).filter(Traveler.id == traveler_id).first()
    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Traveler not found"
        )

    # Determine labor hours based on traveler type
    include_labor_hours = traveler_data.include_labor_hours if traveler_data.traveler_type != "PCB" else False

    # Update traveler fields
    traveler.job_number = traveler_data.job_number
    traveler.work_order_number = traveler_data.work_order_number
    traveler.po_number = traveler_data.po_number
    traveler.traveler_type = traveler_data.traveler_type
    traveler.part_number = traveler_data.part_number
    traveler.part_description = traveler_data.part_description
    traveler.revision = traveler_data.revision
    traveler.customer_revision = traveler_data.customer_revision
    traveler.quantity = resolve_traveler_quantity(
        traveler_data, traveler_data.rma_units, current=traveler.quantity
    )
    traveler.customer_code = traveler_data.customer_code
    traveler.customer_name = traveler_data.customer_name
    traveler.priority = traveler_data.priority
    traveler.work_center = traveler_data.work_center
    traveler.notes = traveler_data.notes
    traveler.specs = traveler_data.specs
    traveler.specs_date = traveler_data.specs_date
    traveler.from_stock = traveler_data.from_stock
    traveler.to_stock = traveler_data.to_stock
    traveler.ship_via = traveler_data.ship_via
    traveler.comments = traveler_data.comments
    if traveler_data.start_date:
        traveler.start_date = traveler_data.start_date
    traveler.due_date = traveler_data.due_date
    traveler.ship_date = traveler_data.ship_date
    traveler.include_labor_hours = include_labor_hours
    if traveler_data.status:
        traveler.status = traveler_data.status
    if traveler_data.is_active is not None:
        traveler.is_active = traveler_data.is_active
    # Persist the RMA number (distinct from job number) on edit
    traveler.rma_number = traveler_data.rma_number
    # The rest of the RMA header used to be write-once: create stored it, but
    # update never assigned it, so editing "Quantity RMA issued for" (or any
    # other header field) and hitting Save silently discarded the new value and
    # the old one reappeared on reload. Assign the whole block for RMA types so
    # edits — including clearing a field — actually stick.
    incoming_type = getattr(traveler_data.traveler_type, "value", traveler_data.traveler_type)
    if incoming_type in RMA_TRAVELER_TYPES:
        traveler.customer_contact = traveler_data.customer_contact
        traveler.original_wo_number = traveler_data.original_wo_number
        traveler.original_po_number = traveler_data.original_po_number
        traveler.return_po_number = traveler_data.return_po_number
        traveler.rma_po_number = traveler_data.rma_po_number
        traveler.invoice_number = traveler_data.invoice_number
        traveler.customer_ncr = traveler_data.customer_ncr
        traveler.original_built_quantity = traveler_data.original_built_quantity
        traveler.units_shipped = traveler_data.units_shipped
        traveler.quantity_rma_issued = traveler_data.quantity_rma_issued
        traveler.units_received = traveler_data.units_received
        traveler.customer_revision_sent = traveler_data.customer_revision_sent
        traveler.customer_revision_received = traveler_data.customer_revision_received
        traveler.rma_notes = traveler_data.rma_notes
    # Persist the operator-selected WO type label (RMA / Modification / Rework / …)
    if traveler_data.wo_type_label is not None:
        traveler.wo_type_label = traveler_data.wo_type_label
    # Persist the user-customized column layout for the Unit Serial Number table
    if traveler_data.rma_table_columns is not None:
        traveler.rma_table_columns = traveler_data.rma_table_columns

    # Replace rma_units in bulk (units have no labor entries, so safe to delete/recreate).
    # Lets edits, additions, deletions, and per-unit custom_values all persist.
    db.query(RmaUnitTracking).filter(RmaUnitTracking.traveler_id == traveler.id).delete(synchronize_session=False)
    for rma_unit_data in traveler_data.rma_units:
        db.add(RmaUnitTracking(
            traveler_id=traveler.id,
            unit_number=rma_unit_data.unit_number,
            serial_number=rma_unit_data.serial_number,
            customer_complaint=rma_unit_data.customer_complaint,
            incoming_inspection_notes=rma_unit_data.incoming_inspection_notes,
            disposition=rma_unit_data.disposition,
            troubleshooting_notes=rma_unit_data.troubleshooting_notes,
            repairing_notes=rma_unit_data.repairing_notes,
            final_inspection_notes=rma_unit_data.final_inspection_notes,
            customer_ncr=rma_unit_data.customer_ncr,
            original_po_number=rma_unit_data.original_po_number,
            original_wo_number=rma_unit_data.original_wo_number,
            customer_revision_sent=rma_unit_data.customer_revision_sent,
            customer_revision_received=rma_unit_data.customer_revision_received,
            original_built_quantity=rma_unit_data.original_built_quantity,
            units_shipped=rma_unit_data.units_shipped,
            custom_values=rma_unit_data.custom_values,
        ))

    # ── SAFE step update: preserve labor entries ──
    # Build a map of existing steps by (step_number, operation) for matching
    existing_steps = db.query(ProcessStep).filter(ProcessStep.traveler_id == traveler.id).all()
    existing_map = {}
    for s in existing_steps:
        key = (s.step_number, (s.operation or "").upper().strip())
        existing_map[key] = s

    # Track which existing step IDs we keep
    kept_step_ids = set()
    new_step_order = []

    for step_data in traveler_data.process_steps:
        key = (step_data.step_number, (step_data.operation or "").upper().strip())
        existing = existing_map.get(key)

        if existing:
            # Update existing step in-place (preserves its ID → preserves labor entries)
            existing.operation = step_data.operation
            existing.work_center_code = step_data.work_center_code
            existing.instructions = step_data.instructions
            existing.estimated_time = step_data.estimated_time
            existing.is_required = step_data.is_required
            existing.quantity = step_data.quantity
            existing.accepted = step_data.accepted
            existing.rejected = step_data.rejected
            existing.sign = step_data.sign
            existing.completed_date = step_data.completed_date
            existing.completed_time = step_data.completed_time
            kept_step_ids.add(existing.id)
            new_step_order.append(existing)
        else:
            # Auto-create work center if needed
            work_center = db.query(WorkCenter).filter(WorkCenter.code == step_data.work_center_code).first()
            if not work_center:
                work_center = WorkCenter(
                    code=step_data.work_center_code,
                    name=step_data.operation,
                    description="Auto-created from traveler",
                    is_active=True
                )
                db.add(work_center)
                db.flush()

            db_step = ProcessStep(
                traveler_id=traveler.id,
                step_number=step_data.step_number,
                operation=step_data.operation,
                work_center_code=step_data.work_center_code,
                instructions=step_data.instructions,
                estimated_time=step_data.estimated_time,
                is_required=step_data.is_required,
                quantity=step_data.quantity,
                accepted=step_data.accepted,
                rejected=step_data.rejected,
                sign=step_data.sign,
                completed_date=step_data.completed_date,
                completed_time=step_data.completed_time
            )
            db.add(db_step)
            db.flush()
            db.refresh(db_step)
            kept_step_ids.add(db_step.id)
            new_step_order.append(db_step)

            # Create sub-steps for new steps only
            for sub_step_data in step_data.sub_steps:
                db.add(SubStep(
                    process_step_id=db_step.id,
                    step_number=sub_step_data.step_number,
                    description=sub_step_data.description
                ))

    # Only delete steps that are no longer in the new list AND have no labor entries
    for old_step in existing_steps:
        if old_step.id not in kept_step_ids:
            has_labor = db.query(LaborEntry).filter(LaborEntry.step_id == old_step.id).count() > 0
            if has_labor:
                # Keep the step (hidden) — don't delete labor data
                # Reassign labor entries to traveler level (step_id NULL) to preserve them
                db.query(LaborEntry).filter(LaborEntry.step_id == old_step.id).update(
                    {LaborEntry.step_id: None}, synchronize_session=False
                )
                db.query(SubStep).filter(SubStep.process_step_id == old_step.id).delete(synchronize_session=False)
                db.delete(old_step)
            else:
                db.query(SubStep).filter(SubStep.process_step_id == old_step.id).delete(synchronize_session=False)
                db.delete(old_step)

    # Handle manual steps — delete old, create new
    db.query(ManualStep).filter(ManualStep.traveler_id == traveler.id).delete()
    for manual_step_data in traveler_data.manual_steps:
        db.add(ManualStep(
            traveler_id=traveler.id,
            description=manual_step_data.description,
            added_by=current_user.id
        ))

    db.commit()
    db.refresh(traveler)

    # Create audit log with actual user
    audit_log = AuditLog(
        traveler_id=traveler.id,
        user_id=current_user.id,
        action="UPDATED",
        ip_address="127.0.0.1",
        user_agent="NEXUS-Frontend"
    )
    db.add(audit_log)
    db.commit()

    # Create notification for all admins with actual username
    create_notification_for_admins(
        db=db,
        notification_type=NotificationType.TRAVELER_UPDATED,
        title="Traveler Updated",
        message=f"{current_user.username} updated traveler {traveler.job_number} - {traveler.part_description}",
        reference_id=traveler.id,
        reference_type="traveler",
        created_by_username=current_user.username
    )

    return traveler

@router.patch("/{traveler_id}")
async def patch_traveler(
    traveler_id: int,
    updates: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Partially update a traveler (e.g., toggle active status)"""
    traveler = db.query(Traveler).filter(Traveler.id == traveler_id).first()
    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Traveler not found"
        )

    # Log the update for debugging
    print(f"PATCH traveler {traveler_id}: {updates}")

    # If archiving, save the current status first
    if updates.get('status') == 'ARCHIVED' and traveler.status.value != 'ARCHIVED':
        traveler.previous_status = traveler.status.value
        print(f"Saving previous_status: {traveler.previous_status}")

    # If restoring from archive and no explicit status given, use previous_status
    if updates.get('status') and updates['status'] != 'ARCHIVED' and traveler.status.value == 'ARCHIVED':
        if traveler.previous_status and updates['status'] == 'CREATED':
            # Restore to the original status instead of hardcoded CREATED
            updates['status'] = traveler.previous_status
            print(f"Restoring to previous_status: {traveler.previous_status}")

    # DRAFT → CREATED (Awaiting Start): allocate a WO if one isn't already set.
    # Clones reach this branch: they are saved as DRAFT with no WO, and the WO
    # is burned only when an operator promotes the traveler to Awaiting Start.
    # If the user has manually typed a WO in the form we honor it.
    if (
        updates.get('status') == 'CREATED'
        and traveler.status.value == 'DRAFT'
        and not (updates.get('work_order_number') or traveler.work_order_number)
    ):
        import re as _wo_re
        existing = db.query(Traveler.work_order_number).filter(
            Traveler.work_order_number.isnot(None),
            Traveler.work_order_number != '',
            Traveler.status != 'DRAFT',
        ).all()
        max_prefix = 26014
        for (wo,) in existing:
            m = _wo_re.match(r'^(\d{5})', str(wo or ''))
            if m:
                n = int(m.group(1))
                if n > max_prefix:
                    max_prefix = n
        allocated = str(max_prefix + 1).zfill(5)
        updates['work_order_number'] = allocated
        print(f"Allocated WO {allocated} on DRAFT → CREATED transition for traveler {traveler_id}")

    # WO uniqueness is enforced by partial unique index uq_traveler_work_order_number.
    # Catch the collision up-front so the user gets a 409 with a specific message
    # instead of a generic 500 from IntegrityError at commit time.
    prospective_wo = updates.get('work_order_number')
    if prospective_wo:
        dup = db.query(Traveler.id).filter(
            Traveler.work_order_number == prospective_wo,
            Traveler.id != traveler_id,
        ).first()
        if dup:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Work order number '{prospective_wo}' is already assigned to another traveler."
            )

    # System-managed / immutable fields can never be set via PATCH — otherwise a
    # client could rewrite ownership and audit timestamps or move a traveler
    # between groups by sending arbitrary keys. completed_at is derived from
    # status transitions, not patched directly.
    PROTECTED_FIELDS = {
        'id', 'created_by', 'created_at', 'updated_at', 'completed_at',
        'group_id', 'group_sequence', 'previous_status',
    }

    # Update only the provided fields
    for key, value in updates.items():
        if key in PROTECTED_FIELDS:
            print(f"Ignoring protected field in PATCH: {key}")
            continue
        if hasattr(traveler, key):
            print(f"Setting {key} = {value} (was {getattr(traveler, key)})")
            # Convert status string to enum
            if key == 'status' and isinstance(value, str):
                try:
                    value = TravelerStatus(value)
                except ValueError:
                    raise HTTPException(status_code=400, detail=f"Invalid status: {value}")
            setattr(traveler, key, value)

    db.commit()
    db.refresh(traveler)

    # Verify the update persisted
    print(f"After commit - is_active: {traveler.is_active}")

    return {
        "message": "Traveler updated successfully",
        "traveler": {
            "id": traveler.id,
            "job_number": traveler.job_number,
            "is_active": traveler.is_active,
            "status": traveler.status.value if traveler.status else None,
            "work_order_number": traveler.work_order_number,
        }
    }

@router.delete("/{traveler_id}")
async def delete_traveler(
    traveler_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a traveler (admin only)"""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can delete travelers"
        )

    traveler = db.query(Traveler).filter(Traveler.id == traveler_id).first()
    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Traveler not found"
        )

    # Store traveler info for notification before deletion
    job_number = traveler.job_number
    part_description = traveler.part_description

    # Get user for notification. The "system" placeholder must never be a
    # loginable account, so it is created inactive with a random, unusable
    # password (previously it used a hardcoded bcrypt hash and was a loginable
    # OPERATOR).
    default_user = db.query(User).filter(User.username == "system").first()
    if not default_user:
        import secrets
        default_user = User(
            username="system",
            email="system@nexus.local",
            first_name="System",
            last_name="User",
            hashed_password=get_password_hash(secrets.token_urlsafe(48)),
            role=UserRole.OPERATOR,
            is_approver=False,
            is_active=False,
        )
        db.add(default_user)
        db.commit()
        db.refresh(default_user)

    # Delete related records first. ORDER MATTERS: several child FKs are
    # ON DELETE NO ACTION, so anything pointing at process_steps.id
    # (labor_entries.step_id, sub_steps.process_step_id,
    # kitting_timer_sessions.step_id) has to go BEFORE the process steps
    # themselves. Deleting process_steps first raised an IntegrityError that the
    # global handler turned into a 409 — which made every traveler with logged
    # labor undeletable (181 of 199 at the time this was fixed).
    from models import (
        LaborEntry, Approval, StepScanEvent, KittingTimerSession,
        KittingEventLog, JobDocument, CommunicationLog, QualityCheckItem,
    )

    step_ids = [
        row[0] for row in
        db.query(ProcessStep.id).filter(ProcessStep.traveler_id == traveler.id).all()
    ]

    # 1. Grandchildren of process_steps (must precede the steps).
    if step_ids:
        db.query(SubStep).filter(SubStep.process_step_id.in_(step_ids)).delete(synchronize_session=False)
        db.query(QualityCheckItem).filter(QualityCheckItem.step_id.in_(step_ids)).delete(synchronize_session=False)

    # 2. Direct children that also reference a step. kitting_event_logs first —
    #    its session_id FK is SET NULL, but deleting the logs outright is what we
    #    want. pause_logs cascade off labor_entries automatically.
    db.query(KittingEventLog).filter(KittingEventLog.traveler_id == traveler.id).delete(synchronize_session=False)
    db.query(KittingTimerSession).filter(KittingTimerSession.traveler_id == traveler.id).delete(synchronize_session=False)
    db.query(LaborEntry).filter(LaborEntry.traveler_id == traveler.id).delete(synchronize_session=False)
    db.query(StepScanEvent).filter(StepScanEvent.traveler_id == traveler.id).delete(synchronize_session=False)

    # 2b. Real data holds a few labor/kitting rows that belong to ANOTHER
    #     traveler yet point at this one's steps (travelers 96-99 vs 98/100/102 —
    #     most likely a clone or a mis-scan). Those rows must survive the delete
    #     with their hours intact, so just drop the dangling step link instead.
    if step_ids:
        db.query(LaborEntry).filter(
            LaborEntry.step_id.in_(step_ids),
            LaborEntry.traveler_id != traveler.id,
        ).update({LaborEntry.step_id: None}, synchronize_session=False)
        db.query(KittingTimerSession).filter(
            KittingTimerSession.step_id.in_(step_ids),
            KittingTimerSession.traveler_id != traveler.id,
        ).update({KittingTimerSession.step_id: None}, synchronize_session=False)

    # 3. Legacy table with no ORM model but a live NO ACTION FK on travelers.id.
    #    Guarded because environments built purely from models.py lack it.
    from sqlalchemy import inspect as sa_inspect, text as sa_text
    if sa_inspect(db.bind).has_table("traveler_time_entries"):
        db.execute(
            sa_text("DELETE FROM traveler_time_entries WHERE traveler_id = :tid"),
            {"tid": traveler.id},
        )

    # 4. Now the steps, then the remaining direct children.
    db.query(ProcessStep).filter(ProcessStep.traveler_id == traveler.id).delete(synchronize_session=False)
    db.query(ManualStep).filter(ManualStep.traveler_id == traveler.id).delete(synchronize_session=False)
    db.query(AuditLog).filter(AuditLog.traveler_id == traveler.id).delete(synchronize_session=False)
    db.query(TravelerTrackingLog).filter(TravelerTrackingLog.traveler_id == traveler.id).delete(synchronize_session=False)
    db.query(Approval).filter(Approval.traveler_id == traveler.id).delete(synchronize_session=False)
    db.query(JobDocument).filter(JobDocument.traveler_id == traveler.id).delete(synchronize_session=False)
    db.query(CommunicationLog).filter(CommunicationLog.traveler_id == traveler.id).delete(synchronize_session=False)
    db.query(RmaUnitTracking).filter(RmaUnitTracking.traveler_id == traveler.id).delete(synchronize_session=False)

    db.delete(traveler)
    db.commit()

    # Create notification for all admins
    create_notification_for_admins(
        db=db,
        notification_type=NotificationType.TRAVELER_DELETED,
        title="Traveler Deleted",
        message=f"{default_user.username} deleted traveler {job_number} - {part_description}",
        reference_id=traveler_id,
        reference_type="traveler",
        created_by_username=default_user.username
    )

    return {"message": "Traveler deleted successfully"}

@router.post("/scan", response_model=TrackingScanResponse)
async def scan_tracking_code(
    scan_data: TrackingScanRequest,
    db: Session = Depends(get_db)
):
    """Record a barcode/QR code scan for traveler tracking"""

    # Validate scan type
    if scan_data.scan_type not in ["HEADER", "WORK_CENTER"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="scan_type must be 'HEADER' or 'WORK_CENTER'"
        )

    # For WORK_CENTER scans, work_center is required
    if scan_data.scan_type == "WORK_CENTER" and not scan_data.work_center:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="work_center is required for WORK_CENTER scan type"
        )

    # Find the traveler by job number
    traveler = db.query(Traveler).filter(Traveler.job_number == scan_data.job_number).first()
    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Traveler with job number {scan_data.job_number} not found"
        )

    # Create tracking log entry
    tracking_log = TravelerTrackingLog(
        traveler_id=traveler.id,
        job_number=scan_data.job_number,
        work_center=scan_data.work_center,
        step_sequence=scan_data.step_sequence,
        scan_type=scan_data.scan_type,
        scanned_by=scan_data.scanned_by,
        notes=scan_data.notes
    )

    db.add(tracking_log)
    db.commit()
    db.refresh(tracking_log)

    return TrackingScanResponse(
        success=True,
        message=f"Scan recorded successfully for {scan_data.scan_type}",
        log_id=tracking_log.id,
        traveler_id=traveler.id
    )

@router.get("/tracking/logs", response_model=List[TrackingLogResponse])
async def get_tracking_logs(
    job_number: str = None,
    traveler_id: int = None,
    work_center: str = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get tracking logs with optional filters"""
    query = db.query(TravelerTrackingLog)

    if job_number:
        query = query.filter(TravelerTrackingLog.job_number == job_number)
    if traveler_id:
        query = query.filter(TravelerTrackingLog.traveler_id == traveler_id)
    if work_center:
        query = query.filter(TravelerTrackingLog.work_center == work_center)

    logs = query.order_by(TravelerTrackingLog.scanned_at.desc()).offset(skip).limit(limit).all()
    return logs

@router.get("/tracking/current-location/{job_number}")
async def get_current_location(
    job_number: str,
    db: Session = Depends(get_db)
):
    """Get the current location (last scanned work center) of a traveler"""

    # Find the traveler
    traveler = db.query(Traveler).filter(Traveler.job_number == job_number).first()
    if not traveler:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Traveler with job number {job_number} not found"
        )

    # Get the most recent WORK_CENTER scan
    last_scan = db.query(TravelerTrackingLog).filter(
        TravelerTrackingLog.traveler_id == traveler.id,
        TravelerTrackingLog.scan_type == "WORK_CENTER"
    ).order_by(TravelerTrackingLog.scanned_at.desc()).first()

    if not last_scan:
        return {
            "job_number": job_number,
            "traveler_id": traveler.id,
            "current_location": None,
            "last_scan_time": None,
            "message": "No work center scans recorded yet"
        }

    return {
        "job_number": job_number,
        "traveler_id": traveler.id,
        "current_location": last_scan.work_center,
        "step_sequence": last_scan.step_sequence,
        "last_scan_time": last_scan.scanned_at,
        "scanned_by": last_scan.scanned_by
    }