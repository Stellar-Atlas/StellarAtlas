# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| Latest (main branch) | :white_check_mark: |
| < Latest | :x: |

## Reporting a Vulnerability

The StellarAtlas team takes security bugs seriously. We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

### How to Report a Security Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. **Email**: Send an email to security@stellaratlas.io. If you cannot reach this address (for example, if the message bounces), please use the GitHub Security Advisory process described below.
2. **GitHub Security Advisory**: Use GitHub's [private vulnerability reporting](https://github.com/Stellar-Atlas/StellarAtlas/security/advisories/new)

Include the following information in your report:

- Type of vulnerability
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### What to Expect

After you submit a vulnerability report:

1. **Acknowledgment**: We'll acknowledge receipt of your vulnerability report within 48 hours
2. **Investigation**: We'll investigate the issue and determine its severity
3. **Updates**: We'll provide regular updates (at least every 5 business days) on our progress
4. **Resolution**: We'll work on a fix and coordinate disclosure timing with you
5. **Credit**: With your permission, we'll publicly acknowledge your responsible disclosure

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Every 5 business days
- **Fix Timeline**: Depends on severity
  - Critical: 7 days
  - High: 14 days
  - Medium: 30 days
  - Low: 60 days

### Disclosure Policy

- We request that you give us a reasonable amount of time to fix the issue before public disclosure
- We follow coordinated disclosure and will work with you to determine an appropriate disclosure date
- Once the vulnerability is fixed, we'll publish a security advisory on GitHub
- We'll credit security researchers who report vulnerabilities to us (unless they prefer to remain anonymous)

### Scope

**In Scope:**
- All code in this repository
- Dependencies with known vulnerabilities
- Configuration issues that could lead to security problems
- Authentication and authorization flaws
- SQL injection, XSS, CSRF, and other OWASP Top 10 vulnerabilities
- Data exposure issues

**Out of Scope:**
- Attacks requiring physical access to a user's device
- Social engineering attacks
- Denial of service attacks
- Issues in third-party services (report to them directly)
- Recently fixed vulnerabilities (check recent commits first)

### Security Best Practices for Contributors

When contributing to StellarAtlas, please:

1. **Never commit secrets**: Use environment variables for sensitive data
2. **Use parameterized queries**: Prevent SQL injection
3. **Validate input**: Sanitize user input on both frontend and backend
4. **Follow OWASP guidelines**: Be aware of common vulnerabilities
5. **Keep dependencies updated**: Use Dependabot alerts
6. **Review our security guidelines**: Check CONTRIBUTING.md

### Security Advisories

We'll publish security advisories for vulnerabilities in this repository. You can:

- View advisories at: https://github.com/Stellar-Atlas/StellarAtlas/security/advisories
- Subscribe to notifications for security updates
- Review past advisories to learn about fixed vulnerabilities

### Security Tools

We use the following tools to help maintain security:

- **Dependabot**: Automated dependency updates
- **npm audit**: Vulnerability scanning
- **ESLint**: Static code analysis
- **CodeQL**: Semantic code analysis (planned)
- **Snyk**: Additional vulnerability scanning (planned)

### Bug Bounty Program

We currently do not offer a bug bounty program. However, we deeply appreciate security researchers who help us keep StellarAtlas secure and will publicly acknowledge responsible disclosures.

### Contact

For any security-related questions or concerns:

- **Security Issues**: Use GitHub Security Advisories or email maintainers
- **General Questions**: Open a GitHub Discussion
- **Non-Security Bugs**: Open a GitHub Issue

### Legal

We will not pursue legal action against security researchers who:

- Act in good faith
- Avoid privacy violations and data destruction
- Report vulnerabilities responsibly
- Follow this security policy
- Don't exploit vulnerabilities beyond what's necessary to demonstrate the issue

Thank you for helping keep StellarAtlas and our users safe!

---

**Last Updated**: December 26, 2025  
**Version**: 1.0
