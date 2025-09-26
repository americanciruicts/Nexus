# NEXUS Backend API

FastAPI-based backend service for the NEXUS Traveler Workflow & Documentation Enhancement System.

## 🏗️ Architecture

### Tech Stack
- **Framework**: FastAPI 0.104.1
- **Database ORM**: SQLAlchemy 2.0.23
- **Database**: PostgreSQL 15
- **Authentication**: JWT with PassLib
- **Validation**: Pydantic 2.5.0
- **Documentation**: OpenAPI/Swagger
- **Testing**: Pytest

### Project Structure
```
backend/
├── routers/           # API route handlers
│   ├── auth.py       # Authentication endpoints
│   ├── travelers.py  # Traveler management
│   ├── users.py      # User management
│   └── reports.py    # Reporting endpoints
├── schemas/          # Pydantic data models
│   ├── user_schemas.py
│   └── traveler_schemas.py
├── services/         # Business logic layer
│   ├── user_service.py
│   └── traveler_service.py
├── utils/            # Utility functions
│   ├── barcode_generator.py
│   └── traveler_utils.py
├── tests/            # Unit tests
├── migrations/       # Database migrations
├── static/uploads/   # File uploads
├── models.py         # SQLAlchemy models
├── database.py       # Database configuration
├── main.py           # FastAPI application
└── requirements.txt  # Python dependencies
```

## 🚀 Quick Start

### Development Setup

1. **Install Dependencies**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Environment Variables**
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Start Development Server**
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

4. **Access API Documentation**
   - Swagger UI: http://localhost:8000/docs
   - ReDoc: http://localhost:8000/redoc

### Docker Development

```bash
# Build and run with Docker
docker build -t nexus-backend .
docker run -p 8000:8000 nexus-backend

# Or use docker-compose
docker-compose up backend
```

## 📊 Database Models

### Core Models

- **User** - Authentication and role management
- **PurchaseOrder** - Customer orders
- **TravelerType** - PCB, Parts, Assembly, Cable
- **Traveler** - Main workflow document
- **BOMItem** - Bill of materials
- **ProcessSequence** - Manufacturing steps
- **LaborLog** - Time tracking
- **CoatingLog** - Coating process tracking
- **RevisionHistory** - Change audit trail

### Relationships

```
PurchaseOrder (1) → (N) Traveler
TravelerType (1) → (N) Traveler
Traveler (1) → (N) BOMItem
Traveler (1) → (N) ProcessSequence
Traveler (1) → (N) LaborLog
User (1) → (N) Traveler (created_by)
```

## 🔌 API Endpoints

### Authentication
```
POST /auth/login          # User login
GET  /auth/me            # Current user profile
```

### Travelers
```
GET    /travelers/           # List travelers
POST   /travelers/           # Create traveler
GET    /travelers/{id}       # Get traveler details
POST   /travelers/{id}/bom   # Add BOM item
GET    /travelers/types/     # Get traveler types
```

### Users
```
GET    /users/              # List users (admin/manager)
POST   /users/              # Create user (admin)
GET    /users/{id}          # Get user details
```

### Reports
```
GET /reports/dashboard-stats        # Dashboard statistics
GET /reports/traveler-completion    # Completion reports
GET /reports/labor-efficiency       # Labor metrics
GET /reports/coating-status         # Coating status
```

## 🔒 Authentication & Authorization

### JWT Token Authentication
```python
# Login to get token
POST /auth/login
{
  "username": "admin",
  "password": "admin123"
}

# Use token in headers
Authorization: Bearer <jwt_token>
```

### Role-Based Access Control
- **admin** - Full system access
- **manager** - Process oversight and reporting
- **operator** - Traveler creation and updates
- **quality** - Quality control functions
- **purchasing** - BOM and procurement
- **assembly** - Assembly operations
- **engineer** - Technical approvals

## 🛠️ Development

### Adding New Endpoints

1. **Create Schema** (schemas/new_schema.py)
   ```python
   class NewItemCreate(BaseModel):
       name: str
       description: Optional[str] = None
   ```

2. **Add Model** (models.py)
   ```python
   class NewItem(Base):
       __tablename__ = "new_items"
       id = Column(Integer, primary_key=True)
       name = Column(String(100), nullable=False)
   ```

3. **Create Router** (routers/new_router.py)
   ```python
   @router.post("/", response_model=NewItemSchema)
   async def create_item(item: NewItemCreate, db: Session = Depends(get_db)):
       # Implementation
   ```

4. **Include Router** (main.py)
   ```python
   app.include_router(new_router, prefix="/new-items", tags=["new-items"])
   ```

### Database Migrations

```bash
# Create migration
alembic revision --autogenerate -m "Add new table"

# Run migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

### Testing

```bash
# Run all tests
pytest

# Run specific test file
pytest tests/test_travelers.py

# Run with coverage
pytest --cov=. tests/
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `JWT_SECRET` | JWT signing secret | Required |
| `CORS_ORIGINS` | Allowed CORS origins | `*` |
| `ENVIRONMENT` | Environment (dev/staging/prod) | `development` |

### Database Configuration

```python
# database.py
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
```

## 📈 Performance

### Optimization Features
- **Connection Pooling** - SQLAlchemy connection pools
- **Query Optimization** - Indexed database queries
- **Pagination** - Limit/offset for large datasets
- **Caching** - Redis caching for frequent queries
- **Async Support** - FastAPI async/await patterns

### Monitoring
- **Health Checks** - `/health` endpoint
- **Metrics** - Request/response metrics
- **Logging** - Structured JSON logging
- **Error Tracking** - Exception monitoring

## 🐛 Debugging

### Common Issues

1. **Database Connection**
   ```bash
   # Check database connectivity
   psql -h localhost -U nexus_user -d nexus_db
   ```

2. **JWT Token Issues**
   ```python
   # Verify token in Python
   from jose import jwt
   payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
   ```

3. **CORS Errors**
   ```python
   # Update CORS settings in main.py
   app.add_middleware(
       CORSMiddleware,
       allow_origins=["http://localhost:3000"],
       allow_credentials=True,
       allow_methods=["*"],
       allow_headers=["*"],
   )
   ```

### Logging

```python
import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

logger.info("Processing traveler creation")
logger.error("Failed to create traveler", exc_info=True)
```

## 🚀 Production Deployment

### Docker Production

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Environment Setup

```bash
# Production environment variables
DATABASE_URL=postgresql://user:pass@prod-db:5432/nexus_db
JWT_SECRET=super_secure_secret_key_for_production
ENVIRONMENT=production
```

## 📚 API Documentation

The API is fully documented using OpenAPI/Swagger:
- Interactive docs: `/docs`
- OpenAPI JSON: `/openapi.json`
- ReDoc: `/redoc`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

---

**Backend API for efficient PCB manufacturing workflows** 🔧