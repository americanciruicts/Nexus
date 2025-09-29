-- NEXUS Seed Data
-- Initial data for development and testing

-- Wait for tables to be created by the application
-- This script will be run after the application starts and creates tables

-- Insert default users
-- Note: Passwords are hashed with bcrypt, these are just examples
-- Default password for all users is 'nexus123' (change in production)

-- Admin Users
INSERT INTO users (username, email, first_name, last_name, hashed_password, role, is_approver, is_active)
VALUES
    ('admin', 'admin@americancircuits.com', 'System', 'Administrator', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6hsyeZ8T/u', 'ADMIN', true, true),
    ('kris', 'kris@americancircuits.com', 'Kris', 'Johnson', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6hsyeZ8T/u', 'ADMIN', true, true),
    ('adam', 'adam@americancircuits.com', 'Adam', 'Smith', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6hsyeZ8T/u', 'ADMIN', true, true)
ON CONFLICT (username) DO NOTHING;

-- Supervisor Users
INSERT INTO users (username, email, first_name, last_name, hashed_password, role, is_approver, is_active)
VALUES
    ('supervisor1', 'supervisor1@americancircuits.com', 'John', 'Supervisor', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6hsyeZ8T/u', 'SUPERVISOR', false, true),
    ('supervisor2', 'supervisor2@americancircuits.com', 'Jane', 'Manager', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6hsyeZ8T/u', 'SUPERVISOR', false, true)
ON CONFLICT (username) DO NOTHING;

-- Operator Users
INSERT INTO users (username, email, first_name, last_name, hashed_password, role, is_approver, is_active)
VALUES
    ('operator1', 'operator1@americancircuits.com', 'Mike', 'Operator', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6hsyeZ8T/u', 'OPERATOR', false, true),
    ('operator2', 'operator2@americancircuits.com', 'Sarah', 'Tech', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6hsyeZ8T/u', 'OPERATOR', false, true),
    ('operator3', 'operator3@americancircuits.com', 'David', 'Assembly', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6hsyeZ8T/u', 'OPERATOR', false, true)
ON CONFLICT (username) DO NOTHING;

-- Insert Work Centers
INSERT INTO work_centers (name, code, description, is_active)
VALUES
    ('Incoming Inspection', 'INCOMING', 'Incoming material inspection and verification', true),
    ('PCB Preparation', 'PCB_PREP', 'PCB cleaning and preparation', true),
    ('SMT Line', 'SMT_LINE', 'Surface Mount Technology assembly line', true),
    ('Reflow Oven', 'REFLOW', 'Reflow soldering process', true),
    ('AOI Inspection', 'AOI', 'Automated Optical Inspection', true),
    ('Manual Assembly', 'ASSEMBLY', 'Manual component assembly and integration', true),
    ('Testing', 'TEST', 'Functional and electrical testing', true),
    ('Quality Control', 'QC', 'Final quality control inspection', true),
    ('Packaging', 'PACKAGING', 'Product packaging and labeling', true),
    ('Shipping', 'SHIPPING', 'Shipping preparation and dispatch', true),
    ('Cable Preparation', 'CABLE_PREP', 'Cable cutting and preparation', true),
    ('Cable Assembly', 'CABLE_ASSY', 'Cable harness assembly', true),
    ('Connector Assembly', 'CONNECTOR_ASSY', 'Connector installation and assembly', true),
    ('Cable Testing', 'CABLE_TEST', 'Cable continuity and electrical testing', true),
    ('Harness Assembly', 'HARNESS_ASSY', 'Wire harness assembly and routing', true),
    ('Harness Testing', 'HARNESS_TEST', 'Harness electrical and continuity testing', true),
    ('Final Assembly', 'FINAL_ASSY', 'Final product assembly and integration', true),
    ('Kitting', 'KITTING', 'Component kitting and organization', true)
ON CONFLICT (code) DO NOTHING;

-- Insert sample parts
INSERT INTO parts (part_number, description, revision, work_center_code, customer_code, customer_name, is_active)
VALUES
    ('METSHIFT', 'METSHIFT Assembly Board', 'V0.2', 'ASSEMBLY', '750', 'Customer Supply', true),
    ('PCB-MAIN-001', 'Main Control Board', 'V1.0', 'PCB_PREP', 'ACME', 'ACME Corporation', true),
    ('PCB-CTRL-002', 'Control Interface Board', 'V2.1', 'PCB_PREP', 'TECH', 'Tech Industries', true),
    ('CABLE-PWR-001', 'Power Cable Assembly', 'V1.0', 'CABLE_ASSY', 'PWR', 'Power Systems Inc', true),
    ('CABLE-DATA-002', 'Data Communication Cable', 'V1.2', 'CABLE_ASSY', 'DATA', 'Data Solutions LLC', true),
    ('HARNESS-MAIN', 'Main Wiring Harness', 'V3.0', 'HARNESS_ASSY', 'AUTO', 'Automotive Systems', true),
    ('ASSY-COMPLETE-001', 'Complete System Assembly', 'V2.0', 'FINAL_ASSY', 'SYS', 'System Integrators', true)
ON CONFLICT (part_number, revision) DO NOTHING;

-- Insert sample work orders
INSERT INTO work_orders (job_number, work_order_number, part_number, part_description, revision, quantity, customer_code, customer_name, work_center, priority, is_active)
VALUES
    ('8414L', '8414L', 'METSHIFT', 'METSHIFT Assembly', 'V0.2', 250, '750', 'Customer Supply', 'ASSEMBLY', 'NORMAL', true),
    ('WO-001', 'WO-001', 'PCB-MAIN-001', 'Main Control Board', 'V1.0', 100, 'ACME', 'ACME Corporation', 'PCB_PREP', 'HIGH', true),
    ('WO-002', 'WO-002', 'CABLE-PWR-001', 'Power Cable Assembly', 'V1.0', 500, 'PWR', 'Power Systems Inc', 'CABLE_ASSY', 'NORMAL', true),
    ('JOB-003', 'WO-003', 'HARNESS-MAIN', 'Main Wiring Harness', 'V3.0', 75, 'AUTO', 'Automotive Systems', 'HARNESS_ASSY', 'URGENT', true)
ON CONFLICT (job_number) DO NOTHING;

-- Create performance indexes after data insertion
CREATE INDEX IF NOT EXISTS idx_travelers_job_number ON travelers(job_number);
CREATE INDEX IF NOT EXISTS idx_travelers_work_order_number ON travelers(work_order_number);
CREATE INDEX IF NOT EXISTS idx_travelers_status ON travelers(status);
CREATE INDEX IF NOT EXISTS idx_travelers_created_by ON travelers(created_by);
CREATE INDEX IF NOT EXISTS idx_travelers_created_at ON travelers(created_at);

CREATE INDEX IF NOT EXISTS idx_process_steps_traveler_id ON process_steps(traveler_id);
CREATE INDEX IF NOT EXISTS idx_sub_steps_process_step_id ON sub_steps(process_step_id);
CREATE INDEX IF NOT EXISTS idx_manual_steps_traveler_id ON manual_steps(traveler_id);

CREATE INDEX IF NOT EXISTS idx_labor_entries_traveler_id ON labor_entries(traveler_id);
CREATE INDEX IF NOT EXISTS idx_labor_entries_employee_id ON labor_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_labor_entries_start_time ON labor_entries(start_time);

CREATE INDEX IF NOT EXISTS idx_approvals_traveler_id ON approvals(traveler_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_requested_by ON approvals(requested_by);

CREATE INDEX IF NOT EXISTS idx_audit_logs_traveler_id ON audit_logs(traveler_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);

-- Create triggers for updated_at columns
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_travelers_updated_at BEFORE UPDATE ON travelers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();