-- NEXUS Database Schema
-- Traveler Workflow & Documentation Enhancement System

-- Users table for authentication and role management
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'operator',
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Purchase Orders table
CREATE TABLE purchase_orders (
    id SERIAL PRIMARY KEY,
    po_number VARCHAR(50) UNIQUE NOT NULL,
    customer_name VARCHAR(100) NOT NULL,
    job_number VARCHAR(50),
    created_date DATE NOT NULL,
    due_date DATE,
    status VARCHAR(20) DEFAULT 'active',
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Traveler Types enum: PCB, Parts, Assembly, Cable
CREATE TABLE traveler_types (
    id SERIAL PRIMARY KEY,
    type_name VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    color_code VARCHAR(7) -- Hex color code for UI
);

-- Insert default traveler types
INSERT INTO traveler_types (type_name, description, color_code) VALUES
('PCB', 'Printed Circuit Board travelers', '#3B82F6'),
('Parts', 'Parts procurement and kitting', '#10B981'),
('Assembly', 'Assembly process tracking', '#F59E0B'),
('Cable', 'Cable manufacturing and testing', '#8B5CF6');

-- Travelers table (main document)
CREATE TABLE travelers (
    id SERIAL PRIMARY KEY,
    traveler_number VARCHAR(50) UNIQUE NOT NULL,
    po_id INTEGER REFERENCES purchase_orders(id),
    traveler_type_id INTEGER REFERENCES traveler_types(id),
    job_number VARCHAR(50),
    barcode VARCHAR(100) UNIQUE,
    status VARCHAR(20) DEFAULT 'created',
    revision INTEGER DEFAULT 1,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- BOM (Bill of Materials) table
CREATE TABLE bom_items (
    id SERIAL PRIMARY KEY,
    traveler_id INTEGER REFERENCES travelers(id),
    part_number VARCHAR(100) NOT NULL,
    description TEXT,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2),
    supplier VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Process sequences (manufacturing steps)
CREATE TABLE process_sequences (
    id SERIAL PRIMARY KEY,
    traveler_id INTEGER REFERENCES travelers(id),
    step_number INTEGER NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    description TEXT,
    estimated_hours DECIMAL(5,2),
    required_role VARCHAR(50),
    is_completed BOOLEAN DEFAULT FALSE,
    completed_by INTEGER REFERENCES users(id),
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Labor tracking
CREATE TABLE labor_logs (
    id SERIAL PRIMARY KEY,
    traveler_id INTEGER REFERENCES travelers(id),
    process_step_id INTEGER REFERENCES process_sequences(id),
    user_id INTEGER REFERENCES users(id),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    hours_logged DECIMAL(5,2),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Coating process tracking
CREATE TABLE coating_logs (
    id SERIAL PRIMARY KEY,
    traveler_id INTEGER REFERENCES travelers(id),
    coating_type VARCHAR(50),
    sent_date DATE,
    received_date DATE,
    inspected_date DATE,
    tracking_number VARCHAR(100),
    status VARCHAR(20) DEFAULT 'sent',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Revision history
CREATE TABLE revision_history (
    id SERIAL PRIMARY KEY,
    traveler_id INTEGER REFERENCES travelers(id),
    revision_number INTEGER NOT NULL,
    change_description TEXT,
    changed_by INTEGER REFERENCES users(id),
    change_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    change_reason VARCHAR(100)
);

-- Packing slips
CREATE TABLE packing_slips (
    id SERIAL PRIMARY KEY,
    traveler_id INTEGER REFERENCES travelers(id),
    ship_to_address TEXT,
    ship_date DATE,
    tracking_number VARCHAR(100),
    carrier VARCHAR(50),
    kitting_confirmation BOOLEAN DEFAULT FALSE,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Checklists (PCB, parts, stencil, tools, glue)
CREATE TABLE checklists (
    id SERIAL PRIMARY KEY,
    traveler_id INTEGER REFERENCES travelers(id),
    checklist_type VARCHAR(50) NOT NULL,
    item_name VARCHAR(100) NOT NULL,
    is_checked BOOLEAN DEFAULT FALSE,
    checked_by INTEGER REFERENCES users(id),
    checked_at TIMESTAMP,
    notes TEXT
);

-- Instructions (typed or written)
CREATE TABLE instructions (
    id SERIAL PRIMARY KEY,
    traveler_id INTEGER REFERENCES travelers(id),
    instruction_type VARCHAR(20) NOT NULL, -- 'typed' or 'written'
    content TEXT,
    image_url VARCHAR(255), -- for written/scanned instructions
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PCB images and documentation
CREATE TABLE pcb_images (
    id SERIAL PRIMARY KEY,
    traveler_id INTEGER REFERENCES travelers(id),
    image_type VARCHAR(50), -- 'customer_drawing', 'revision', 'reference'
    image_url VARCHAR(255) NOT NULL,
    description TEXT,
    revision_version VARCHAR(20),
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_travelers_po_id ON travelers(po_id);
CREATE INDEX idx_travelers_barcode ON travelers(barcode);
CREATE INDEX idx_travelers_status ON travelers(status);
CREATE INDEX idx_bom_items_traveler_id ON bom_items(traveler_id);
CREATE INDEX idx_process_sequences_traveler_id ON process_sequences(traveler_id);
CREATE INDEX idx_labor_logs_traveler_id ON labor_logs(traveler_id);
CREATE INDEX idx_labor_logs_user_id ON labor_logs(user_id);

-- Create default admin user (password: admin123)
INSERT INTO users (username, email, password_hash, role, first_name, last_name) VALUES
('admin', 'admin@nexus.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqyqw3ryHRkIjjO5.YjKTKK', 'admin', 'System', 'Administrator');

-- Insert sample data for testing
INSERT INTO purchase_orders (po_number, customer_name, job_number, created_date, created_by) VALUES
('PO-2024-001', 'Tech Solutions Inc', 'JOB-001', CURRENT_DATE, 1),
('PO-2024-002', 'Advanced Electronics', 'JOB-002', CURRENT_DATE, 1);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_travelers_updated_at BEFORE UPDATE ON travelers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();