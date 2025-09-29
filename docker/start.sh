#!/bin/bash

# NEXUS - Start Script
# American Circuits Traveler Management System

set -e

echo "🚀 Starting NEXUS - American Circuits Traveler Management System"
echo "=================================================================="

# Check if Docker and Docker Compose are installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Navigate to project root
cd "$(dirname "$0")/.."

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOL
# NEXUS Environment Configuration

# Database
POSTGRES_PASSWORD=nexus_production_password_change_this

# Backend
SECRET_KEY=your-super-secret-key-change-in-production-make-it-long-and-random
API_URL=http://localhost:5002

# Email Configuration
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Frontend
NODE_ENV=development
NEXT_PUBLIC_API_URL=http://localhost:5002
EOL
    echo "✅ Created .env file. Please update with your actual configuration."
fi

# Load environment variables
source .env

# Check if this is the first run
if [ "$1" = "init" ]; then
    echo "🔧 Initializing NEXUS for first time..."

    # Stop any existing containers
    echo "🛑 Stopping existing containers..."
    docker-compose down -v

    # Build and start services
    echo "🏗️  Building and starting services..."
    docker-compose up --build -d

    echo "⏳ Waiting for services to be ready..."
    sleep 30

    echo "🎯 Running database initialization..."
    # Run any additional initialization scripts here

    echo "✅ NEXUS initialization complete!"
else
    # Regular start
    echo "🏗️  Building and starting NEXUS services..."
    docker-compose up --build -d
fi

echo ""
echo "🌐 NEXUS is starting up..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📱 Frontend:  http://localhost:5000"
echo "🔧 Backend:   http://localhost:5002"
echo "🗄️  Database: localhost:5001"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⏱️  Services may take 30-60 seconds to fully start up."
echo "📊 Check status: docker-compose ps"
echo "📋 View logs:    docker-compose logs -f"
echo "🛑 Stop:         docker-compose down"
echo ""
echo "Default login credentials:"
echo "  Admin:      admin / nexus123"
echo "  Kris:       kris / nexus123"
echo "  Adam:       adam / nexus123"
echo "  Operator:   operator1 / nexus123"
echo ""
echo "🔐 Please change default passwords in production!"
echo ""

# Wait a moment for services to start
sleep 5

# Check if services are responding
echo "🏥 Checking service health..."
if curl -s http://localhost:5002/health > /dev/null; then
    echo "✅ Backend is healthy"
else
    echo "⚠️  Backend is still starting up..."
fi

if curl -s http://localhost:5000 > /dev/null 2>&1; then
    echo "✅ Frontend is healthy"
else
    echo "⚠️  Frontend is still starting up..."
fi

echo ""
echo "🎉 NEXUS startup complete!"
echo "Visit http://localhost:5000 to access the application"