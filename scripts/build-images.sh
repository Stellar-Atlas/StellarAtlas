#!/bin/bash
# Build Docker images for StellarAtlas Kubernetes deployment

set -e

# Configuration
REGISTRY=${REGISTRY:-"stellaratlas"}
TAG=${TAG:-"latest"}
CONTEXT_DIR="."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    error "Docker is not running. Please start Docker and try again."
fi

# Build backend image
log "Building backend image..."
docker build \
    -f Dockerfile.backend \
    -t "${REGISTRY}/backend:${TAG}" \
    --build-arg NODE_ENV=production \
    --progress=plain \
    "${CONTEXT_DIR}" || error "Failed to build backend image"

# Build frontend image
log "Building frontend image..."
docker build \
    -f Dockerfile.frontend \
    -t "${REGISTRY}/frontend:${TAG}" \
    --build-arg NODE_ENV=production \
    --progress=plain \
    "${CONTEXT_DIR}" || error "Failed to build frontend image"

# Build history-scanner image
log "Building history-scanner image..."
docker build \
    -f Dockerfile.history-scanner \
    -t "${REGISTRY}/history-scanner:${TAG}" \
    --build-arg NODE_ENV=production \
    --progress=plain \
    "${CONTEXT_DIR}" || error "Failed to build history-scanner image"

# Build users service image
log "Building users service image..."
docker build \
    -f Dockerfile.users \
    -t "${REGISTRY}/users-service:${TAG}" \
    --build-arg NODE_ENV=production \
    --progress=plain \
    "${CONTEXT_DIR}" || error "Failed to build users service image"

log "All images built successfully!"

# List built images
log "Built images:"
docker images "${REGISTRY}/*:${TAG}" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"

# Optional: Push to registry
if [ "${PUSH:-false}" = "true" ]; then
    log "Pushing images to registry..."
    docker push "${REGISTRY}/backend:${TAG}"
    docker push "${REGISTRY}/frontend:${TAG}"
    docker push "${REGISTRY}/history-scanner:${TAG}"
    docker push "${REGISTRY}/users-service:${TAG}"
    log "Images pushed successfully!"
fi

log "Build complete! Use the following command to deploy:"
echo "kubectl apply -k k8s/overlays/production"