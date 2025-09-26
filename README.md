# NEXUS - Traveler Workflow & Documentation Enhancement System

A comprehensive web application designed to streamline PCB manufacturing processes through standardized traveler templates, barcode tracking, and comprehensive documentation management.

## 🌟 Features

- **Standardized Traveler Templates** - PCB, Parts, Assembly, and Cable workflows
- **Barcode-based Tracking System** - Real-time process monitoring with generated barcodes
- **BOM Integration** - Direct bill of materials integration and management
- **Labor Timing Tracking** - Process step timing and efficiency monitoring
- **Coating Process Management** - Track coating workflows from send to inspection
- **Revision History** - Complete audit trail of all changes and updates
- **Role-based Access Control** - Admin, Manager, Operator, Quality, Engineer roles
- **Comprehensive Reporting** - Dashboard analytics and export capabilities
- **Color-coded Organization** - Visual identification by traveler type
- **Mobile Responsive** - Works on desktop, tablet, and mobile devices

## 🏗️ Architecture

### Tech Stack
- **Frontend**: Next.js 14 with TypeScript and Tailwind CSS
- **Backend**: Python FastAPI with SQLAlchemy ORM
- **Database**: PostgreSQL 15 with comprehensive indexing
- **Reverse Proxy**: Nginx for load balancing and SSL
- **Containerization**: Docker & Docker Compose for easy deployment
- **Authentication**: JWT-based with role-based access control

### High-Level Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│                 │    │                 │    │                 │
│   Next.js       │    │   FastAPI       │    │   PostgreSQL    │
│   Frontend      │◄──►│   Backend       │◄──►│   Database      │
│   (Port 3000)   │    │   (Port 8000)   │    │   (Port 5432)   │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         ▲                        ▲                        ▲
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
                     ┌─────────────────┐
                     │                 │
                     │     Nginx       │
                     │  Reverse Proxy  │
                     │   (Port 4000)   │
                     │                 │
                     └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- Git

### Installation & Setup

1. **Clone the Repository**
   ```bash
   git clone https://github.com/your-org/nexus.git
   cd nexus
   ```

2. **Start the Application**
   ```bash
   docker-compose up --build
   ```

3. **Access the Application**
   - **Main Application**: http://localhost:4000
   - **API Documentation**: http://localhost:4000/api/docs
   - **API Health Check**: http://localhost:4000/api/health

4. **Default Login Credentials**
   - **Username**: `admin`
   - **Password**: `admin123`

### Project Structure
```
nexus/
├── nexus-app/                 # Next.js Frontend Application
│   ├── src/
│   │   ├── app/              # Next.js App Router pages
│   │   ├── components/       # Reusable React components
│   │   ├── hooks/            # Custom React hooks
│   │   ├── lib/              # Utility libraries & auth
│   │   ├── services/         # API service layer
│   │   ├── types/            # TypeScript type definitions
│   │   └── utils/            # Helper functions & constants
│   ├── public/               # Static assets (logo, images)
│   ├── README.md             # Frontend documentation
│   ├── .env.local            # Frontend environment variables
│   └── Dockerfile            # Frontend container config
│
├── backend/                   # Python FastAPI Backend
│   ├── routers/              # API route handlers
│   ├── schemas/              # Pydantic data validation schemas
│   ├── services/             # Business logic services
│   ├── utils/                # Utility functions (barcode, etc.)
│   ├── tests/                # Unit and integration tests
│   ├── migrations/           # Database migration scripts
│   ├── static/uploads/       # File upload storage
│   ├── models.py             # SQLAlchemy database models
│   ├── database.py           # Database configuration
│   ├── main.py               # FastAPI application entry point
│   ├── README.md             # Backend documentation
│   ├── .env                  # Backend environment variables
│   ├── requirements.txt      # Python dependencies
│   └── Dockerfile            # Backend container config
│
├── nginx/                     # Nginx Reverse Proxy
│   ├── nginx.conf            # Main nginx configuration
│   └── default.conf          # Default server configuration
│
├── init-db/                   # Database Initialization
│   ├── 01-init.sql          # Initial database schema
│   └── README.md             # Database documentation
│
├── docker-compose.yml         # Container orchestration
└── README.md                  # This file
```

## 📊 Core Functionality

### Traveler Management
- **Create Travelers** - Generate standardized PCB, Parts, Assembly, or Cable travelers
- **Barcode Generation** - Automatic barcode creation for tracking
- **Status Tracking** - Real-time status updates (Created, In Progress, Completed)
- **Revision Control** - Version management with complete history
- **Template Standardization** - Consistent formats across all traveler types

### Process Management
- **BOM Integration** - Import and manage bill of materials
- **Process Sequences** - Define and track manufacturing steps
- **Labor Tracking** - Time logging for each process step
- **Quality Checkpoints** - Built-in quality control checklists
- **Coating Workflows** - External coating process management

### Reporting & Analytics
- **Dashboard Analytics** - Real-time metrics and KPIs
- **Completion Reports** - Traveler completion rates by type
- **Labor Efficiency** - Time tracking and productivity metrics
- **Coating Status** - External process tracking
- **Export Capabilities** - CSV, PDF, and custom report generation

## 🔐 User Roles & Permissions

### Role Hierarchy
- **Admin** - Full system access, user management, system configuration
- **Manager** - Process oversight, reporting, user supervision
- **Traveler Creator (Praful)** - Create and manage travelers, enter job details
- **Quality (Abhishek)** - Quality control, process approval, inspection logging
- **Purchasing** - Parts procurement, BOM management, supplier coordination
- **Assembly (Kris)** - Assembly operations, time logging, process completion
- **Engineer (Adam)** - Technical approvals, revisions, first article inspection

### Permission Matrix
| Feature | Admin | Manager | Creator | Quality | Purchasing | Assembly | Engineer |
|---------|-------|---------|---------|---------|------------|----------|----------|
| Create Users | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Create Travelers | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Update BOM | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| Log Labor | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ |
| Quality Approval | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| View Reports | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 🛠️ Development

### Local Development Setup

#### Frontend Development
```bash
cd nexus-app
npm install
npm run dev
# Runs on http://localhost:3000
```

#### Backend Development
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
# API docs at http://localhost:8000/docs
```

#### Database Setup
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
psql -h localhost -U nexus_user -d nexus_db -f init-db/01-init.sql
```

### Testing

#### Backend Tests
```bash
cd backend
pytest tests/ -v
pytest --cov=. tests/  # With coverage
```

#### Frontend Tests
```bash
cd nexus-app
npm test
npm run test:coverage
```

## 🔧 Configuration

### Environment Variables

#### Frontend (.env.local)
```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_APP_NAME=NEXUS
NEXT_PUBLIC_APP_VERSION=1.0.0
```

#### Backend (.env)
```env
DATABASE_URL=postgresql://nexus_user:nexus_password@postgres:5432/nexus_db
JWT_SECRET=your_secure_jwt_secret_key
CORS_ORIGINS=http://localhost:4000,http://frontend:3000
ENVIRONMENT=development
```

### Docker Configuration
The application uses Docker Compose for easy deployment:
- **Frontend**: Next.js on port 3000 (internal)
- **Backend**: FastAPI on port 8000 (internal)
- **Database**: PostgreSQL on port 5432 (internal)
- **Nginx**: Reverse proxy on port 4000 (external)

## 📈 Business Value

### Key Benefits
- **Traceability** - Complete audit trail from order to shipment
- **Efficiency** - Standardized processes reduce errors and training time
- **Compliance** - Built-in documentation and approval workflows
- **Scalability** - Designed to handle 5,000+ active jobs with 99% uptime target
- **Cost Reduction** - Decreased manual re-entry and error rates
- **Quality Improvement** - Consistent processes and quality checkpoints

### Success Metrics
- **95%+ Completion Rate** - Target for traveler completion within timeframes
- **50% Reduction** in manual re-entry errors
- **30% Improvement** in process efficiency
- **99% System Uptime** - High availability target
- **<3 Second Response Time** - Performance target for traveler generation

## 🔒 Security

### Security Features
- **JWT Authentication** - Secure token-based authentication
- **Role-Based Access Control** - Granular permissions by user role
- **SQL Injection Protection** - SQLAlchemy ORM prevents injection attacks
- **CORS Configuration** - Controlled cross-origin resource sharing
- **Input Validation** - Pydantic schemas validate all API inputs
- **Password Hashing** - Bcrypt for secure password storage

### Data Protection
- **Audit Trails** - Complete change history for all records
- **Backup Strategy** - Automated daily and weekly database backups
- **SSL/TLS** - Encrypted communication in production
- **Access Logging** - Comprehensive request and action logging

## 🚀 Production Deployment

### Docker Production
```bash
# Production deployment
docker-compose -f docker-compose.prod.yml up -d

# With SSL/TLS
docker-compose -f docker-compose.prod.yml -f docker-compose.ssl.yml up -d
```

### Performance Optimization
- **Database Indexing** - Optimized queries for large datasets
- **Connection Pooling** - SQLAlchemy connection pooling
- **Caching** - Redis caching for frequent queries
- **CDN Integration** - Static asset delivery optimization
- **Load Balancing** - Nginx-based load balancing

## 📚 Documentation

### Component Documentation
- **[Frontend README](nexus-app/README.md)** - Next.js application details
- **[Backend README](backend/README.md)** - FastAPI service documentation
- **[Database README](init-db/README.md)** - Database schema and management

### API Documentation
- **Interactive API Docs**: http://localhost:4000/api/docs
- **OpenAPI Specification**: http://localhost:4000/api/openapi.json
- **ReDoc Documentation**: http://localhost:4000/api/redoc

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes and add tests
4. Ensure all tests pass (`npm test` and `pytest`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Code Standards
- **Frontend**: ESLint + Prettier for TypeScript/React
- **Backend**: Black + isort for Python formatting
- **Commits**: Conventional commit messages
- **Testing**: Minimum 80% code coverage required

## 📞 Support

### Getting Help
- **Issues**: Create an issue in this repository
- **Documentation**: Check component-specific README files
- **API Reference**: Visit `/api/docs` for interactive documentation

### Troubleshooting
- **Connection Issues**: Check Docker container status
- **Database Issues**: Verify PostgreSQL connection and schema
- **Authentication Issues**: Check JWT token validity and user roles
- **Performance Issues**: Monitor database queries and API response times

## 📄 License

This project is proprietary software. All rights reserved.

## 🔄 Version History

- **v1.0.0** - Initial release with core traveler management
- **v1.1.0** - Added barcode generation and scanning capabilities
- **v1.2.0** - Enhanced reporting and dashboard features
- **v2.0.0** - Complete UI redesign and mobile responsiveness

---

**Built with ❤️ for efficient PCB manufacturing workflows**

*NEXUS - Connecting processes, enhancing productivity, ensuring quality* 🔗