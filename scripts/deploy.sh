#!/bin/bash
# Deploy StellarAtlas to Kubernetes

set -e

# Configuration
ENVIRONMENT=${ENVIRONMENT:-"production"}
NAMESPACE="stellaratlas"
WAIT_TIMEOUT=${WAIT_TIMEOUT:-"300s"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}"
}

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    error "kubectl is not installed or not in PATH"
fi

# Check if cluster is accessible
if ! kubectl cluster-info &> /dev/null; then
    error "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
fi

# Validate environment
if [[ "$ENVIRONMENT" != "development" && "$ENVIRONMENT" != "production" ]]; then
    error "Invalid environment: $ENVIRONMENT. Must be 'development' or 'production'"
fi

# Check if overlay exists
OVERLAY_PATH="k8s/overlays/${ENVIRONMENT}"
if [ ! -d "$OVERLAY_PATH" ]; then
    error "Overlay directory not found: $OVERLAY_PATH"
fi

log "Deploying StellarAtlas to Kubernetes cluster..."
info "Environment: $ENVIRONMENT"
info "Namespace: $NAMESPACE"

# Apply the configuration
log "Applying Kubernetes manifests..."
kubectl apply -k "$OVERLAY_PATH" || error "Failed to apply manifests"

# Wait for namespace to be ready
log "Waiting for namespace to be ready..."
kubectl wait --for=condition=Ready namespace/$NAMESPACE --timeout=30s || warn "Namespace may not be ready"

# Wait for PostgreSQL to be ready
log "Waiting for PostgreSQL to be ready..."
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=postgres -n $NAMESPACE --timeout=$WAIT_TIMEOUT || error "PostgreSQL failed to start"

# Wait for all deployments to be ready
log "Waiting for deployments to be ready..."
kubectl wait --for=condition=Available deployment --all -n $NAMESPACE --timeout=$WAIT_TIMEOUT || error "Some deployments failed to start"

# Check pod status
log "Checking pod status..."
kubectl get pods -n $NAMESPACE

# Check service status
log "Checking service status..."
kubectl get svc -n $NAMESPACE

# Check ingress status (if applicable)
if kubectl get ingress -n $NAMESPACE &> /dev/null; then
    log "Checking ingress status..."
    kubectl get ingress -n $NAMESPACE
fi

# Display HPA status
log "Checking HPA status..."
kubectl get hpa -n $NAMESPACE || warn "No HPAs found"

# Health check
log "Performing health checks..."
BACKEND_POD=$(kubectl get pods -n $NAMESPACE -l app.kubernetes.io/name=backend -o jsonpath='{.items[0].metadata.name}' || echo "")
if [ -n "$BACKEND_POD" ]; then
    if kubectl exec -n $NAMESPACE "$BACKEND_POD" -- wget -q --spider http://localhost:3000/health; then
        log "Backend health check: PASSED"
    else
        warn "Backend health check: FAILED"
    fi
fi

FRONTEND_POD=$(kubectl get pods -n $NAMESPACE -l app.kubernetes.io/name=frontend -o jsonpath='{.items[0].metadata.name}' || echo "")
if [ -n "$FRONTEND_POD" ]; then
    if kubectl exec -n $NAMESPACE "$FRONTEND_POD" -- wget -q --spider http://localhost:8080/health; then
        log "Frontend health check: PASSED"
    else
        warn "Frontend health check: FAILED"
    fi
fi

log "Deployment completed successfully!"
log "Access the application:"

# Get ingress information
if kubectl get ingress -n $NAMESPACE &> /dev/null; then
    HOSTS=$(kubectl get ingress -n $NAMESPACE -o jsonpath='{.items[*].spec.rules[*].host}' | tr ' ' '\n' | sort -u)
    for host in $HOSTS; do
        info "  https://$host"
    done
else
    # Port-forward instructions if no ingress
    info "  No ingress found. Use port-forwarding:"
    info "  kubectl port-forward -n $NAMESPACE svc/frontend-service 8080:8080"
    info "  kubectl port-forward -n $NAMESPACE svc/backend-service 3000:3000"
fi

log "Monitor the deployment:"
info "  kubectl get pods -n $NAMESPACE -w"
info "  kubectl logs -f -n $NAMESPACE deployment/backend"