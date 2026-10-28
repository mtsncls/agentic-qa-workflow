# E2E Test Report Summary

## Overview
- **Product**: agentic-qa-workflow
- **Report Generated At**: 2026-10-21T11:00:19.414Z
- **Server URL**: http://localhost:8080
- **Application URL**: http://localhost:8080/nextgen/overview

## Top Failures
| Test Name | Fail Count | Last Failed At |
|----------|------------|----------------|
| checkout overview shows order total | 7 | 2026-10-21T10:59:57.686Z |

## Slowest Tests
| Test Name | Average Duration (ms) | Max Duration (ms) | Run Count |
|----------|----------------------|-------------------|-----------|
| checkout overview shows order total | 11047.29 | 11201 | 7 |
| logout returns user to login page | 1347.50 | 1392 | 8 |
| added product appears in cart with correct badge | 1256.13 | 2003 | 8 |
| successful login redirects to inventory | 816.13 | 931 | 8 |
| cart count reflects multiple additions and removals | 791.75 | 1138 | 8 |
| complete checkout flow shows confirmation | 742.25 | 952 | 8 |
| locked out user sees error message | 701.88 | 828 | 8 |
| invalid credentials show error and stay on login | 675.75 | 767 | 8 |

## Pass Rate History
| Build | Pass Rate (%) | Total Tests | Start Time | Is Anomaly |
|-------|---------------|-------------|------------|------------|
| 1792580392570 | 87 | 88 | 2026-08-26T09:45:29.596Z | false |

## Build Duration History
| Build | Start Time | Duration (ms) | Config Count |
|-------|------------|---------------|--------------|
| 1787737529596 | 2026-08-26T09:45:29.596Z | 4842858974 | 12 |