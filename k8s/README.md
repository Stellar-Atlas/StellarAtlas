# StellarAtlas Kubernetes Deployment

This directory contains Kubernetes manifests for deploying StellarAtlas using a GitOps approach with Kustomize.

## 📁 Directory Structure

```
k8s/
├── base/                          # Base Kubernetes manifests
│   ├── namespace.yaml            # Namespace and resource quotas
│   ├── configmap.yaml            # Application configuration
│   ├── secrets.yaml              # Secret templates (replace in production)
│   ├── postgres.yaml             # PostgreSQL StatefulSet
│   ├── backend.yaml              # Backend API deployment
│   ├── frontend.yaml             # Frontend web deployment
│   ├── history-scanner.yaml      # History scanner microservice
│   ├── users-service.yaml        # Users microservice
│   ├── network-scanner.yaml      # Network scanner (Deployment + CronJob)
│   ├── ingress.yaml              # Ingress controller configuration
│   ├── hpa.yaml                  # Horizontal Pod Autoscaler
│   └── kustomization.yaml        # Base kustomization
├── overlays/
│   ├── development/              # Development environment
│   │   └── kustomization.yaml   # Dev-specific overrides
│   └── production/               # Production environment
│       └── kustomization.yaml   # Prod-specific overrides
└── README.md                     # This file
```

## 🏗️ Architecture Overview

StellarAtlas consists of the following components:

- **PostgreSQL**: Primary database (StatefulSet with persistent storage)
- **Backend API**: REST API server handling core functionality
- **Frontend**: Vue.js web application served via nginx
- **History Scanner**: Microservice for Stellar history archive scanning
- **Users Service**: User management microservice
- **Network Scanner**: Stellar network crawler (Deployment + CronJob)

## 🚀 Quick Start

### Prerequisites

1. **Kubernetes cluster** (v1.25+)
2. **kubectl** configured to access your cluster
3. **Docker** for building images
4. **Kustomize** (usually included with kubectl)

### 1. Build Docker Images

```bash
# Build all images
./scripts/build-images.sh

# Build with custom registry and tag
REGISTRY=your-registry.com/stellaratlas TAG=v1.0.0 ./scripts/build-images.sh

# Build and push to registry
REGISTRY=your-registry.com/stellaratlas TAG=v1.0.0 PUSH=true ./scripts/build-images.sh
```

### 2. Deploy to Development

```bash
# Deploy development environment
kubectl apply -k k8s/overlays/development

# Or use the deployment script
ENVIRONMENT=development ./scripts/deploy.sh
```

### 3. Deploy to Production

```bash
# Update production secrets first (see Security section)
kubectl create secret generic stellaratlas-secrets \
  --from-literal=DATABASE_URL="postgresql://user:pass@postgres-service:5432/stellaratlas" \
  --from-literal=SMTP_USERNAME="your-smtp-user" \
  --from-literal=SMTP_PASSWORD="your-smtp-pass" \
  --from-literal=JWT_SECRET="your-jwt-secret" \
  -n stellaratlas

# Deploy production environment
kubectl apply -k k8s/overlays/production

# Or use the deployment script
ENVIRONMENT=production ./scripts/deploy.sh
```

## 🔧 Configuration

### Environment Variables

Key configuration is managed through ConfigMaps and Secrets:

#### ConfigMap (`stellaratlas-config`)
- `NODE_ENV`: Application environment
- `LOG_LEVEL`: Logging level
- `FRONTEND_BASE_URL`: Public frontend URL
- `SMTP_HOST`, `SMTP_PORT`: SMTP configuration
- `NOTIFICATIONS_ENABLED`: Enable/disable notifications

#### Secrets (`stellaratlas-secrets`)
- `DATABASE_URL`: PostgreSQL connection string
- `SMTP_USERNAME`, `SMTP_PASSWORD`: SMTP credentials
- `JWT_SECRET`: JWT signing secret

### Customization

To customize the deployment:

1. **Environment-specific**: Modify files in `overlays/{environment}/`
2. **Base changes**: Modify files in `base/`
3. **Secrets**: Use external secret management (recommended for production)

### Resource Limits

Default resource allocations:

| Service | CPU Request | Memory Request | CPU Limit | Memory Limit |
|---------|-------------|----------------|-----------|--------------|
| Backend | 250m | 512Mi | 1000m | 2Gi |
| Frontend | 100m | 256Mi | 500m | 1Gi |
| PostgreSQL | 250m | 512Mi | 1000m | 2Gi |
| History Scanner | 200m | 512Mi | 1000m | 2Gi |

Adjust in overlays for different environments.

## 🔒 Security

### Production Secrets

**⚠️ IMPORTANT**: The base secrets.yaml contains placeholder values. For production:

1. **Never commit real secrets to git**
2. Use external secret management:
   - [External Secrets Operator](https://external-secrets.io/)
   - [Sealed Secrets](https://sealed-secrets.netlify.app/)
   - Cloud provider secret managers (AWS Secrets Manager, Azure Key Vault, etc.)

3. Or create secrets manually:
```bash
kubectl create secret generic stellaratlas-secrets \
  --from-literal=DATABASE_URL="$(cat database-url.txt)" \
  --from-literal=SMTP_PASSWORD="$(cat smtp-password.txt)" \
  -n stellaratlas
```

### Security Features

- Non-root container users
- Resource quotas and limits
- Network policies (add as needed)
- Security headers in nginx
- Health checks and probes

## 📊 Monitoring & Scaling

### Horizontal Pod Autoscaler (HPA)

HPA is configured for:
- **Backend**: 2-10 replicas (70% CPU, 80% memory)
- **Frontend**: 2-5 replicas (70% CPU, 80% memory)
- **History Scanner**: 1-3 replicas (80% CPU, 85% memory)

### Monitoring

Pods are annotated for Prometheus scraping:
```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "8080"
  prometheus.io/path: "/metrics"
```

### Health Checks

All services include:
- **Liveness probes**: Restart unhealthy containers
- **Readiness probes**: Route traffic only to ready containers
- **Startup probes**: Handle slow-starting containers

## 🌐 Ingress & Networking

### DNS Configuration

The ingress is configured for:
- `stellaratlas.io` → Frontend
- `api.stellaratlas.io` → Backend APIs

### TLS/SSL

TLS is configured with cert-manager:
```yaml
annotations:
  cert-manager.io/cluster-issuer: "letsencrypt-prod"
```

### Internal Communication

Services communicate via ClusterIP services:
- `postgres-service:5432` → PostgreSQL
- `backend-service:3000` → Backend API
- `frontend-service:8080` → Frontend
- `history-scanner-service:3001` → History Scanner
- `users-service:3002` → Users Service

## 🛠️ Operations

### Common Commands

```bash
# Check deployment status
kubectl get pods -n stellaratlas

# View logs
kubectl logs -f deployment/backend -n stellaratlas

# Scale deployment
kubectl scale deployment backend --replicas=5 -n stellaratlas

# Port forward for local access
kubectl port-forward svc/frontend-service 8080:8080 -n stellaratlas

# Update configuration
kubectl edit configmap stellaratlas-config -n stellaratlas

# Rolling update
kubectl rollout restart deployment/backend -n stellaratlas

# Check rollout status
kubectl rollout status deployment/backend -n stellaratlas
```

### Troubleshooting

#### Pod won't start
```bash
kubectl describe pod <pod-name> -n stellaratlas
kubectl logs <pod-name> -n stellaratlas --previous
```

#### Database connection issues
```bash
kubectl exec -it deployment/postgres -n stellaratlas -- psql -U stellaratlas_user -d stellaratlas
```

#### Resource issues
```bash
kubectl top pods -n stellaratlas
kubectl describe hpa -n stellaratlas
```

### Backup & Recovery

Database backup strategy:
```bash
# Create backup
kubectl exec deployment/postgres -n stellaratlas -- pg_dump -U stellaratlas_user stellaratlas > backup.sql

# Restore backup
kubectl exec -i deployment/postgres -n stellaratlas -- psql -U stellaratlas_user stellaratlas < backup.sql
```

## 🔄 CI/CD Integration

This setup is designed for GitOps workflows:

1. **Image builds**: Use `scripts/build-images.sh` in CI pipeline
2. **Manifest updates**: Update image tags in overlays
3. **Deployment**: Apply manifests via ArgoCD, Flux, or similar
4. **Monitoring**: Integrate with monitoring stack (Prometheus, Grafana)

### GitHub Actions Example

```yaml
name: Deploy to Kubernetes
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    - name: Build images
      run: REGISTRY=ghcr.io/stellar-atlas TAG=${GITHUB_SHA} PUSH=true ./scripts/build-images.sh
    - name: Deploy
      run: |
        kubectl apply -k k8s/overlays/production
        kubectl set image deployment/backend backend=ghcr.io/stellar-atlas/backend:${GITHUB_SHA} -n stellaratlas
```

## 📋 Migration from Docker Compose

Key differences from docker-compose deployment:

1. **Service Discovery**: Services communicate via Kubernetes DNS
2. **Storage**: Persistent volumes replace bind mounts
3. **Scaling**: Use HPA instead of manual scaling
4. **Configuration**: ConfigMaps/Secrets replace environment files
5. **Networking**: Ingress replaces port publishing
6. **Health Checks**: Native Kubernetes probes

## 🎯 Production Considerations

1. **Storage**: Configure appropriate StorageClass for your cluster
2. **Backup**: Implement automated database backups
3. **Monitoring**: Deploy monitoring stack (Prometheus, Grafana)
4. **Logging**: Configure centralized logging (ELK, Fluentd)
5. **Security**: Implement network policies, pod security standards
6. **Updates**: Plan rolling update strategy
7. **Disaster Recovery**: Document recovery procedures

## 📚 Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Kustomize Documentation](https://kustomize.io/)
- [NGINX Ingress Controller](https://kubernetes.github.io/ingress-nginx/)
- [cert-manager](https://cert-manager.io/)
- [Prometheus Operator](https://prometheus-operator.dev/)