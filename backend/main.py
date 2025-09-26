from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import os
from database import get_db, engine
import models
from routers import auth, travelers, users, reports

models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="NEXUS API",
    description="Traveler Workflow & Documentation Enhancement System",
    version="1.0.0"
)

# Configure CORS
origins = [
    "http://localhost:3000",
    "http://frontend:3000",
    "http://localhost",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/auth", tags=["authentication"])
app.include_router(users.router, prefix="/users", tags=["users"])
app.include_router(travelers.router, prefix="/travelers", tags=["travelers"])
app.include_router(reports.router, prefix="/reports", tags=["reports"])

@app.get("/")
async def root():
    return {"message": "NEXUS API - Traveler Workflow & Documentation Enhancement System"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "NEXUS API"}