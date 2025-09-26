# Database Migrations

This directory contains database migration files for the NEXUS application.

## Overview

Migrations are used to manage database schema changes over time. Each migration file contains SQL commands to modify the database structure.

## Migration Files

- `001_initial_schema.sql` - Initial database schema creation
- `002_add_indexes.sql` - Performance optimization indexes
- `003_add_audit_triggers.sql` - Audit trail triggers

## Running Migrations

Migrations are automatically applied when the Docker container starts via the `init-db` directory.

For manual migration management:

```bash
# Run specific migration
psql -U nexus_user -d nexus_db -f migrations/001_initial_schema.sql

# Check migration status
psql -U nexus_user -d nexus_db -c "SELECT * FROM migration_history;"
```

## Creating New Migrations

1. Create a new numbered SQL file
2. Add the migration commands
3. Test thoroughly in development
4. Document any breaking changes

## Best Practices

- Always backup before running migrations
- Test migrations on development data first
- Include rollback scripts when possible
- Document schema changes in comments