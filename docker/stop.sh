#!/bin/bash

# NEXUS - Stop Script
# American Circuits Traveler Management System

set -e

echo "🛑 Stopping NEXUS - American Circuits Traveler Management System"
echo "================================================================="

# Navigate to project root
cd "$(dirname "$0")/.."

# Stop services
echo "🔄 Stopping all NEXUS services..."
docker-compose down

echo "✅ All services stopped."

# Option to remove volumes (data)
if [ "$1" = "--remove-data" ]; then
    echo "⚠️  Removing all data volumes..."
    docker-compose down -v
    echo "🗑️  All data has been removed!"
    echo ""
    echo "⚠️  WARNING: This action cannot be undone!"
    echo "All travelers, users, and database data has been permanently deleted."
fi

echo ""
echo "NEXUS services have been stopped."
echo "To start again: ./docker/start.sh"
echo "To remove all data: ./docker/stop.sh --remove-data"