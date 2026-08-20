import os
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from contextlib import asynccontextmanager
import uvicorn
import re

from database import engine, get_db
from models import Base
from routers import travelers, users, work_orders, approvals, labor, auth, barcodes, notifications, search, dashboard, work_centers, analytics, analytics_advanced, jobs, kitting_timer, features

# Create tables
Base.metadata.create_all(bind=engine)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("NEXUS Backend starting up...")

    # Run seed data
    try:
        from seed_data.seed_travelers import seed_travelers
        print("Running seed data...")
        seed_travelers()
    except Exception as e:
        print(f"Warning: Could not run seed data: {e}")

    # Seed work centers if table is empty
    try:
        from database import SessionLocal
        from models import WorkCenter
        db = SessionLocal()
        if db.query(WorkCenter).count() == 0:
            print("Seeding work centers from static data...")
            WORK_CENTER_DATA = {
                "PCB_ASSEMBLY": [
                    ("ENGINEERING", "Reverse engineering and design"),
                    ("GENERATE CAD", "Generate CAD design files"),
                    ("VERIFY BOM", "Verify no BOM or rev changes"),
                    ("GENERATE GERBER", "Generate Gerber files for PCB fabrication"),
                    ("VERIFY GERBER", "Verify Gerber files for accuracy"),
                    ("MAKE SILKSCREEN", "Create silkscreen layer for component identification"),
                    ("CREATE BOM", "Create Bill of Materials for the assembly"),
                    ("KITTING", "Pull parts from inventory to place in a kit for manufacturing"),
                    ("COMPONENT PREP", "Pre-bending of parts or any necessary alteration of a part prior to production"),
                    ("PROGRAM PART", "Parts that need to be programmed prior to SMT"),
                    ("HAND SOLDER", "Anything that must be soldered by hand, no wave, no SMT"),
                    ("SMT PROGRAMING", "Programming the SMT placement machine"),
                    ("FEEDER LOAD", "The time it takes to load all needed parts onto feeders/Matrix trays"),
                    ("SMT SET UP", "The time it takes to align parts/make needed changes to programs"),
                    ("GLUE", "Gluing done at SMT after paste to make sure parts stay on"),
                    ("SMT TOP", "SMT top placed"),
                    ("SMT BOTTOM", "SMT bottom placed"),
                    ("WASH", "Process of cleaning a dirty PCB"),
                    ("X-RAY", "Visual continuity check of components as requested by customer"),
                    ("MANUAL INSERTION", "Install prepared parts before wave"),
                    ("WAVE", "Wave soldering process"),
                    ("WASH", "Post-wave cleaning process"),
                    ("CLEAN TEST", "Use the ion tester to check cleanliness"),
                    ("TRIM", "Cut excess leads on backside"),
                    ("PRESS FIT", "Use pressure to insert a part on the PCB"),
                    ("HAND ASSEMBLY", "Assembly of parts after wave but before inspection"),
                    ("AOI PROGRAMMING", "Programming the AOI machine"),
                    ("AOI", "Automated Optical Inspection of the PCB"),
                    ("SECONDARY ASSEMBLY", "Anything assembled after ESS testing or inspection"),
                    ("EPOXY", "Anything that needs to be glued or epoxied"),
                    ("INTERNAL TESTING", "In house test at ACI"),
                    ("LABELING", "Place a label on the board per BOM instructions"),
                    ("DEPANEL", "Break panel into individual boards"),
                    ("PRODUCT PICTURES", "Take pictures of product before shipping"),
                    ("SEND TO EXTERNAL COATING", "Operator to sign and ship to coating"),
                    ("RETURN FROM EXTERNAL COATING", "Operator to sign when received from coating"),
                    ("INTERNAL COATING", "In house coating at ACI"),
                    ("INTERNAL TESTING", "Post-coating in house test at ACI"),
                    ("SEND TO ESS", "Operator to sign and ship to ESS"),
                    ("RETURN FROM ESS", "Operator to sign when received from ESS"),
                    ("INTERNAL TESTING", "Post-ESS in house test at ACI"),
                    ("VISUAL INSPECTION", "Human visual inspection parts and coating, no AOI"),
                    ("MANUAL ASSEMBLY", "Put the assembly together by hand"),
                    ("BOX ASSEMBLY", "Mechanical build consisting of the PCBA, hardware, and/or housings"),
                    ("HARDWARE", "Adding screws, nuts, bolts, brackets, displays, etc."),
                    ("SHIPPING", "Send product to customer per packing request"),
                ],
                "PCB": [
                    ("COMPONENT PREP", "Pre-bending of parts or any necessary alteration of a part prior to production"),
                    ("EPOXY", "Anything that needs to be glued or epoxied"),
                    ("PRODUCT PICTURES", "Take pictures of product before shipping"),
                    ("INTERNAL COATING", "In house coating at ACI"),
                    ("VISUAL INSPECTION", "Human visual inspection parts and coating, no AOI"),
                    ("SHIPPING", "Send product to customer per packing request"),
                    ("JOB NUMBER", "ACI job number"),
                    ("NUMBER OF LAYERS", "Quantity of different board layers"),
                    ("BOARD SIZE", "Physical dimensions of the board"),
                    ("MATERIAL", "The base material/foundation of the board"),
                    ("BOARD THICKNESS", "Overall thickness of the printed circuit board"),
                    ("COPPER THICKNESS", "Thickness of the conductive copper layer"),
                    ("GOLD", "ENIG surface finish/plating"),
                    ("HAL/HASL/LF HASL", "Surface finish/plating"),
                    ("GOLD FINGERS", "Gold contacts on outer edge of board"),
                    ("CSINK", "Countersink holes"),
                    ("BLIND & BURIED VIAS", "Blind and buried vias connecting layers"),
                    ("GENERATE GERBER/PANELIZATION", "Create zip file for PCB vendor with specs"),
                    ("ORDER/PURCHASE PCB", "Name of the PCB vendor and quantity needed"),
                    ("RECEIVING", "Receive parts from vendors and put into ACI inventory"),
                    ("VSCORE", "Use a machine to break a panel into individual boards"),
                    ("FINAL INSPECTION", "Sample inspection of the PCB artwork by Quality Control"),
                ],
                "CABLE": [
                    ("VERIFY BOM", "Verify no BOM or rev changes"),
                    ("KITTING", "Pull parts from inventory to place in a kit for manufacturing"),
                    ("COMPONENT PREP", "Pre-bending of parts or any necessary alteration of a part prior to production"),
                    ("HAND SOLDER", "Anything that must be soldered by hand, no wave, no SMT"),
                    ("MANUAL INSERTION", "Install prepared parts"),
                    ("HAND ASSEMBLY", "Assembly of parts after wave but before inspection"),
                    ("SECONDARY ASSEMBLY", "Anything assembled after testing or inspection"),
                    ("EPOXY", "Anything that needs to be glued or epoxied"),
                    ("LABELING", "Place a label per instructions"),
                    ("PRODUCT PICTURES", "Take pictures of product before shipping"),
                    ("VISUAL INSPECTION", "Human visual inspection parts and coating, no AOI"),
                    ("MANUAL ASSEMBLY", "Put the assembly together by hand"),
                    ("BOX ASSEMBLY", "Mechanical build consisting of the PCBA, hardware, and/or housings"),
                    ("HARDWARE", "Adding screws, nuts, bolts, brackets, displays, etc."),
                    ("SHIPPING", "Send product to customer per packing request"),
                    ("WIRE CUT", "Cut wire to length needed"),
                    ("STRIP WIRE", "Remove insulation to necessary length"),
                    ("HEAT SHRINK", "Cut and shrink (heat shrink or flex loom)"),
                    ("TINNING", "Dip wire end into solder"),
                    ("CRIMPING", "Fold into ridges by pinching together"),
                    ("INSERT", "Install pins into connector"),
                    ("PULL TEST", "Make sure crimps don't fall off"),
                ],
                "PURCHASING": [
                    ("ENGINEERING", "Reverse engineering and design"),
                    ("MAKE BOM", "Create or update Bill of Materials"),
                    ("PURCHASING", "Procure parts in sufficient quantities for build"),
                    ("QUOTE", "Estimation of material, labor, and PCB costs"),
                    ("INVENTORY", "Add to inventory and track stock levels"),
                ],
            }
            count = 0
            for wc_type, items in WORK_CENTER_DATA.items():
                for idx, (name, desc) in enumerate(items):
                    code = f"{wc_type}_{name.replace(' ', '_').replace('/', '_').replace('&', 'AND').upper()}"
                    wc = WorkCenter(name=name, code=code, description=desc, traveler_type=wc_type, sort_order=idx + 1, is_active=True)
                    db.add(wc)
                    count += 1
            db.commit()
            print(f"✅ Seeded {count} work centers")
        else:
            print(f"Work centers already exist ({db.query(WorkCenter).count()} found)")

        # Seed / backfill RMA work centers to match Preet's 17 commonly-used steps.
        # Source of truth: docs/RMA_PROCESS.md (Preet's SOP). This runs every startup
        # so existing DBs pick up new steps without losing customizations to
        # description/department on already-seeded rows.
        RMA_SAME_DIFF_STEPS = [
            ("CUSTOMER APPROVAL",  "Get customer approval before proceeding",                "Quality"),
            ("DETAILED INSPEC",    "Detailed inspection - sample or 100% inspection",        "Quality"),
            ("INCOMING INSPECTION","Inspect incoming RMA units, verify quantity and condition","Quality"),
            ("TESTING",            "Test units per original test procedures",                "Test"),
            ("X-RAY",              "X-ray inspection of solder joints/components as requested by customer", "Test"),
            ("PROGRAMMING",        "Program or reprogram units",                             "Test"),
            ("TROUBLESHOOTING",    "Diagnose and troubleshoot defective units",              "Test"),
            ("REPAIR",             "Repair defective units per customer complaint",          "Soldering"),
            ("INTERIM INSPEC",     "Interim inspection during repair process",               "Quality"),
            ("PARTS INVENTORY",    "Check parts before buying",                              "Purchasing"),
            ("PURCHASING",         "Parts ordered, waiting for receipt before repair",       "Purchasing"),
            ("MISC.",              "Miscellaneous operations as needed",                     "ALL"),
            ("FINAL INSPEC",       "Final inspection - sample or 100% inspection",           "Quality"),
            ("INVOICING",          "Credit on receive, charge on ship (Add-On/Chemring)",    "Other"),
            ("QUALITY",            "Send boards with CofC (Chemring)",                       "Quality"),
            ("PCBA STOCK",         "Check stock - any PCBA or cable assemblies on hand?",    "Receiving"),
            ("LABELLING",          "Apply labels as required",                               "Shipping"),
            ("PACKING",            "Pack units for shipment",                                "Shipping"),
            ("PACKING AND SHIPPING","Pack and ship units back to customer",                  "Shipping"),
            ("SHIPPING",           "Ship units back to customer",                            "Shipping"),
        ]
        # Modification RMAs skip the stock-check step (per existing convention)
        MODIFICATION_STEPS = [s for s in RMA_SAME_DIFF_STEPS if s[0] != "PCBA STOCK"]

        # Work-center CODES are kept stable across the display-name rename so that
        # existing process_steps (FK on work_center_code) keep resolving. The two
        # renamed steps map back to their original code token.
        CODE_TOKEN_OVERRIDE = {"PARTS INVENTORY": "INVENTORY", "PCBA STOCK": "STOCK", "X-RAY": "XRAY"}

        RMA_WC_DATA = {
            "RMA_SAME": RMA_SAME_DIFF_STEPS,
            "RMA_DIFF": RMA_SAME_DIFF_STEPS,
            "MODIFICATION": MODIFICATION_STEPS,
        }
        type_prefix = {"RMA_SAME": "RMAS", "RMA_DIFF": "RMAD", "MODIFICATION": "MOD"}

        added = 0
        reordered = 0
        renamed = 0
        for wc_type, items in RMA_WC_DATA.items():
            for idx, (name, desc, dept) in enumerate(items):
                token = CODE_TOKEN_OVERRIDE.get(name, name)
                code = f"{type_prefix[wc_type]}_{token.replace(' ', '_').replace('.', '').upper()}"
                target_sort = idx + 1
                existing = db.query(WorkCenter).filter(WorkCenter.code == code).first()
                if not existing:
                    db.add(WorkCenter(
                        name=name, code=code, description=desc,
                        traveler_type=wc_type, department=dept,
                        sort_order=target_sort, is_active=True,
                    ))
                    added += 1
                else:
                    if existing.sort_order != target_sort:
                        existing.sort_order = target_sort
                        reordered += 1
                    # Backfill the display-name rename onto already-seeded rows
                    if existing.name != name:
                        existing.name = name
                        renamed += 1
        if added or reordered or renamed:
            db.commit()
            print(f"RMA work centers: +{added} added, {reordered} reordered, {renamed} renamed (Preet 17-step SOP)")

        # Backfill the renamed work-center labels onto existing RMA travelers'
        # process steps (the routing table renders the stored operation string,
        # not a live lookup). Scope strictly to RMA-type travelers so a non-RMA
        # "INVENTORY" step (e.g. Purchasing) is never touched.
        from sqlalchemy import text as _wc_text
        _rma_subq = "SELECT id FROM travelers WHERE traveler_type IN ('RMA_SAME', 'RMA_DIFF', 'MODIFICATION')"
        step_renames = db.execute(_wc_text(f"""
            UPDATE process_steps SET operation = 'PARTS INVENTORY'
            WHERE operation = 'INVENTORY' AND traveler_id IN ({_rma_subq})
        """)).rowcount
        step_renames += db.execute(_wc_text(f"""
            UPDATE process_steps SET operation = 'PCBA STOCK'
            WHERE operation = 'STOCK' AND traveler_id IN ({_rma_subq})
        """)).rowcount
        if step_renames:
            db.commit()
            print(f"RMA process steps: {step_renames} operation labels renamed (Parts Inventory / PCBA Stock)")

        db.close()
    except Exception as e:
        print(f"Warning: Could not seed work centers: {e}")

    # Auto-migrate: add category column to work_centers if missing
    try:
        from sqlalchemy import text, inspect
        with engine.connect() as conn:
            inspector = inspect(engine)
            columns = [c['name'] for c in inspector.get_columns('work_centers')]
            if 'category' not in columns:
                conn.execute(text("ALTER TABLE work_centers ADD COLUMN category VARCHAR(100)"))
                conn.commit()
                print("Added 'category' column to work_centers table")

                # Set default categories based on spreadsheet mapping
                CATEGORY_MAP = {
                    'PROGRAM PART': 'SMT hrs. Actual',
                    'SMT PROGRAMING': 'SMT hrs. Actual',
                    'SMT PROGRAMMING': 'SMT hrs. Actual',
                    'FEEDER LOAD': 'SMT hrs. Actual',
                    'SMT SET UP': 'SMT hrs. Actual',
                    'WASH (POST-WAVE)': 'HAND hrs. Actual',
                    'INTERNAL TESTING (POST-COATING)': 'E-TEST hrs. Actual',
                    'INTERNAL TESTING (POST-ESS)': 'E-TEST hrs. Actual',
                    'GLUE': 'SMT hrs. Actual',
                    'SMT TOP': 'SMT hrs. Actual',
                    'SMT BOTTOM': 'SMT hrs. Actual',
                    'HAND SOLDER': 'HAND hrs. Actual',
                    'WASH': 'HAND hrs. Actual',
                    'TRIM': 'HAND hrs. Actual',
                    'HAND ASSEMBLY': 'HAND hrs. Actual',
                    'EPOXY': 'HAND hrs. Actual',
                    'DEPANEL': 'HAND hrs. Actual',
                    'INTERNAL COATING': 'HAND hrs. Actual',
                    'BOX ASSEMBLY': 'HAND hrs. Actual',
                    'MANUAL INSERTION': 'TH hrs. Actual',
                    'WAVE': 'TH hrs. Actual',
                    'MANUAL ASSEMBLY': 'TH hrs. Actual',
                    'AOI PROGRAMMING': 'AOI & Final Inspection, QC hrs. Actual',
                    'AOI': 'AOI & Final Inspection, QC hrs. Actual',
                    'VISUAL INSPECTION': 'AOI & Final Inspection, QC hrs. Actual',
                    'FINAL INSPECTION': 'AOI & Final Inspection, QC hrs. Actual',
                    'INTERNAL TESTING': 'E-TEST hrs. Actual',
                    'LABELING': 'Labelling, Packaging, Shipping hrs. Actual',
                    'HARDWARE': 'Labelling, Packaging, Shipping hrs. Actual',
                    'SHIPPING': 'Labelling, Packaging, Shipping hrs. Actual',
                    'WIRE CUT': 'HAND hrs. Actual',
                    'STRIP WIRE': 'HAND hrs. Actual',
                    'HEAT SHRINK': 'HAND hrs. Actual',
                    'TINNING': 'HAND hrs. Actual',
                    'CRIMPING': 'HAND hrs. Actual',
                    'INSERT': 'HAND hrs. Actual',
                    'PULL TEST': 'HAND hrs. Actual',
                }
                for name, cat in CATEGORY_MAP.items():
                    conn.execute(
                        text("UPDATE work_centers SET category = :cat WHERE UPPER(TRIM(name)) = :name"),
                        {"cat": cat, "name": name.upper().strip()}
                    )
                conn.commit()
                print("Applied default category values to work centers")
    except Exception as e:
        print(f"Warning: Could not auto-migrate category column: {e}")

    # Auto-migrate: add department column to work_centers if missing
    try:
        from sqlalchemy import text, inspect as sa_inspect
        with engine.connect() as conn:
            insp = sa_inspect(engine)
            columns = [c['name'] for c in insp.get_columns('work_centers')]
            if 'department' not in columns:
                conn.execute(text("ALTER TABLE work_centers ADD COLUMN department VARCHAR(100)"))
                conn.commit()
                print("Added 'department' column to work_centers table")

            # Seed department values based on work center name mapping
            DEPARTMENT_MAP = {
                'VERIFY BOM': 'Engineering/Prep',
                'KITTING': 'Receiving',
                'COMPONENT PREP': 'TH',
                'PROGRAM PART': 'Test/Soldering',
                'HAND SOLDER': 'Soldering',
                'SMT PROGRAMING': 'SMT',
                'SMT PROGRAMMING': 'SMT',
                'FEEDER LOAD': 'SMT',
                'SMT SET UP': 'SMT',
                'WASH (POST-WAVE)': 'ALL',
                'INTERNAL TESTING (POST-COATING)': 'Test',
                'INTERNAL TESTING (POST-ESS)': 'Test',
                'GENERATE CAD': 'Engineering/Prep',
                'GENERATE GERBER': 'Engineering/Prep',
                'VERIFY GERBER': 'Engineering/Prep',
                'MAKE SILKSCREEN': 'Engineering/Prep',
                'CREATE BOM': 'Engineering/Prep',
                'GLUE': 'SMT',
                'SMT TOP': 'SMT',
                'SMT BOTTOM': 'SMT',
                'WASH': 'ALL',
                'X-RAY': 'SMT/Soldering/Test',
                'MANUAL INSERTION': 'TH',
                'WAVE': 'TH',
                'CLEAN TEST': 'ALL',
                'TRIM': 'TH/Soldering',
                'PRESS FIT': 'Soldering',
                'HAND ASSEMBLY': 'TH',
                'AOI PROGRAMMING': 'Quality',
                'AOI': 'Quality',
                'SECONDARY ASSEMBLY': 'Soldering',
                'EPOXY': 'ALL',
                'INTERNAL TESTING': 'Test',
                'LABELING': 'Shipping',
                'DEPANEL': 'Shipping',
                'PRODUCT PICTURES': 'Quality/Shipping/Test',
                'SEND TO EXTERNAL COATING': 'Shipping',
                'RETURN FROM EXTERNAL COATING': 'Receiving/Test',
                'INTERNAL COATING': 'Coating',
                'SEND TO ESS': 'Shipping',
                'RETURN FROM ESS': 'Receiving/Test',
                'VISUAL INSPECTION': 'Quality',
                'FINAL INSPECTION': 'Quality',
                'MANUAL ASSEMBLY': 'Soldering/Cable',
                'BOX ASSEMBLY': 'Soldering/Cable',
                'HARDWARE': 'Soldering/Cable',
                'SHIPPING': 'Shipping',
                'WIRE CUT': 'Cable',
                'STRIP WIRE': 'Cable',
                'HEAT SHRINK': 'Cable',
                'TINNING': 'Cable',
                'CRIMPING': 'Cable',
                'INSERT': 'Cable',
                'PULL TEST': 'Cable',
                'ENGINEERING': 'Engineering/Prep',
                'GENERATE CAD': 'Engineering/Prep',
                'GENERATE GERBER': 'Engineering/Prep',
                'VERIFY GERBER': 'Engineering/Prep',
                'MAKE SILKSCREEN': 'Engineering/Prep',
                'PROGRAM AOI': 'Quality',
                'RECEIVING': 'Receiving',
                'GENERATE GERBER/PANELIZATION': 'Engineering/Prep',
                'ORDER/PURCHASE PCB': 'Purchasing',
                'VSCORE': 'Shipping',
                'MAKE BOM': 'Engineering/Prep',
                'PURCHASING': 'Purchasing',
                'QUOTE': 'Purchasing',
                'INVENTORY': 'Receiving',
            }
            with engine.connect() as conn2:
                for name, dept in DEPARTMENT_MAP.items():
                    conn2.execute(
                        text("UPDATE work_centers SET department = :dept WHERE UPPER(TRIM(name)) = :name AND (department IS NULL OR department = '')"),
                        {"dept": dept, "name": name.upper().strip()}
                    )
                conn2.commit()
            print("Applied department values to work centers")
    except Exception as e:
        print(f"Warning: Could not auto-migrate department column: {e}")

    # Auto-migrate: add qty_completed column to labor_entries if missing
    try:
        from sqlalchemy import text, inspect as sa_inspect2
        with engine.connect() as conn:
            insp = sa_inspect2(engine)
            labor_cols = [c['name'] for c in insp.get_columns('labor_entries')]
            if 'qty_completed' not in labor_cols:
                conn.execute(text("ALTER TABLE labor_entries ADD COLUMN qty_completed INTEGER"))
                conn.commit()
                print("Added 'qty_completed' column to labor_entries table")
    except Exception as e:
        print(f"Warning: Could not auto-migrate qty_completed column: {e}")

    # Auto-migrate: soft-delete columns. Nothing in NEXUS is removed from the
    # database; these endpoints stamp deleted_at/deleted_by instead of issuing a
    # DELETE, and models.install_soft_delete_filter keeps stamped rows out of
    # every ORM read.
    try:
        from sqlalchemy import text, inspect as sa_inspect_sd
        soft_delete_tables = (
            'labor_entries', 'pause_logs', 'kitting_timer_sessions',
            'job_documents', 'quality_check_items', 'communication_logs',
        )
        with engine.connect() as conn:
            insp = sa_inspect_sd(engine)
            existing = set(insp.get_table_names())
            for table in soft_delete_tables:
                if table not in existing:
                    continue
                cols = [c['name'] for c in insp.get_columns(table)]
                if 'deleted_at' not in cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE"))
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_deleted_at ON {table} (deleted_at)"))
                    print(f"Added 'deleted_at' column to {table}")
                if 'deleted_by' not in cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN deleted_by INTEGER"))
                    print(f"Added 'deleted_by' column to {table}")
            conn.commit()
    except Exception as e:
        print(f"Warning: Could not auto-migrate soft-delete columns: {e}")

    # Auto-migrate: add RMA enum values to travelertype
    try:
        from sqlalchemy import text as text_rma_enum
        import re as _re_enum
        _enum_val_re = _re_enum.compile(r'^[A-Z_][A-Z0-9_]*$')
        with engine.connect() as conn:
            for val in ['RMA_SAME', 'RMA_DIFF', 'MODIFICATION']:
                if not _enum_val_re.match(val):
                    print(f"Skipping unsafe enum value: {val}")
                    continue
                try:
                    conn.execute(text_rma_enum(f"ALTER TYPE travelertype ADD VALUE IF NOT EXISTS '{val}'"))
                except Exception as enum_err:
                    # Expected when value already exists on older PG versions
                    # that don't support ADD VALUE IF NOT EXISTS cleanly in a tx.
                    print(f"Note: enum value '{val}' not added ({enum_err})")
            conn.commit()
            print("Ensured RMA enum values exist in travelertype")
    except Exception as e:
        print(f"Warning: Could not add RMA enum values: {e}")

    # Auto-migrate: add WORK_CENTER_* values to the notificationtype enum so
    # admin notifications for work-center changes can be written without a
    # full schema migration.
    try:
        from sqlalchemy import text as text_wc_enum
        import re as _re_wc_enum
        _wc_val_re = _re_wc_enum.compile(r'^[A-Z_][A-Z0-9_]*$')
        with engine.connect() as conn:
            for val in [
                'WORK_CENTER_CREATED',
                'WORK_CENTER_UPDATED',
                'WORK_CENTER_DELETED',
                'WORK_CENTER_REORDERED',
            ]:
                if not _wc_val_re.match(val):
                    print(f"Skipping unsafe enum value: {val}")
                    continue
                try:
                    conn.execute(text_wc_enum(f"ALTER TYPE notificationtype ADD VALUE IF NOT EXISTS '{val}'"))
                except Exception as wc_enum_err:
                    print(f"Note: notificationtype value '{val}' not added ({wc_enum_err})")
            conn.commit()
            print("Ensured WORK_CENTER_* values exist in notificationtype")
    except Exception as e:
        print(f"Warning: Could not add WORK_CENTER_* enum values: {e}")

    # Auto-migrate: add RMA-specific columns to travelers table and create rma_unit_tracking table
    try:
        from sqlalchemy import text, inspect as sa_inspect_rma
        with engine.connect() as conn:
            insp = sa_inspect_rma(engine)
            traveler_cols = [c['name'] for c in insp.get_columns('travelers')]
            rma_columns = {
                'rma_number': 'VARCHAR(50)',
                'customer_contact': 'VARCHAR(100)',
                'original_wo_number': 'VARCHAR(50)',
                'original_po_number': 'VARCHAR(255)',
                'return_po_number': 'VARCHAR(255)',
                'rma_po_number': 'VARCHAR(255)',
                'invoice_number': 'VARCHAR(100)',
                'customer_ncr': 'VARCHAR(100)',
                'original_built_quantity': 'INTEGER',
                'units_shipped': 'INTEGER',
                'quantity_rma_issued': 'INTEGER',
                'units_received': 'INTEGER',
                'customer_revision_sent': 'VARCHAR(50)',
                'customer_revision_received': 'VARCHAR(50)',
                'rma_notes': 'TEXT',
                'wo_type_label': 'VARCHAR(50)',
                'assy_type': 'VARCHAR(50)',
                'include_sn_table': 'BOOLEAN',
                'rma_table_columns': 'TEXT',
            }
            import re as _re_ident
            _ident_re = _re_ident.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
            _type_re = _re_ident.compile(r'^[A-Z]+(\(\d+\))?$')
            for col_name, col_type in rma_columns.items():
                if col_name not in traveler_cols:
                    if not _ident_re.match(col_name) or not _type_re.match(col_type):
                        print(f"Skipping unsafe column definition: {col_name} {col_type}")
                        continue
                    conn.execute(text(f"ALTER TABLE travelers ADD COLUMN {col_name} {col_type}"))
                    print(f"Added '{col_name}' column to travelers table")
            conn.commit()

            # Create rma_unit_tracking table if it doesn't exist
            table_names = insp.get_table_names()
            if 'rma_unit_tracking' not in table_names:
                conn.execute(text("""
                    CREATE TABLE rma_unit_tracking (
                        id SERIAL PRIMARY KEY,
                        traveler_id INTEGER NOT NULL REFERENCES travelers(id) ON DELETE CASCADE,
                        unit_number INTEGER NOT NULL,
                        serial_number VARCHAR(100),
                        customer_complaint TEXT,
                        incoming_inspection_notes TEXT,
                        disposition TEXT,
                        troubleshooting_notes TEXT,
                        repairing_notes TEXT,
                        final_inspection_notes TEXT,
                        customer_ncr VARCHAR(100),
                        original_po_number VARCHAR(255),
                        original_wo_number VARCHAR(50),
                        customer_revision_sent VARCHAR(50),
                        customer_revision_received VARCHAR(50),
                        original_built_quantity INTEGER,
                        units_shipped INTEGER,
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                """))
                conn.execute(text("CREATE INDEX ix_rma_unit_tracking_traveler_id ON rma_unit_tracking(traveler_id)"))
                conn.commit()
                print("Created 'rma_unit_tracking' table")

            # Add custom_values column to rma_unit_tracking if missing
            unit_cols = [c['name'] for c in insp.get_columns('rma_unit_tracking')] if 'rma_unit_tracking' in insp.get_table_names() else []
            if unit_cols and 'custom_values' not in unit_cols:
                conn.execute(text("ALTER TABLE rma_unit_tracking ADD COLUMN custom_values TEXT"))
                conn.commit()
                print("Added 'custom_values' column to rma_unit_tracking table")
    except Exception as e:
        print(f"Warning: Could not auto-migrate RMA columns/table: {e}")

    # Ensure FINAL INSPECTION exists in PCB_ASSEMBLY work centers
    try:
        from database import SessionLocal
        from models import WorkCenter
        db = SessionLocal()
        has_final = db.query(WorkCenter).filter(
            WorkCenter.traveler_type == 'PCB_ASSEMBLY',
            WorkCenter.name == 'FINAL INSPECTION'
        ).first()
        if not has_final:
            # Move SHIPPING to sort_order 47 and insert FINAL INSPECTION at 46
            shipping = db.query(WorkCenter).filter(
                WorkCenter.traveler_type == 'PCB_ASSEMBLY',
                WorkCenter.name == 'SHIPPING'
            ).first()
            if shipping:
                shipping.sort_order = 47
            db.add(WorkCenter(
                name='FINAL INSPECTION',
                code='PCB_ASSEMBLY_46_FINAL_INSPECTION',
                description='Final quality inspection before shipping',
                traveler_type='PCB_ASSEMBLY', department='Quality',
                category='AOI & Final Inspection, QC hrs. Actual',
                sort_order=46, is_active=True
            ))
            db.commit()
            print("Added FINAL INSPECTION work center")
        db.close()
    except Exception as e:
        print(f"Warning: Could not check/add FINAL INSPECTION: {e}")

    # Auto-migrate: drop the obsolete uq_traveler_job_revision unique constraint.
    # Multiple travelers may legitimately share a job_number+revision as long as
    # they have different Work Order / PO numbers (a normal workflow). The old
    # constraint contradicted that and caused opaque 500s on commit. WO
    # uniqueness is still enforced by uq_traveler_work_order_number.
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE travelers DROP CONSTRAINT IF EXISTS uq_traveler_job_revision"))
            conn.commit()
            print("Dropped obsolete uq_traveler_job_revision constraint (if it existed)")
    except Exception as e:
        print(f"Warning: Could not drop uq_traveler_job_revision: {e}")

    # Auto-migrate: enforce "one open labor entry per employee" and "one open
    # kitting session per traveler" at the DB level so concurrent start/resume
    # requests can't create duplicate open rows. If pre-existing duplicates
    # block index creation, we log and continue (the app-level checks still
    # apply); the data should be cleaned up before the guard takes effect.
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_one_open_labor_entry_per_employee "
                "ON labor_entries (employee_id) "
                "WHERE end_time IS NULL AND is_completed = false"
            ))
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_one_open_kitting_session_per_traveler "
                "ON kitting_timer_sessions (traveler_id) "
                "WHERE end_time IS NULL"
            ))
            conn.commit()
            print("Ensured single-open-row unique indexes (labor + kitting)")
    except Exception as e:
        print(f"Warning: Could not create open-row unique indexes (likely pre-existing duplicates): {e}")

    # Auto-migrate: make approver authority data-driven. Historically the
    # approval endpoints fell back to hardcoded usernames ("Kris"/"Adam"); now
    # they rely solely on the is_approver flag, so backfill it for those users
    # once. After this, renaming a user keeps their approver status.
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text(
                "UPDATE users SET is_approver = true WHERE username IN ('Kris', 'Adam')"
            ))
            conn.commit()
            print("Backfilled is_approver for Kris/Adam")
    except Exception as e:
        print(f"Warning: Could not backfill is_approver: {e}")

    # Start background long-wait sweep (runs every 30 min)
    import asyncio
    async def sweep_long_waits_loop():
        while True:
            await asyncio.sleep(1800)  # 30 minutes
            try:
                from database import SessionLocal
                from models import KittingTimerSession, Traveler
                from routers.kitting_timer import _maybe_notify_long_wait, WAITING
                db = SessionLocal()
                open_waiting = db.query(KittingTimerSession).filter(
                    KittingTimerSession.end_time.is_(None),
                    KittingTimerSession.session_type == WAITING,
                ).all()
                for sess in open_waiting:
                    traveler = db.query(Traveler).filter(Traveler.id == sess.traveler_id).first()
                    if traveler:
                        _maybe_notify_long_wait(db, traveler)
                db.close()
            except Exception as e:
                print(f"Background sweep error: {e}")
    sweep_task = asyncio.create_task(sweep_long_waits_loop())
    print("Started background long-wait sweep (every 30 min)")

    # Prune old notifications daily: read >30d, unread >90d
    async def prune_notifications_loop():
        from datetime import datetime, timedelta
        while True:
            try:
                from database import SessionLocal
                from models import Notification
                db = SessionLocal()
                read_cutoff = datetime.utcnow() - timedelta(days=30)
                unread_cutoff = datetime.utcnow() - timedelta(days=90)
                deleted_read = db.query(Notification).filter(
                    Notification.is_read == True,
                    Notification.created_at < read_cutoff,
                ).delete(synchronize_session=False)
                deleted_unread = db.query(Notification).filter(
                    Notification.is_read == False,
                    Notification.created_at < unread_cutoff,
                ).delete(synchronize_session=False)
                db.commit()
                db.close()
                if deleted_read or deleted_unread:
                    print(f"Pruned notifications: {deleted_read} read, {deleted_unread} unread")
            except Exception as e:
                print(f"Notification prune error: {e}")
            await asyncio.sleep(86400)  # 24 hours
    prune_task = asyncio.create_task(prune_notifications_loop())
    print("Started notifications prune loop (daily)")

    yield
    # Shutdown
    sweep_task.cancel()
    prune_task.cancel()
    print("NEXUS Backend shutting down...")

app = FastAPI(
    title="NEXUS API",
    description="American Circuits Traveler Management System API",
    version="1.0.0",
    lifespan=lifespan,
    redirect_slashes=False
)

# Strip trailing slashes so /travelers/ works the same as /travelers
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

class TrailingSlashMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path != "/" and request.url.path.endswith("/"):
            request.scope["path"] = request.url.path.rstrip("/")
        response = await call_next(request)

        # Add cache headers for GET requests (10 seconds browser cache)
        if request.method == "GET" and response.status_code == 200:
            path = request.url.path
            # Don't cache auth, notifications, or active labor (needs to be real-time)
            if not any(x in path for x in ['/auth/', '/notifications', '/labor/active', '/labor/init']):
                response.headers["Cache-Control"] = "private, max-age=10, stale-while-revalidate=20"

        return response

app.add_middleware(TrailingSlashMiddleware)

# Convert DB uniqueness/constraint violations into a clean 409 instead of a
# generic 500. This catches races that slip past app-level pre-checks — e.g.
# two concurrent DRAFT→CREATED transitions allocating the same work-order
# number, or duplicate open labor/kitting rows.
from sqlalchemy.exc import IntegrityError
from fastapi.responses import JSONResponse

@app.exception_handler(IntegrityError)
async def integrity_error_handler(request, exc):
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={
            "detail": "This change conflicts with an existing record "
                      "(duplicate or constraint violation). Please refresh and try again."
        },
    )

# Gzip compression — JSON responses compress ~5-10x, which is the single biggest
# win for transfer time over the office uplink / tunnel (the slow network leg).
# Only kicks in for responses >= 500 bytes and clients that send Accept-Encoding.
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=500)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/auth", tags=["authentication"])
app.include_router(users.router, prefix="/users", tags=["users"])
app.include_router(travelers.router, prefix="/travelers", tags=["travelers"])
app.include_router(work_orders.router, prefix="/work-orders", tags=["work-orders"])
app.include_router(approvals.router, prefix="/approvals", tags=["approvals"])
app.include_router(labor.router, prefix="/labor", tags=["labor"])
app.include_router(barcodes.router, prefix="/barcodes", tags=["barcodes"])
app.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
app.include_router(work_centers.router, prefix="/work-centers-mgmt", tags=["work-centers"])
app.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
app.include_router(analytics_advanced.router, prefix="/analytics", tags=["analytics-advanced"])
app.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
app.include_router(kitting_timer.router, prefix="/kitting", tags=["kitting-timer"])
app.include_router(features.router, prefix="/features", tags=["features"])

@app.get("/")
async def root():
    return {"message": "NEXUS API - American Circuits Traveler Management System"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "nexus-backend"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)