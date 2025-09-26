# NEXUS Database Schema

PostgreSQL database schema and initialization for the NEXUS Traveler Workflow & Documentation Enhancement System.

## 🗄️ Database Overview

### Database Information
- **Database Engine**: PostgreSQL 15
- **Character Set**: UTF-8
- **Timezone**: UTC
- **Default User**: nexus_user
- **Default Database**: nexus_db

### Schema Version
- **Current Version**: 1.0.0
- **Last Updated**: September 2024
- **Schema File**: `01-init.sql`

## 📊 Database Schema

### Core Tables

#### Users & Authentication
```sql
users                    # User accounts and roles
├── id (PK)             # Primary key
├── username            # Unique username
├── email               # User email
├── password_hash       # Bcrypt password hash
├── role                # User role (admin, operator, etc.)
├── first_name          # First name
├── last_name           # Last name
├── created_at          # Account creation date
└── updated_at          # Last update timestamp
```

#### Purchase Orders
```sql
purchase_orders          # Customer purchase orders
├── id (PK)             # Primary key
├── po_number           # Unique PO number
├── customer_name       # Customer name
├── job_number          # Job reference number
├── created_date        # PO creation date
├── due_date            # Delivery due date
├── status              # PO status (active, completed, etc.)
├── created_by (FK)     # User who created the PO
└── created_at          # Record creation timestamp
```

#### Traveler Management
```sql
traveler_types          # Types of travelers (PCB, Parts, Assembly, Cable)
├── id (PK)             # Primary key
├── type_name           # Type name (PCB, Parts, etc.)
├── description         # Type description
└── color_code          # UI color code (hex)

travelers               # Main traveler documents
├── id (PK)             # Primary key
├── traveler_number     # Unique traveler identifier
├── po_id (FK)          # Reference to purchase order
├── traveler_type_id (FK) # Reference to traveler type
├── job_number          # Associated job number
├── barcode             # Generated barcode data
├── status              # Current status
├── revision            # Current revision number
├── created_by (FK)     # User who created traveler
├── created_at          # Creation timestamp
└── updated_at          # Last update timestamp
```

#### Bill of Materials
```sql
bom_items               # Bill of materials items
├── id (PK)             # Primary key
├── traveler_id (FK)    # Reference to traveler
├── part_number         # Part number
├── description         # Part description
├── quantity            # Required quantity
├── unit_price          # Price per unit
├── supplier            # Supplier name
├── notes               # Additional notes
└── created_at          # Record creation timestamp
```

#### Process Management
```sql
process_sequences       # Manufacturing process steps
├── id (PK)             # Primary key
├── traveler_id (FK)    # Reference to traveler
├── step_number         # Step sequence number
├── step_name           # Step name/title
├── description         # Step description
├── estimated_hours     # Estimated completion time
├── required_role       # Required user role
├── is_completed        # Completion status
├── completed_by (FK)   # User who completed step
├── completed_at        # Completion timestamp
└── created_at          # Record creation timestamp

labor_logs              # Time tracking for process steps
├── id (PK)             # Primary key
├── traveler_id (FK)    # Reference to traveler
├── process_step_id (FK) # Reference to process step
├── user_id (FK)        # User performing work
├── start_time          # Work start time
├── end_time            # Work end time
├── hours_logged        # Total hours logged
├── notes               # Work notes
└── created_at          # Record creation timestamp
```

#### Quality & Tracking
```sql
coating_logs            # External coating process tracking
├── id (PK)             # Primary key
├── traveler_id (FK)    # Reference to traveler
├── coating_type        # Type of coating
├── sent_date           # Date sent for coating
├── received_date       # Date received back
├── inspected_date      # Quality inspection date
├── tracking_number     # Shipping tracking number
├── status              # Coating status
├── notes               # Process notes
└── created_at          # Record creation timestamp

revision_history        # Complete change audit trail
├── id (PK)             # Primary key
├── traveler_id (FK)    # Reference to traveler
├── revision_number     # Revision number
├── change_description  # Description of changes
├── changed_by (FK)     # User who made changes
├── change_date         # Date of change
└── change_reason       # Reason for change
```

#### Documentation
```sql
packing_slips           # Shipping documentation
├── id (PK)             # Primary key
├── traveler_id (FK)    # Reference to traveler
├── ship_to_address     # Shipping address
├── ship_date           # Shipping date
├── tracking_number     # Carrier tracking number
├── carrier             # Shipping carrier
├── kitting_confirmation # Kitting complete flag
├── created_by (FK)     # User who created slip
└── created_at          # Record creation timestamp

checklists              # Quality control checklists
├── id (PK)             # Primary key
├── traveler_id (FK)    # Reference to traveler
├── checklist_type      # Type of checklist
├── item_name           # Checklist item name
├── is_checked          # Completion status
├── checked_by (FK)     # User who checked item
├── checked_at          # Check timestamp
└── notes               # Additional notes

instructions            # Work instructions
├── id (PK)             # Primary key
├── traveler_id (FK)    # Reference to traveler
├── instruction_type    # Type (typed/written)
├── content             # Text content
├── image_url           # Image file path
├── created_by (FK)     # User who created instruction
└── created_at          # Record creation timestamp

pcb_images              # PCB documentation images
├── id (PK)             # Primary key
├── traveler_id (FK)    # Reference to traveler
├── image_type          # Image type (drawing, revision, etc.)
├── image_url           # Image file path
├── description         # Image description
├── revision_version    # Associated revision
├── uploaded_by (FK)    # User who uploaded image
└── uploaded_at         # Upload timestamp
```

## 🔗 Relationships

### Foreign Key Relationships
```
purchase_orders ← travelers (po_id)
traveler_types ← travelers (traveler_type_id)
travelers ← bom_items (traveler_id)
travelers ← process_sequences (traveler_id)
travelers ← labor_logs (traveler_id)
travelers ← coating_logs (traveler_id)
travelers ← revision_history (traveler_id)
travelers ← packing_slips (traveler_id)
travelers ← checklists (traveler_id)
travelers ← instructions (traveler_id)
travelers ← pcb_images (traveler_id)

users ← travelers (created_by)
users ← labor_logs (user_id)
users ← revision_history (changed_by)
process_sequences ← labor_logs (process_step_id)
```

## 📋 Indexes

### Performance Indexes
```sql
-- Primary indexes on foreign keys
idx_travelers_po_id ON travelers(po_id)
idx_travelers_barcode ON travelers(barcode)
idx_travelers_status ON travelers(status)
idx_bom_items_traveler_id ON bom_items(traveler_id)
idx_process_sequences_traveler_id ON process_sequences(traveler_id)
idx_labor_logs_traveler_id ON labor_logs(traveler_id)
idx_labor_logs_user_id ON labor_logs(user_id)
```

## 🚀 Database Initialization

### Automatic Setup
The database is automatically initialized when the Docker container starts:

1. **Schema Creation** - All tables, indexes, and relationships
2. **Default Data** - Traveler types and admin user
3. **Triggers** - Automatic timestamp updates
4. **Functions** - Helper database functions

### Default Data
```sql
-- Default traveler types
INSERT INTO traveler_types VALUES
(1, 'PCB', 'Printed Circuit Board travelers', '#3B82F6'),
(2, 'Parts', 'Parts procurement and kitting', '#10B981'),
(3, 'Assembly', 'Assembly process tracking', '#F59E0B'),
(4, 'Cable', 'Cable manufacturing and testing', '#8B5CF6');

-- Default admin user (password: admin123)
INSERT INTO users VALUES
(1, 'admin', 'admin@nexus.com', '$2b$12$...', 'admin', 'System', 'Administrator');
```

## 🔧 Database Management

### Connection Information
```bash
# Connection details
Host: postgres (Docker) / localhost (local)
Port: 5432
Database: nexus_db
Username: nexus_user
Password: nexus_password
```

### Common Operations
```bash
# Connect to database
psql -h localhost -U nexus_user -d nexus_db

# Backup database
pg_dump -h localhost -U nexus_user nexus_db > backup.sql

# Restore database
psql -h localhost -U nexus_user -d nexus_db < backup.sql

# Check table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(tablename::text)) as size
FROM pg_tables
WHERE schemaname = 'public';
```

### Maintenance Queries
```sql
-- Check database statistics
SELECT
  schemaname,
  tablename,
  n_tup_ins as inserts,
  n_tup_upd as updates,
  n_tup_del as deletes
FROM pg_stat_user_tables;

-- Find slow queries
SELECT query, mean_time, calls
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Check index usage
SELECT
  indexrelname,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes;
```

## 📊 Data Volume Estimates

### Expected Data Growth
- **Users**: 50-100 active users
- **Purchase Orders**: 1,000-5,000 per year
- **Travelers**: 10,000-50,000 per year
- **Labor Logs**: 100,000-500,000 per year
- **BOM Items**: 50,000-250,000 per year

### Storage Requirements
- **Base Schema**: ~10 MB
- **Per 1,000 Travelers**: ~50 MB
- **Per Year (10,000 travelers)**: ~500 MB
- **5-Year Estimate**: ~2.5 GB

## 🔒 Security

### Access Control
- **Row Level Security** - Future implementation
- **User Roles** - Database-level role management
- **Connection Security** - SSL/TLS encryption
- **Audit Trail** - Complete change tracking

### Backup Strategy
- **Daily Backups** - Automated nightly backups
- **Weekly Full Backups** - Complete database exports
- **Point-in-Time Recovery** - WAL archiving
- **Retention Policy** - 30 days daily, 12 weeks weekly

## 🛠️ Development

### Local Development
```bash
# Start PostgreSQL container
docker run -d \
  --name nexus-postgres \
  -e POSTGRES_DB=nexus_db \
  -e POSTGRES_USER=nexus_user \
  -e POSTGRES_PASSWORD=nexus_password \
  -p 5432:5432 \
  postgres:15

# Initialize schema
psql -h localhost -U nexus_user -d nexus_db -f 01-init.sql
```

### Schema Changes
1. Create migration script
2. Test on development data
3. Document breaking changes
4. Apply to staging environment
5. Deploy to production

## 📈 Performance Monitoring

### Key Metrics
- **Connection Pool Usage** - Active connections
- **Query Performance** - Slow query identification
- **Index Effectiveness** - Index hit ratios
- **Table Growth** - Data volume trends
- **Lock Contention** - Blocking queries

### Optimization Tips
- Regular VACUUM and ANALYZE
- Monitor index usage
- Partition large tables
- Optimize frequent queries
- Configure connection pooling

---

**Robust database foundation for manufacturing workflow management** 🗄️