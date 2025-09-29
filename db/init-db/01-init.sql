-- NEXUS Database Initialization Script
-- American Circuits Traveler Management System

-- Create the database if it doesn't exist
-- Note: This runs inside the already created 'nexus' database

-- Grant permissions to nexus_user
GRANT ALL PRIVILEGES ON DATABASE nexus TO nexus_user;
GRANT ALL PRIVILEGES ON SCHEMA public TO nexus_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO nexus_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO nexus_user;

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable row level security
ALTER DATABASE nexus SET row_security = on;

-- Set timezone
SET timezone = 'America/New_York';

-- Create indexes for better performance
-- Note: These will be created after tables are created by SQLAlchemy

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';