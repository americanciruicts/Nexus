@echo off
echo ==========================================
echo  NEXUS - American Circuits
echo  Traveler Management System
echo ==========================================
echo.

echo Starting PostgreSQL Database...
docker-compose up postgres -d

echo Waiting for database to be ready...
timeout /t 5 /nobreak > nul

echo.
echo ==========================================
echo  NEXUS System Status
echo ==========================================
echo  Database: http://localhost:3001
echo  Frontend: Install Node.js and run manually
echo  Backend:  Install Python and run manually
echo ==========================================
echo.

echo To access the system manually:
echo.
echo 1. Frontend (Terminal 1):
echo    cd frontend
echo    npm install
echo    npm run dev -- --port 3003
echo.
echo 2. Backend (Terminal 2):
echo    cd backend
echo    pip install -r requirements.txt
echo    uvicorn main:app --reload --host 0.0.0.0 --port 3002
echo.
echo 3. Open browser: http://localhost:3003
echo.
echo Default Login: admin / nexus123
echo.
pause