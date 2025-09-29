#!/bin/bash

# NEXUS - Restore Script
# American Circuits Traveler Management System

set -e

if [ -z "$1" ]; then
    echo "❌ Usage: $0 <backup_file.sql.gz>"
    echo ""
    echo "Available backups:"
    ls -la backups/nexus_backup_*.sql.gz 2>/dev/null || echo "No backups found"
    exit 1
fi

BACKUP_FILE=$1

echo "🔄 NEXUS Database Restore"
echo "========================="

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Navigate to project root
cd "$(dirname "$0")/.."

# Check if containers are running
if ! docker-compose ps | grep -q "nexus_postgres"; then
    echo "❌ Database container is not running!"
    echo "Start NEXUS first: ./docker/start.sh"
    exit 1
fi

echo "⚠️  WARNING: This will replace ALL existing data!"
echo "📁 Backup file: $BACKUP_FILE"
echo ""
read -p "Are you sure you want to continue? (yes/no): " -r
echo ""

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "❌ Restore cancelled."
    exit 1
fi

echo "🗜️  Decompressing backup..."
TEMP_SQL="/tmp/nexus_restore_$(date +%s).sql"

if [[ $BACKUP_FILE == *.gz ]]; then
    gunzip -c "$BACKUP_FILE" > "$TEMP_SQL"
else
    cp "$BACKUP_FILE" "$TEMP_SQL"
fi

echo "🛑 Stopping application services..."
docker-compose stop backend frontend nginx

echo "🗄️  Dropping existing database..."
docker exec nexus_postgres psql -U nexus_user -c "DROP DATABASE IF EXISTS nexus;"

echo "🆕 Creating new database..."
docker exec nexus_postgres psql -U nexus_user -c "CREATE DATABASE nexus;"

echo "📥 Restoring database..."
docker exec -i nexus_postgres psql -U nexus_user nexus < "$TEMP_SQL"

echo "🧹 Cleaning up temporary files..."
rm "$TEMP_SQL"

echo "🚀 Starting application services..."
docker-compose start backend frontend nginx

echo ""
echo "✅ Database restore completed successfully!"
echo "🌐 NEXUS is available at: http://localhost:5000"
echo ""
echo "⏱️  Services may take 30-60 seconds to fully restart."