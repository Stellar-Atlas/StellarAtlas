# StellarAtlas Improvement Action Plan

This document provides a prioritized, actionable plan for implementing the suggestions from `IMPROVEMENT_SUGGESTIONS.md`. Each item includes estimated effort, impact, and dependencies.

## Priority Matrix

| Priority | Criteria |
|----------|----------|
| **P0** | Critical for security, compliance, or user trust |
| **P1** | High impact, relatively easy to implement |
| **P2** | Medium impact or requires more effort |
| **P3** | Nice to have, low priority |

---

## Phase 1: Foundation & Quick Wins (Week 1-2)

### P0: Security & Compliance

#### 1.1 Add SECURITY.md
- **Effort:** 1 hour
- **Impact:** Critical for vulnerability reporting
- **Owner:** Maintainer
- **Tasks:**
  - [ ] Create SECURITY.md with reporting process
  - [ ] Include supported versions
  - [ ] Add contact information
  - [ ] Link from README.md

#### 1.2 Set up Dependabot
- **Effort:** 30 minutes
- **Impact:** Automated security patches
- **Owner:** DevOps/Maintainer
- **Tasks:**
  - [ ] Create `.github/dependabot.yml`
  - [ ] Configure npm, Docker, GitHub Actions updates
  - [ ] Set up PR auto-merge rules for minor updates
  - [ ] Configure security alerts

### P1: CI/CD Pipeline

#### 1.3 GitHub Actions CI Workflow
- **Effort:** 4 hours
- **Impact:** High - catches bugs before merge
- **Owner:** DevOps
- **Tasks:**
  - [ ] Create `.github/workflows/ci.yml`
  - [ ] Configure PostgreSQL service for integration tests
  - [ ] Set up caching for pnpm dependencies
  - [ ] Add status checks to branch protection
  - [ ] Test on multiple Node.js versions (22.x)

**Sample Workflow:**
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: stellaratlas
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 10.12.1
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm build:ts
      - run: pnpm test:unit
      - run: pnpm test:integration
```

#### 1.4 Add Test Coverage Reporting
- **Effort:** 2 hours
- **Impact:** Medium - visibility into test quality
- **Owner:** Developer
- **Tasks:**
  - [ ] Update jest.config.cjs with coverage settings
  - [ ] Add coverage badge to README.md
  - [ ] Set up Codecov account
  - [ ] Add Codecov to CI workflow
  - [ ] Set coverage thresholds (70% initially)

### P1: Community Health

#### 1.5 CONTRIBUTING.md
- **Effort:** 3 hours
- **Impact:** High - enables external contributors
- **Owner:** Maintainer
- **Tasks:**
  - [ ] Document development setup
  - [ ] Define code style guidelines
  - [ ] Explain PR process
  - [ ] Add commit message conventions
  - [ ] Include testing requirements
  - [ ] Link to CODE_OF_CONDUCT.md

#### 1.6 Issue & PR Templates
- **Effort:** 2 hours
- **Impact:** Medium - improves issue quality
- **Owner:** Maintainer
- **Tasks:**
  - [ ] Create bug report template
  - [ ] Create feature request template
  - [ ] Create documentation template
  - [ ] Create PR template with checklist
  - [ ] Add template picker configuration

---

## Phase 2: Developer Experience (Week 3-4)

### P1: Development Tools

#### 2.1 VS Code Workspace Configuration
- **Effort:** 1 hour
- **Impact:** Medium - smoother onboarding
- **Owner:** Developer
- **Tasks:**
  - [ ] Create `.vscode/settings.json`
  - [ ] Create `.vscode/extensions.json`
  - [ ] Create `.vscode/launch.json` for debugging
  - [ ] Update .gitignore for VS Code files
  - [ ] Document in DEVELOPER_SETUP.md

#### 2.2 Pre-commit Hooks
- **Effort:** 2 hours
- **Impact:** Medium - catch errors early
- **Owner:** Developer
- **Tasks:**
  - [ ] Install husky and lint-staged
  - [ ] Configure pre-commit hook
  - [ ] Add lint-staged config to package.json
  - [ ] Test across team
  - [ ] Document in CONTRIBUTING.md

#### 2.3 Convenience Scripts
- **Effort:** 1 hour
- **Impact:** Low - nice to have
- **Owner:** Developer
- **Tasks:**
  - [ ] Add clean script
  - [ ] Add format scripts
  - [ ] Add db:reset script
  - [ ] Add type-check script
  - [ ] Document in README.md

### P2: Documentation

#### 2.4 API Documentation Enhancement
- **Effort:** 4 hours
- **Impact:** Medium - helps API consumers
- **Owner:** Backend Developer
- **Tasks:**
  - [ ] Review OpenAPI spec completeness
  - [ ] Add request/response examples
  - [ ] Document authentication
  - [ ] Add error code reference
  - [ ] Generate Postman collection
  - [ ] Host documentation on GitHub Pages

#### 2.5 Architecture Decision Records
- **Effort:** 2 hours setup + ongoing
- **Impact:** Medium - documents design decisions
- **Owner:** Tech Lead
- **Tasks:**
  - [ ] Create `/docs/adr/` directory
  - [ ] Create ADR template
  - [ ] Write ADR for existing key decisions
  - [ ] Document ADR process in CONTRIBUTING.md

---

## Phase 3: Quality & Performance (Week 5-6)

### P0: Security Scanning

#### 3.1 Security Workflow
- **Effort:** 3 hours
- **Impact:** High - proactive security
- **Owner:** DevOps/Security
- **Tasks:**
  - [ ] Create `.github/workflows/security.yml`
  - [ ] Set up CodeQL analysis
  - [ ] Add npm audit to CI
  - [ ] Configure Snyk (if budget allows)
  - [ ] Set up security alerts

#### 3.2 Environment Validation
- **Effort:** 3 hours
- **Impact:** Medium - catch config errors
- **Owner:** Backend Developer
- **Tasks:**
  - [ ] Add zod dependency
  - [ ] Create environment schema
  - [ ] Add validation at startup
  - [ ] Provide helpful error messages
  - [ ] Update all apps

### P1: Monitoring

#### 3.3 Health Checks
- **Effort:** 4 hours
- **Impact:** High - production readiness
- **Owner:** Backend Developer
- **Tasks:**
  - [ ] Add `/health` endpoint
  - [ ] Add `/ready` endpoint for Kubernetes
  - [ ] Check database connectivity
  - [ ] Check crawler status
  - [ ] Return proper HTTP status codes

#### 3.4 Metrics Collection
- **Effort:** 8 hours
- **Impact:** Medium - production visibility
- **Owner:** Backend Developer + DevOps
- **Tasks:**
  - [ ] Add Prometheus client
  - [ ] Expose `/metrics` endpoint
  - [ ] Add request duration histogram
  - [ ] Add error counters
  - [ ] Add custom business metrics
  - [ ] Set up Grafana dashboard

### P2: Performance

#### 3.5 Database Optimization
- **Effort:** 6 hours
- **Impact:** Medium - depends on current pain points
- **Owner:** Backend Developer
- **Tasks:**
  - [ ] Enable slow query logging
  - [ ] Analyze common queries
  - [ ] Add missing indexes
  - [ ] Review connection pool settings
  - [ ] Document optimization strategy

---

## Phase 4: Advanced Features (Week 7-8)

### P2: Monorepo Improvements

#### 4.1 Changesets Integration
- **Effort:** 4 hours
- **Impact:** Medium - better release management
- **Owner:** Tech Lead
- **Tasks:**
  - [ ] Install @changesets/cli
  - [ ] Initialize changesets
  - [ ] Configure release workflow
  - [ ] Document changeset process
  - [ ] Create first changesets

#### 4.2 Build Optimization
- **Effort:** 8 hours (evaluation + implementation)
- **Impact:** Medium - faster CI/local builds
- **Owner:** DevOps
- **Tasks:**
  - [ ] Evaluate Turborepo vs Nx
  - [ ] Run benchmarks
  - [ ] Choose and implement
  - [ ] Configure caching
  - [ ] Update CI to use new tool
  - [ ] Document for team

### P2: Frontend Modernization

#### 4.3 Complete Vue 3 Migration
- **Effort:** 20+ hours
- **Impact:** High - long-term maintainability
- **Owner:** Frontend Team
- **Tasks:**
  - [ ] Audit Vue 2 dependencies
  - [ ] Create migration plan
  - [ ] Update to Vue 3
  - [ ] Migrate to Composition API
  - [ ] Update tests
  - [ ] Update documentation

### P3: Email System

#### 4.4 Email Template Improvements
- **Effort:** 6 hours
- **Impact:** Low - polish
- **Owner:** Frontend/Backend Developer
- **Tasks:**
  - [ ] Create HTML email templates
  - [ ] Add inline CSS
  - [ ] Test across email clients
  - [ ] Add plain text fallbacks
  - [ ] Add preview endpoint

---

## Phase 5: Architectural Improvements (Ongoing)

### P2: Scan Decoupling

#### 5.1 Implement Scan Decoupling
- **Effort:** 40+ hours
- **Impact:** High - scalability
- **Owner:** Backend Team
- **Reference:** `apps/backend/src/network-scan/domain/ScanDecouplingTodo.md`
- **Tasks:**
  - [ ] Design new architecture
  - [ ] Create NodeScanRepository
  - [ ] Create OrganizationScanRepository
  - [ ] Move data to appropriate entities
  - [ ] Run network scan async
  - [ ] Add 'last calculated at' to UI
  - [ ] Migration strategy
  - [ ] Load testing

---

## Implementation Guidelines

### Before Starting Any Task

1. **Create an Issue**
   - Reference this action plan
   - Assign to appropriate owner
   - Add labels (e.g., `P0`, `security`, `documentation`)

2. **Create a Branch**
   - Use naming convention: `type/short-description`
   - Examples: `feat/github-actions-ci`, `docs/contributing-guide`

3. **Follow TDD Where Appropriate**
   - Write tests first for new features
   - Ensure existing tests pass
   - Add integration tests for workflows

### During Implementation

1. **Make Small, Focused PRs**
   - One improvement per PR
   - Easier to review
   - Faster to merge

2. **Update Documentation**
   - README.md if user-facing
   - DEVELOPER_SETUP.md if affecting dev workflow
   - Inline comments for complex logic

3. **Test Thoroughly**
   - Run full test suite
   - Test in devcontainer
   - Manual testing where needed

### After Implementation

1. **Update This Action Plan**
   - Mark items as complete ✅
   - Note any deviations
   - Add lessons learned

2. **Share with Team**
   - Demo new features in standup
   - Update team documentation
   - Celebrate wins!

---

## Success Metrics

Track these metrics monthly:

### Code Quality
- [ ] Test coverage > 70%
- [ ] Zero critical security vulnerabilities
- [ ] ESLint violations trending down
- [ ] All CI checks passing

### Development Velocity
- [ ] PR merge time < 48 hours
- [ ] CI build time < 10 minutes
- [ ] New contributor onboarding < 1 day

### Production Health
- [ ] API uptime > 99.5%
- [ ] P95 response time < 500ms
- [ ] Zero data loss incidents

### Community Growth
- [ ] Issue response time < 24 hours
- [ ] 5+ external contributors
- [ ] 10+ GitHub stars
- [ ] Active discussions

---

## Resources Required

### Tools & Services (Consider Budget)
- [ ] Codecov (Free for open source)
- [ ] Snyk (Free tier or paid)
- [ ] Sentry or similar (Error tracking)
- [ ] Grafana Cloud (Free tier)

### Team Time Allocation
- **Week 1-2:** 40 hours (Phase 1)
- **Week 3-4:** 30 hours (Phase 2)
- **Week 5-6:** 30 hours (Phase 3)
- **Week 7-8:** 40 hours (Phase 4)
- **Ongoing:** 10 hours/week (Phase 5)

**Total Initial Investment:** ~140 hours (3.5 person-weeks)

---

## Risk Mitigation

### Potential Risks

1. **Breaking Changes**
   - **Mitigation:** Thorough testing, staged rollout, easy rollback

2. **Team Bandwidth**
   - **Mitigation:** Prioritize ruthlessly, tackle in phases

3. **Third-party Service Costs**
   - **Mitigation:** Use free tiers, self-host where possible

4. **Scope Creep**
   - **Mitigation:** Stick to action plan, defer nice-to-haves

---

## Next Steps

1. **Review this plan** with the team
2. **Adjust priorities** based on business needs
3. **Create issues** for Phase 1 items
4. **Assign owners** for each task
5. **Start with P0 items** immediately
6. **Schedule weekly sync** to track progress

---

## Questions?

For questions about this action plan:
- Open an issue with label `question`
- Reference `ACTION_PLAN.md`
- Tag relevant owners

---

**Document Version:** 1.0  
**Last Updated:** December 26, 2025  
**Status:** Ready for Review  
**Next Review:** After Phase 1 Completion
