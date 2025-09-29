# NEXUS Nginx Configuration

Nginx reverse proxy configuration for the NEXUS Traveler Management System.

## Purpose

Nginx serves as the reverse proxy and load balancer for the NEXUS application, providing:

- **Single Entry Point**: All traffic goes through port 5000
- **Route Management**: Directs API calls to backend, web requests to frontend
- **Static File Serving**: Efficient handling of static assets
- **WebSocket Support**: Hot reload support for development
- **Security Headers**: Basic security configurations

## Configuration Files

### nginx.conf

Main configuration file with upstream definitions and server blocks.

### Routing Rules

```
/          ’ Frontend (Next.js on port 5003)
/api/*     ’ Backend (FastAPI on port 5002)
/_next/hmr ’ Next.js WebSocket for hot reload
```

## Features

- **Reverse Proxy**: Routes requests between frontend and backend
- **Load Balancing**: Ready for horizontal scaling
- **Hot Reload Support**: WebSocket proxying for development
- **Header Forwarding**: Preserves client information
- **Error Handling**: Custom error pages (can be added)

## Development

In development mode, nginx still handles routing but allows for:
- Frontend hot reload via WebSocket
- API development with automatic backend reloading
- Static asset serving optimization

## Production Features

- **Gzip Compression**: Reduces bandwidth usage
- **Caching Headers**: Optimizes static asset delivery
- **Security Headers**: XSS protection, CSRF prevention
- **Rate Limiting**: Prevents abuse (can be configured)

## Logs

Access and error logs are available through Docker:

```bash
# View nginx logs
docker-compose logs nginx

# Follow nginx logs
docker-compose logs -f nginx
```

## Custom Configuration

To modify nginx configuration:

1. Edit `nginx/nginx.conf`
2. Restart nginx container: `docker-compose restart nginx`

## SSL/HTTPS

For production deployment with SSL:

1. Add SSL certificates to nginx container
2. Update nginx.conf with SSL configuration
3. Redirect HTTP to HTTPS