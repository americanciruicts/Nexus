# NEXUS Frontend

This is the frontend application for the NEXUS Traveler Management System built with Next.js 14, TypeScript, and Tailwind CSS.

## Features

- Modern React-based UI with Server Components
- TypeScript for type safety
- Tailwind CSS for styling
- Responsive design optimized for manufacturing environments
- Real-time traveler tracking and updates
- Approval workflow management
- Labor hours tracking
- Comprehensive audit logging

## Technology Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Heroicons & Lucide React
- **Forms**: React Hook Form with validation
- **Date Handling**: date-fns
- **API**: RESTful API integration

## Project Structure

```
src/
├── app/                 # Next.js App Router pages
├── components/          # Reusable UI components
├── hooks/              # Custom React hooks
├── lib/                # Utility functions and configurations
├── services/           # API service functions
├── types/              # TypeScript type definitions
└── utils/              # Helper utilities
```

## Development

```bash
npm install
npm run dev
```

## Docker

The frontend runs on port 5003 in the Docker environment and is accessible through nginx on port 5000.

## Key Components

- **TravelerForm**: Main form for creating and editing travelers
- **ApprovalWorkflow**: Handles approval requests for Kris and Adam
- **LaborTracking**: Time tracking for manufacturing steps
- **AuditLog**: Complete history of all changes

## American Circuits Integration

This application is specifically designed for American Circuits manufacturing processes with their logo and branding integrated throughout the interface.
