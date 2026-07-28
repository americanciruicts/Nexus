from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, ForeignKey, Float, Enum, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func, text
from database import Base
import enum

class UserRole(enum.Enum):
    ADMIN = "ADMIN"
    OPERATOR = "OPERATOR"

class TravelerType(enum.Enum):
    PCB = "PCB"
    PCB_ASSEMBLY = "PCB_ASSEMBLY"
    ASSY = "ASSY"  # Legacy alias
    CABLE = "CABLE"
    CABLES = "CABLES"  # Legacy alias
    PURCHASING = "PURCHASING"
    RMA_SAME = "RMA_SAME"  # RMA Router - Same Job/Rev, PO & WO
    RMA_DIFF = "RMA_DIFF"  # RMA Router - Different Jobs/Rev, PO & WO
    MODIFICATION = "MODIFICATION"  # Modification RMA

class TravelerStatus(enum.Enum):
    DRAFT = "DRAFT"
    CREATED = "CREATED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    ON_HOLD = "ON_HOLD"
    CANCELLED = "CANCELLED"
    ARCHIVED = "ARCHIVED"

class Priority(enum.Enum):
    LOW = "LOW"
    NORMAL = "NORMAL"
    PREMIUM = "PREMIUM"
    HIGH = "HIGH"
    URGENT = "URGENT"

class ApprovalStatus(enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    first_name = Column(String(50), nullable=False)
    last_name = Column(String(50), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.OPERATOR)
    is_approver = Column(Boolean, default=False)
    is_itar = Column(Boolean, default=False)  # ITAR access - can view travelers with 'M' in job number
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    created_travelers = relationship("Traveler", back_populates="creator")
    labor_entries = relationship("LaborEntry", back_populates="employee")
    audit_logs = relationship("AuditLog", back_populates="user")

class WorkCenter(Base):
    __tablename__ = "work_centers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    code = Column(String(100), unique=True, nullable=False)
    description = Column(Text)
    traveler_type = Column(String(20), nullable=True)  # PCB_ASSEMBLY, PCB, CABLE, PURCHASING
    category = Column(String(100), nullable=True)  # e.g. SMT hrs. Actual, HAND hrs. Actual
    department = Column(String(100), nullable=True)  # e.g. SMT, Soldering, TH, Quality, Shipping
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    process_steps = relationship("ProcessStep", back_populates="work_center")


class WorkCenterAuditLog(Base):
    """Immutable audit trail for all work-center create/update/delete/reorder
    actions. Created because the generic AuditLog table requires a traveler_id
    and work centers aren't scoped to a single traveler."""
    __tablename__ = "work_center_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String(20), nullable=False)  # CREATED / UPDATED / DELETED / REORDERED
    work_center_id = Column(Integer, nullable=True)  # nullable so deletes can still log
    work_center_name = Column(String(100))
    work_center_code = Column(String(100))
    traveler_type = Column(String(20))
    field_changed = Column(String(50))  # single field, or '*' for full create/delete
    old_value = Column(Text)
    new_value = Column(Text)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    ip_address = Column(String(45))
    user_agent = Column(String(500))

    user = relationship("User")


class Part(Base):
    __tablename__ = "parts"

    id = Column(Integer, primary_key=True, index=True)
    part_number = Column(String(50), nullable=False, index=True)
    description = Column(String(200), nullable=False)
    revision = Column(String(20), nullable=False)
    work_center_code = Column(String(100), nullable=False)
    customer_code = Column(String(20))
    customer_name = Column(String(100))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    travelers = relationship("Traveler", back_populates="part")

class TravelerGroup(Base):
    __tablename__ = "traveler_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    travelers = relationship("Traveler", back_populates="group", order_by="Traveler.group_sequence")

class Traveler(Base):
    __tablename__ = "travelers"
    __table_args__ = (
        # NOTE: there is intentionally NO unique constraint on (job_number,
        # revision). Multiple travelers may share the same job/rev as long as
        # they carry different Work Order / PO numbers — this is a normal
        # workflow (see create_traveler's duplicate check, which is NULL-aware
        # on work_order_number/po_number). A hard uq_traveler_job_revision
        # constraint contradicted that workflow and surfaced as opaque 500s on
        # commit; it is dropped at startup (see main.py auto-migration).
        # Partial unique index: two travelers can't share a WO number, but many
        # rows may still carry NULL/empty WO (Draft status hasn't generated one
        # yet). Enforced DB-side so a race between auto-gen and manual entry
        # cannot produce duplicates silently.
        Index(
            'uq_traveler_work_order_number',
            'work_order_number',
            unique=True,
            postgresql_where=text("work_order_number IS NOT NULL AND work_order_number <> ''"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    job_number = Column(String(50), nullable=False, index=True)
    work_order_number = Column(String(50), index=True)
    po_number = Column(String(255))
    traveler_type = Column(Enum(TravelerType), nullable=False)
    part_number = Column(String(50), nullable=False)
    part_description = Column(String(200), nullable=False)
    revision = Column(String(20), nullable=False)
    customer_revision = Column(String(50))  # Customer revision
    quantity = Column(Integer, nullable=False)
    customer_code = Column(String(20))
    customer_name = Column(String(100))
    priority = Column(Enum(Priority), default=Priority.NORMAL)
    work_center = Column(String(20), nullable=False)
    status = Column(Enum(TravelerStatus), default=TravelerStatus.CREATED)
    previous_status = Column(String(20))  # Status before archiving, for restore
    is_active = Column(Boolean, default=True)  # Whether traveler is active in production
    notes = Column(Text)
    specs = Column(Text)  # Specifications
    specs_date = Column(String(20))  # Specifications date
    from_stock = Column(String(100))  # From Stock location
    to_stock = Column(String(100))  # To Stock location
    ship_via = Column(String(100))  # Shipping method
    comments = Column(Text)  # Comments section
    start_date = Column(String(20))  # Start date (user-entered)
    due_date = Column(String(20))  # Due date
    ship_date = Column(String(20))  # Ship date
    include_labor_hours = Column(Boolean, default=False)  # Whether to include labor hours table
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    completed_at = Column(DateTime(timezone=True))

    # RMA-specific fields
    rma_number = Column(String(50))  # RMA number, distinct from job_number (e.g. "1234")
    customer_contact = Column(String(100))  # Customer contact person
    original_wo_number = Column(String(50))  # Original Work Order Number
    original_po_number = Column(String(255))  # Original PO Number
    return_po_number = Column(String(255))  # Return PO Number
    rma_po_number = Column(String(255))  # RMA PO Number
    invoice_number = Column(String(100))  # Invoice Number
    customer_ncr = Column(String(100))  # Customer NCR#
    original_built_quantity = Column(Integer)  # Original Built Quantity
    units_shipped = Column(Integer)  # Number of units shipped
    quantity_rma_issued = Column(Integer)  # Quantity RMA issued for
    units_received = Column(Integer)  # Units Received
    customer_revision_sent = Column(String(50))  # Customer Revision sent
    customer_revision_received = Column(String(50))  # Customer Revision Received
    rma_notes = Column(Text)  # Notes/Comments section for RMA
    # Display label shown before the work-order number on RMA routing headers
    # ("RMA", "Modification", "Rework", etc.). Operator-selectable per traveler.
    wo_type_label = Column(String(50))
    # JSON array of column definitions for the Unit Serial Number Tracking table.
    # Null means use the default 7-column layout. Each entry: {key, label, type}
    # where type is "standard" (backed by a RmaUnitTracking field) or "custom"
    # (stored in RmaUnitTracking.custom_values JSON).
    rma_table_columns = Column(Text)

    # Group linking fields
    group_id = Column(Integer, ForeignKey("traveler_groups.id"), nullable=True)
    group_sequence = Column(Integer, nullable=True)
    group_label = Column(String(50), nullable=True)

    # Foreign keys
    part_id = Column(Integer, ForeignKey("parts.id"))

    # Relationships
    creator = relationship("User", back_populates="created_travelers")
    part = relationship("Part", back_populates="travelers")
    group = relationship("TravelerGroup", back_populates="travelers")
    process_steps = relationship("ProcessStep", back_populates="traveler")
    manual_steps = relationship("ManualStep", back_populates="traveler")
    labor_entries = relationship("LaborEntry", back_populates="traveler")
    approvals = relationship("Approval", back_populates="traveler")
    audit_logs = relationship("AuditLog", back_populates="traveler")
    # Units are rewritten in bulk on every save, so their physical row order
    # drifts from the No. column (a traveler edited in two passes came back
    # 17-23, then 1-16, then 24-29). Always hand them back in unit order.
    rma_units = relationship(
        "RmaUnitTracking",
        back_populates="traveler",
        cascade="all, delete-orphan",
        order_by="(RmaUnitTracking.unit_number, RmaUnitTracking.id)",
    )

class ProcessStep(Base):
    __tablename__ = "process_steps"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"), nullable=False)
    step_number = Column(Integer, nullable=False)
    operation = Column(String(100), nullable=False)
    work_center_code = Column(String(100), ForeignKey("work_centers.code"), nullable=False)
    instructions = Column(Text, nullable=False)
    quantity = Column(Integer)  # Quantity for this step
    accepted = Column(Integer)  # Accepted quantity
    rejected = Column(Integer)  # Rejected quantity
    sign = Column(String(50))  # Signature/initials
    completed_date = Column(String(20))  # Completion date
    completed_time = Column(String(20))  # Manually-entered time/hours for this step
    estimated_time = Column(Integer)  # in minutes
    is_required = Column(Boolean, default=True)
    is_completed = Column(Boolean, default=False)
    completed_by = Column(Integer, ForeignKey("users.id"))
    completed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    traveler = relationship("Traveler", back_populates="process_steps")
    work_center = relationship("WorkCenter", back_populates="process_steps")
    sub_steps = relationship("SubStep", back_populates="process_step")

class SubStep(Base):
    __tablename__ = "sub_steps"

    id = Column(Integer, primary_key=True, index=True)
    process_step_id = Column(Integer, ForeignKey("process_steps.id"), nullable=False)
    step_number = Column(String(10), nullable=False)  # e.g., "1.1", "1.2"
    description = Column(Text, nullable=False)
    is_completed = Column(Boolean, default=False)
    completed_by = Column(Integer, ForeignKey("users.id"))
    completed_at = Column(DateTime(timezone=True))
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    process_step = relationship("ProcessStep", back_populates="sub_steps")

class ManualStep(Base):
    __tablename__ = "manual_steps"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"), nullable=False)
    description = Column(Text, nullable=False)
    added_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    added_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    traveler = relationship("Traveler", back_populates="manual_steps")

class RmaUnitTracking(Base):
    """Tracks individual RMA units/serial numbers with their inspection/repair status.
    Maps to the serial number tracking table in the RMA Router Word templates."""
    __tablename__ = "rma_unit_tracking"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id", ondelete="CASCADE"), nullable=False)
    unit_number = Column(Integer, nullable=False)  # Row number (No.)
    serial_number = Column(String(100))  # Unit Serial Number
    customer_complaint = Column(Text)  # Customer Complaint
    incoming_inspection_notes = Column(Text)  # Incoming Inspection Result/Note
    disposition = Column(Text)  # Disposition of unit
    troubleshooting_notes = Column(Text)  # Troubleshooting/Testing notes
    repairing_notes = Column(Text)  # Repairing notes
    final_inspection_notes = Column(Text)  # Final Inspection Notes
    # Additional fields for RMA_DIFF type (per-unit original job info)
    customer_ncr = Column(String(100))  # Customer NCR (per unit, for diff jobs)
    original_po_number = Column(String(255))  # Original PO Number (per unit)
    original_wo_number = Column(String(50))  # Original WO Number (per unit)
    customer_revision_sent = Column(String(50))  # Customer Revision sent (per unit)
    customer_revision_received = Column(String(50))  # Customer Revision Received (per unit)
    original_built_quantity = Column(Integer)  # Original Built Quantity (per unit)
    units_shipped = Column(Integer)  # Number of units shipped (per unit)
    # JSON dict of values for user-added custom columns: {custom_key: value}
    custom_values = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    traveler = relationship("Traveler", back_populates="rma_units")


class LaborEntry(Base):
    __tablename__ = "labor_entries"
    __table_args__ = (
        # An employee may have at most one OPEN labor entry (a running timer:
        # end_time IS NULL and not completed). Enforced DB-side so a race
        # between two concurrent start requests (double-tap / two tabs) cannot
        # create two open timers. The app-level pre-check in start_labor_entry
        # still gives a friendly message in the common case; this index is the
        # backstop. Created at startup (see main.py auto-migration).
        Index(
            'uq_one_open_labor_entry_per_employee',
            'employee_id',
            unique=True,
            postgresql_where=text("end_time IS NULL AND is_completed = false"),
            sqlite_where=text("end_time IS NULL AND is_completed = 0"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"), nullable=False)
    step_id = Column(Integer, ForeignKey("process_steps.id"))
    work_center = Column(String(100))  # Work center name
    sequence_number = Column(Integer)  # Sequence number from process step
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    start_time = Column(DateTime(timezone=True), nullable=False)
    pause_time = Column(DateTime(timezone=True))  # Time when paused
    end_time = Column(DateTime(timezone=True))
    hours_worked = Column(Float, default=0.0)
    description = Column(Text)
    is_completed = Column(Boolean, default=False)
    qty_completed = Column(Integer, nullable=True)  # Quantity completed during this labor entry
    comment = Column(Text, nullable=True)  # Optional operator/admin comment
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    traveler = relationship("Traveler", back_populates="labor_entries")
    employee = relationship("User", back_populates="labor_entries")
    pause_logs = relationship("PauseLog", back_populates="labor_entry", cascade="all, delete-orphan", order_by="PauseLog.paused_at")

class PauseLog(Base):
    __tablename__ = "pause_logs"

    id = Column(Integer, primary_key=True, index=True)
    labor_entry_id = Column(Integer, ForeignKey("labor_entries.id", ondelete="CASCADE"), nullable=False)
    paused_at = Column(DateTime(timezone=True), nullable=False)
    resumed_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Float, nullable=True)  # Calculated on resume
    comment = Column(Text, nullable=True)
    reason = Column(String(32), nullable=True, default="BREAK")  # BREAK | WAITING_PARTS

    labor_entry = relationship("LaborEntry", back_populates="pause_logs")


# ─────────────────────────────────────────────────────────────────────
# Phase A: Dedicated Kitting Timer subsystem
#
# Lives ALONGSIDE labor_entries (does not replace it). Each row in
# kitting_timer_sessions is one continuous interval of either ACTIVE
# (operator kitting) or WAITING_PARTS (paused for parts) state. A
# session has end_time IS NULL if it is currently open.
# kitting_event_logs is the audit timeline for each transition.
# ─────────────────────────────────────────────────────────────────────


class KittingTimerSession(Base):
    __tablename__ = "kitting_timer_sessions"
    __table_args__ = (
        # At most one OPEN session (end_time IS NULL) per traveler. The state
        # machine closes the current session before opening the next within a
        # single transaction, so normal start/pause/resume transitions never
        # violate this. It blocks the race where two concurrent start/resume
        # calls both open a session. Created at startup (see main.py).
        Index(
            'uq_one_open_kitting_session_per_traveler',
            'traveler_id',
            unique=True,
            postgresql_where=text("end_time IS NULL"),
            sqlite_where=text("end_time IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id", ondelete="CASCADE"), nullable=False, index=True)
    step_id = Column(Integer, ForeignKey("process_steps.id"), nullable=True)
    employee_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    session_type = Column(String(20), nullable=False)  # 'ACTIVE' | 'WAITING_PARTS'
    start_time = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    end_time = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Float, nullable=True)  # populated on close
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class KittingEventLog(Base):
    __tablename__ = "kitting_event_logs"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(Integer, ForeignKey("kitting_timer_sessions.id", ondelete="SET NULL"), nullable=True)
    event_type = Column(String(32), nullable=False)
    # event_type values:
    #   TIMER_STARTED, TIMER_PAUSED_WAITING, TIMER_RESUMED,
    #   TIMER_STOPPED, PARTS_RECEIVED, MANUAL_OVERRIDE
    source = Column(String(20), nullable=False, default="user")  # 'user' | 'kosh' | 'system'
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    payload = Column(Text, nullable=True)  # optional JSON-as-text for extra context
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

class Approval(Base):
    __tablename__ = "approvals"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"), nullable=False)
    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    requested_at = Column(DateTime(timezone=True), server_default=func.now())
    status = Column(Enum(ApprovalStatus), default=ApprovalStatus.PENDING)
    approved_by = Column(Integer, ForeignKey("users.id"))
    approved_at = Column(DateTime(timezone=True))
    rejected_by = Column(Integer, ForeignKey("users.id"))
    rejected_at = Column(DateTime(timezone=True))
    rejection_reason = Column(Text)
    request_type = Column(String(20), nullable=False)  # 'EDIT', 'COMPLETE', 'CANCEL'
    request_details = Column(Text, nullable=False)

    # Relationships
    traveler = relationship("Traveler", back_populates="approvals")

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String(20), nullable=False)  # 'CREATED', 'UPDATED', 'COMPLETED', etc.
    field_changed = Column(String(50))
    old_value = Column(Text)
    new_value = Column(Text)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    ip_address = Column(String(45))
    user_agent = Column(String(500))

    # Relationships
    traveler = relationship("Traveler", back_populates="audit_logs")
    user = relationship("User", back_populates="audit_logs")

class TravelerTrackingLog(Base):
    __tablename__ = "traveler_tracking_logs"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"), nullable=False)
    job_number = Column(String(50), nullable=False, index=True)
    work_center = Column(String(100))
    step_sequence = Column(Integer)
    scan_type = Column(String(20), nullable=False)  # 'HEADER' or 'WORK_CENTER'
    scanned_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    scanned_by = Column(String(100))
    notes = Column(Text)


class NotificationType(enum.Enum):
    TRAVELER_CREATED = "TRAVELER_CREATED"
    TRAVELER_UPDATED = "TRAVELER_UPDATED"
    TRAVELER_DELETED = "TRAVELER_DELETED"
    LABOR_ENTRY_CREATED = "LABOR_ENTRY_CREATED"
    LABOR_ENTRY_UPDATED = "LABOR_ENTRY_UPDATED"
    LABOR_ENTRY_DELETED = "LABOR_ENTRY_DELETED"
    TRACKING_ENTRY_CREATED = "TRACKING_ENTRY_CREATED"  # Legacy - kept for existing notifications
    TRACKING_ENTRY_UPDATED = "TRACKING_ENTRY_UPDATED"  # Legacy - kept for existing notifications
    TRACKING_ENTRY_DELETED = "TRACKING_ENTRY_DELETED"  # Legacy - kept for existing notifications
    USER_LOGIN = "USER_LOGIN"
    WORK_CENTER_CREATED = "WORK_CENTER_CREATED"
    WORK_CENTER_UPDATED = "WORK_CENTER_UPDATED"
    WORK_CENTER_DELETED = "WORK_CENTER_DELETED"
    WORK_CENTER_REORDERED = "WORK_CENTER_REORDERED"

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # Admin receiving notification
    notification_type = Column(Enum(NotificationType), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    reference_id = Column(Integer)  # ID of the traveler/labor entry/tracking entry
    reference_type = Column(String(50))  # 'traveler', 'labor_entry', 'tracking_entry'
    created_by_username = Column(String(100))  # Username of person who triggered the action
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    read_at = Column(DateTime(timezone=True))

    # Relationships
    user = relationship("User")

class StepScanEvent(Base):
    __tablename__ = "step_scan_events"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id"), nullable=False)
    step_id = Column(Integer, nullable=False)  # ProcessStep or ManualStep ID
    step_type = Column(String(20), nullable=False)  # 'PROCESS' or 'MANUAL'
    job_number = Column(String(50), nullable=False, index=True)
    work_center = Column(String(100), nullable=False)
    scan_action = Column(String(20), nullable=False)  # 'SCAN_IN' or 'SCAN_OUT'
    scanned_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    scanned_by = Column(Integer, ForeignKey("users.id"))
    notes = Column(Text)

    # For calculating time spent
    duration_minutes = Column(Float)  # Calculated when scan_out happens

    # Relationships
    user = relationship("User")

# ─────────────────────────────────────────────────────────────────────
# Phase 3: Shift, Labor Rate, Documents, Quality Checklist, Comms Log
# ─────────────────────────────────────────────────────────────────────

class Shift(Base):
    """Defines a named shift (e.g. Day, Swing, Night) with start/end hours."""
    __tablename__ = "shifts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), nullable=False, unique=True)  # "Day", "Swing", "Night"
    start_hour = Column(Integer, nullable=False, default=7)   # 0-23
    end_hour = Column(Integer, nullable=False, default=15)    # 0-23 (can wrap)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class LaborRate(Base):
    """Hourly labor rate by role or department. Falls back to a default rate."""
    __tablename__ = "labor_rates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)  # e.g. "Default", "SMT Operator", "Engineering"
    rate_per_hour = Column(Float, nullable=False, default=35.0)
    department = Column(String(100), nullable=True)  # optional scoping
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class JobDocument(Base):
    """File attachment on a traveler (engineering drawings, specs, quality notes)."""
    __tablename__ = "job_documents"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(255), nullable=False)
    original_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer)  # bytes
    content_type = Column(String(100))
    category = Column(String(50), default="general")  # general, drawing, spec, quality, customer
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class QualityCheckItem(Base):
    """A single pass/fail check item in a quality checklist for a process step."""
    __tablename__ = "quality_check_items"

    id = Column(Integer, primary_key=True, index=True)
    step_id = Column(Integer, ForeignKey("process_steps.id", ondelete="CASCADE"), nullable=False, index=True)
    check_name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    is_required = Column(Boolean, default=True)
    passed = Column(Boolean, nullable=True)  # None=not checked, True=pass, False=fail
    checked_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    checked_at = Column(DateTime(timezone=True), nullable=True)
    fail_note = Column(Text, nullable=True)  # reason for failure
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CommunicationLog(Base):
    """Customer/internal communication log entry for a traveler."""
    __tablename__ = "communication_logs"

    id = Column(Integer, primary_key=True, index=True)
    traveler_id = Column(Integer, ForeignKey("travelers.id", ondelete="CASCADE"), nullable=False, index=True)
    comm_type = Column(String(30), nullable=False, default="note")  # note, email, phone, meeting
    direction = Column(String(10), default="internal")  # internal, outbound, inbound
    subject = Column(String(200), nullable=True)
    message = Column(Text, nullable=False)
    contact_name = Column(String(100), nullable=True)  # who was communicated with
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id = Column(Integer, primary_key=True, index=True)
    job_number = Column(String(50), nullable=False, index=True)
    work_order_number = Column(String(50), nullable=False, index=True)
    part_number = Column(String(50), nullable=False)
    part_description = Column(String(200), nullable=False)
    revision = Column(String(20), nullable=False)
    quantity = Column(Integer, nullable=False)
    customer_code = Column(String(20))
    customer_name = Column(String(100))
    work_center = Column(String(20), nullable=False)
    priority = Column(Enum(Priority), default=Priority.NORMAL)
    process_template = Column(Text)  # JSON string of process steps
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())