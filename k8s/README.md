# Legacy StellarAtlas Kubernetes Recipe

These manifests describe a legacy Vue-era deployment recipe, not the current
live architecture or a supported from-scratch production deployment. See the
[current deployment guide](../deployment.md) and [architecture](../README.md).
Review and adapt this recipe before use. The base supplies no Secrets and is
not a standalone deployment; use an overlay with explicit operator inputs.

## 📁 Directory Structure

```
k8s/
├── base/                          # Base Kubernetes manifests
│   ├── namespace.yaml            # Namespace and resource quotas
│   ├── configmap.yaml            # Application configuration
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

Prepare both required private input files for this overlay first; see
[Operator-supplied Secrets](#operator-supplied-secrets). Without them, Kustomize
must fail rather than render credentials from a template.

```bash
# Deploy development environment
kubectl apply -k k8s/overlays/development

# Or use the deployment script
ENVIRONMENT=development ./scripts/deploy.sh
```

### 3. Deploy to Production

Prepare separate production inputs as described below. Do not reuse development
credentials or manually create an unprefixed Secret alongside this generator.

```bash
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
- `SESSION_SECRET`: session signing secret

#### PostgreSQL Secret (`postgres-secret`)
- `POSTGRES_USER`, `POSTGRES_PASSWORD`: database credentials

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

### Operator-supplied Secrets

Both overlays require two operator-owned files under their own ignored
`.secrets/` directory. There are no tracked values or merge defaults. For each
environment, create that directory with private permissions and populate the
files from your approved secret store, outside logs and shell history:

| Overlay input | Required keys, one `KEY=value` per line |
| --- | --- |
| `overlays/development/.secrets/application.env` | `DATABASE_URL`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `JWT_SECRET`, `SESSION_SECRET` |
| `overlays/development/.secrets/postgres.env` | `POSTGRES_USER`, `POSTGRES_PASSWORD` |
| `overlays/production/.secrets/application.env` | `DATABASE_URL`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `JWT_SECRET`, `SESSION_SECRET` |
| `overlays/production/.secrets/postgres.env` | `POSTGRES_USER`, `POSTGRES_PASSWORD` |

Use nonempty, independently chosen values and restrict file permissions to the
operator account (for example, directory mode `0700` and file mode `0600` on
Unix). Keep database credentials consistent with the intended database, its
configured role/probes and the connection URL. Service DNS names in that URL
must use the chosen overlay prefix, such as `dev-postgres-service` or
`prod-postgres-service`, in the `stellaratlas` namespace. Never commit input
files, rendered Secrets or decoded values. Base64 encoding is not encryption.

Render only the intended overlay using `kubectl kustomize
k8s/overlays/development` or `kubectl kustomize k8s/overlays/production` in a
private environment. Rendering includes Secret data; do not send its output to
shared terminals, CI logs or source control. An absent input file must fail
rendering. Missing referenced keys must prevent container startup; do not set
Secret references to optional to bypass this gate.

Kustomize creates the following names in namespace `stellaratlas` and rewrites
the workloads' Secret references to match. `<hash>` is content-derived; inspect
the private rendered manifest for the exact name before use.

| Overlay | Application Secret | Database Secret |
| --- | --- | --- |
| development | `dev-stellaratlas-secrets-<hash>` | `dev-postgres-secret-<hash>` |
| production | `prod-stellaratlas-secrets-<hash>` | `prod-postgres-secret-<hash>` |

Do not use the previous `behavior: merge` recipe: it could retain base defaults
for fields that were not overridden. If adapting this legacy recipe to an
external Secret manager, replace both generators and explicitly reconcile the
rendered names, namespace and every required key. Do not mix externally managed
Secrets with these generators. Changing a manifest does not rotate any existing
credential; existing installations need their own reviewed migration and
credential lifecycle plan.

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
