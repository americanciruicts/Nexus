# 🚀 NEXUS Deployment Guide

## NEXUS - American Circuits Traveler Management System

### 📊 Port Configuration (3000 Series)
- **3000**: Main Application (Nginx)
- **3001**: PostgreSQL Database
- **3002**: FastAPI Backend
- **3003**: Next.js Frontend

---

## 🔧 Prerequisites

1. **Docker Desktop** must be running
   - Download from: https://www.docker.com/products/docker-desktop
   - Make sure it's started and running

2. **System Requirements**
   - Windows 10/11 or macOS or Linux
   - 4GB RAM minimum (8GB recommended)
   - 2GB available disk space

---

## 🚀 Quick Start

### Option 1: Using Docker (Recommended)

1. **Start Docker Desktop**
   - Open Docker Desktop application
   - Wait for it to be fully running

2. **Build and Start NEXUS**
   ```bash
   # Navigate to project directory
   cd C:\Users\admin\Documents\GitHub\Nexus

   # Start the system
   docker-compose up --build -d
   ```

3. **Access the Application**
   - **Main Application**: http://localhost:3000
   - **Backend API**: http://localhost:3002
   - **Database**: localhost:3001

### Option 2: Development Mode

If Docker Desktop is not available, you can run in development mode:

1. **Backend (Terminal 1)**
   ```bash
   cd backend
   pip install -r requirements.txt
   uvicorn main:app --reload --host 0.0.0.0 --port 3002
   ```

2. **Frontend (Terminal 2)**
   ```bash
   cd frontend
   npm install
   npm run dev -- --port 3003
   ```

3. **Database** (separate PostgreSQL installation required)

---

## 👥 Default Login Credentials

| Role | Username | Password |
|------|----------|----------|
| Admin | admin | nexus123 |
| Approver | kris | nexus123 |
| Approver | adam | nexus123 |
| Operator | operator1 | nexus123 |

**⚠️ Change these passwords in production!**

---

## 🛠️ Troubleshooting

### Docker Desktop Not Running
```bash
# Error: "The system cannot find the file specified"
# Solution: Start Docker Desktop application
```

### Port Already in Use
```bash
# Stop any running containers
docker-compose down

# Check what's using the port
netstat -an | findstr :3000
```

### Database Connection Issues
```bash
# Reset database volume
docker-compose down -v
docker-compose up --build
```

---

## 📋 Features Checklist

✅ **Traveler Management**
- Create new travelers with barcode generation
- Auto-population from job/work order numbers
- Manufacturing process steps by traveler type

✅ **Approval System**
- Kris and Adam approval workflow
- Email notifications
- Complete audit trail

✅ **Labor Tracking**
- Start/stop time tracking
- Labor summary and statistics
- Traveler-specific time entries

✅ **Barcode Integration**
- Unique barcode for each traveler
- QR code scanning capability
- Barcode scanner in header

✅ **Manufacturing Process**
- PCB, ASSY, Cable, Cable Assembly workflows
- Sub-step breakdown
- Manual step additions

---

## 🔧 System Architecture

```
┌─────────────────────┐
│   Nginx (3000)      │ ← Main Entry Point
└─────────────────────┘
         │
    ┌─────────────────────────┐
    │                         │
┌─────────────────────┐   ┌─────────────────────┐
│ Frontend (3003)     │   │  Backend (3002)     │
│ Next.js             │   │  FastAPI            │
└─────────────────────┘   └─────────────────────┘
                                   │
                          ┌─────────────────────┐
                          │ PostgreSQL (3001)   │
                          │ Database            │
                          └─────────────────────┘
```

---

## 📱 Application Features

### Main Dashboard
- Quick access to create new travelers
- Recent activity feed
- Summary statistics

### Traveler Form (Image.jpg Layout)
- Two-column layout matching reference
- Job information section
- Routing table with steps
- Barcode/QR code integration

### Labor Tracking
- Active timer display
- Recent entries history
- Weekly summary statistics

### Approval Workflow
- Email notifications to Kris and Adam
- Approval history tracking
- User edit permissions

---

## 🔒 Security Features

- JWT-based authentication
- Role-based access control
- Complete audit logging
- User action tracking
- Secure password hashing

---

## 📧 Email Configuration (Optional)

Update `.env` file for email notifications:

```bash
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@company.com
SMTP_PASSWORD=your-app-password
```

---

## 🎯 Next Steps

1. **Start Docker Desktop**
2. **Run**: `docker-compose up --build -d`
3. **Visit**: http://localhost:3000
4. **Login**: admin / nexus123
5. **Create your first traveler!**

---

**🏭 Built for American Circuits Manufacturing Excellence**

*NEXUS - Your complete traveler management solution*