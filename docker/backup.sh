#!/bin/bash

# NEXUS - Backup Script
# American Circuits Traveler Management System

set -e

# Configuration
BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="nexus_backup_${DATE}.sql"

echo "💾 NEXUS Database Backup"
echo "========================"

# Create backup directory
mkdir -p $BACKUP_DIR

# Navigate to project root
cd "$(dirname "$0")/.."

# Check if containers are running
if ! docker-compose ps | grep -q "nexus_postgres"; then
    echo "❌ Database container is not running!"
    echo "Start NEXUS first: ./docker/start.sh"
    exit 1
fi

echo "📊 Creating database backup..."

# Create backup
docker exec nexus_postgres pg_dump -U nexus_user -h localhost nexus > "$BACKUP_DIR/$BACKUP_FILE"

# Compress backup
echo "🗜️  Compressing backup..."
gzip "$BACKUP_DIR/$BACKUP_FILE"

# Get file size
BACKUP_SIZE=$(du -h "$BACKUP_DIR/${BACKUP_FILE}.gz" | cut -f1)

echo "✅ Backup completed successfully!"
echo "📁 File: $BACKUP_DIR/${BACKUP_FILE}.gz"
echo "📏 Size: $BACKUP_SIZE"
echo ""

# Cleanup old backups (keep last 10)
echo "🧹 Cleaning up old backups (keeping last 10)..."
cd "$BACKUP_DIR"
ls -t nexus_backup_*.sql.gz | tail -n +11 | xargs -r rm

BACKUP_COUNT=$(ls nexus_backup_*.sql.gz 2>/dev/null | wc -l)
echo "📚 Total backups: $BACKUP_COUNT"

echo ""
echo "💾 Backup process complete!"
echo "To restore: ./docker/restore.sh $BACKUP_DIR/${BACKUP_FILE}.gz"