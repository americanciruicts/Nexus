# NEXUS - Traveler Workflow & Documentation Enhancement System

NEXUS is a comprehensive web application designed to streamline PCB manufacturing processes through standardized traveler templates, barcode tracking, and comprehensive documentation management.

## 🌟 Features

- **Standardized Traveler Templates** - PCB, Parts, Assembly, and Cable workflows
- **Barcode-based Tracking System** - Real-time process monitoring
- **BOM Integration** - Direct bill of materials integration
- **Labor Timing Tracking** - Process step timing and efficiency monitoring
- **Coating Process Management** - Track coating workflows from send to inspection
- **Revision History** - Complete audit trail of all changes
- **Role-based Access Control** - Admin, Manager, Operator, Quality, etc.
- **Comprehensive Reporting** - Dashboard analytics and export capabilities
- **Color-coded Organization** - Visual identification by traveler type

## 🏗️ Architecture

### Tech Stack
- **Frontend**: Next.js 14 with TypeScript and Tailwind CSS
- **Backend**: Python FastAPI with SQLAlchemy
- **Database**: PostgreSQL 15
- **Reverse Proxy**: Nginx
- **Containerization**: Docker & Docker Compose

### Project Structure
```
nexus/
├── nexus-app/                 # Next.js Frontend
│   ├── src/
│   │   ├── app/              # App Router pages
│   │   ├── components/       # React components
│   │   ├── hooks/            # Custom React hooks
│   │   ├── lib/              # Utility libraries
│   │   ├── services/         # API service layer
│   │   ├── types/            # TypeScript type definitions
│   │   └── utils/            # Helper functions
│   ├── public/               # Static assets
│   └── Dockerfile
├── backend/                   # Python FastAPI Backend
│   ├── routers/              # API route handlers
│   ├── schemas/              # Pydantic schemas
│   ├── services/             # Business logic
│   ├── utils/                # Helper utilities
│   ├── tests/                # Unit tests
│   ├── migrations/           # Database migrations
│   ├── static/               # Static file uploads
│   ├── models.py             # SQLAlchemy models
│   ├── database.py           # Database configuration
│   ├── main.py               # FastAPI application
│   ├── requirements.txt      # Python dependencies
│   └── Dockerfile
├── nginx/                     # Nginx configuration
│   ├── nginx.conf
│   └── default.conf
├── init-db/                   # Database initialization
│   └── 01-init.sql
├── docker-compose.yml         # Container orchestration
└── README.md
```

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/nexus.git
   cd nexus
   ```

2. **Start the application**
   ```bash
   docker-compose up --build
   ```

3. **Access the application**
   - Main Application: http://localhost:4000
   - API Documentation: http://localhost:4000/api/docs
   - API Health Check: http://localhost:4000/api/health

### Default Login
- **Username**: admin
- **Password**: admin123

## 📊 Database Schema

The system includes comprehensive data models for:

- **Users & Authentication** - Role-based access control
- **Purchase Orders** - Customer order management
- **Travelers** - Main workflow documents
- **Traveler Types** - PCB, Parts, Assembly, Cable templates
- **BOM Items** - Bill of materials integration
- **Process Sequences** - Manufacturing step definitions
- **Labor Logs** - Time tracking per process step
- **Coating Logs** - External coating process tracking
- **Revision History** - Complete change audit trail
- **Checklists** - Quality control checkpoints
- **Instructions** - Typed and written work instructions
- **PCB Images** - Customer drawings and documentation

## 🔧 Development

### Frontend Development
```bash
cd nexus-app
npm install
npm run dev
```

### Backend Development
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Database Management
The PostgreSQL database is automatically initialized with the schema defined in `init-db/01-init.sql`.

## 🌐 API Endpoints

### Authentication
- `POST /auth/login` - User authentication
- `GET /auth/me` - Get current user profile

### Travelers
- `GET /travelers/` - List all travelers
- `POST /travelers/` - Create new traveler
- `GET /travelers/{id}` - Get traveler details
- `GET /travelers/types/` - Get traveler types

### Reports
- `GET /reports/dashboard-stats` - Dashboard statistics
- `GET /reports/traveler-completion` - Completion reports
- `GET /reports/labor-efficiency` - Labor efficiency metrics
- `GET /reports/coating-status` - Coating process status

### Users
- `GET /users/` - List users (admin/manager only)
- `POST /users/` - Create user (admin only)

## 🔒 Security Features

- JWT-based authentication
- Role-based access control
- SQL injection protection via SQLAlchemy ORM
- CORS configuration
- Input validation with Pydantic

## 📈 Business Value

NEXUS addresses key manufacturing challenges:

- **Traceability** - Complete audit trail from order to shipment
- **Efficiency** - Standardized processes reduce errors and training time
- **Compliance** - Built-in documentation and approval workflows
- **Scalability** - Handles 5,000+ active jobs with 99% uptime target

## 🎯 User Roles

- **Admin** - Full system access and user management
- **Manager** - Process oversight and reporting
- **Traveler Creator (Praful)** - Create and manage travelers
- **Quality (Abhishek)** - Quality control and approvals
- **Purchasing** - Parts procurement and BOM management
- **Assembly (Kris)** - Assembly operations and time logging
- **Engineer (Adam)** - Technical approvals and revisions

## 📝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

This project is proprietary software. All rights reserved.

## 🤝 Support

For technical support or questions:
- Create an issue in this repository
- Contact the development team
- Check the API documentation at `/api/docs`

## 🔄 Version History

- **v1.0.0** - Initial release with core traveler management
- **v1.1.0** - Added barcode generation and scanning
- **v1.2.0** - Enhanced reporting and dashboard features
- **v2.0.0** - Complete UI redesign and mobile responsiveness

---

**Built with ❤️ for efficient PCB manufacturing workflows**