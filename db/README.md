# NEXUS Database

PostgreSQL database configuration and schema for the NEXUS Traveler Management System.

## Database Configuration

- **Engine**: PostgreSQL 15-Alpine
- **Port**: 5001 (external), 5432 (internal)
- **Database**: nexus
- **User**: nexus_user
- **Password**: nexus_password (change in production)

## Schema Overview

The database contains the following main tables:

### Core Tables

- **users**: User management and authentication
- **travelers**: Main traveler records
- **work_centers**: Manufacturing work centers
- **parts**: Part definitions and revisions
- **process_steps**: Manufacturing process definitions
- **sub_steps**: Detailed step breakdowns

### Workflow Tables

- **approvals**: Approval workflow tracking
- **labor_entries**: Time tracking for labor hours
- **audit_logs**: Complete change history
- **manual_steps**: User-added process steps

### Reference Tables

- **work_orders**: Work order definitions and auto-population data
- **revisions**: Part revision management
- **customers**: Customer information

## Key Features

### Audit Logging

Every change to critical data is logged with:
- User information
- Timestamp
- Field changed
- Old and new values
- IP address and user agent

### Approval Workflow

Changes requiring approval are tracked through:
- Request creation
- Approver notification
- Approval/rejection status
- Audit trail

### Data Integrity

- Foreign key constraints
- Check constraints for valid values
- Unique constraints where appropriate
- NOT NULL constraints for required fields

## Initialization

Database initialization scripts are in `/docker-entrypoint-initdb.d/`:

- `01-init.sql`: Initial schema and data
- `02-seed-data.sql`: Sample data for development

## Migrations

Database schema changes are managed through Alembic:

```bash
# Generate migration
alembic revision --autogenerate -m "Description"

# Apply migrations
alembic upgrade head

# View migration history
alembic history
```

## Backup and Recovery

```bash
# Backup database
docker exec nexus_postgres pg_dump -U nexus_user nexus > backup.sql

# Restore database
docker exec -i nexus_postgres psql -U nexus_user nexus < backup.sql
```

## Performance Considerations

- Indexes on frequently queried columns
- Partitioning for large audit log tables
- Connection pooling in application layer
- Regular VACUUM and ANALYZE operations

## Security

- Database user with limited privileges
- Network isolation within Docker
- Encrypted connections (can be configured)
- Regular security updates via Alpine base image