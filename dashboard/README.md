# Agentic QA Dashboard

This is a comprehensive dashboard for monitoring Agentic QA pipeline metrics. It visualizes test performance, automated decisions, and business risk indicators in real-time.

## Features

- Real-time visualization of pipeline metrics 
- Interactive charts using Chart.js
- Responsive design that works on desktop and mobile
- Dark/light theme toggle
- Detailed tables with recent runs and risk analysis
- Automatic data loading from JSON files

## Data Structure

The dashboard expects a JSON file at `dashboard/metrics-history.json` with the following structure:

```json
[
  {
    "runId": "string",
    "ticket": "string",
    "issueUrl": "string",
    "startedAt": "ISO date string",
    "finishedAt": "ISO date string",
    "durationMs": "number",
    "tests": {
      "passed": "number",
      "failed": "number", 
      "flaky": "number",
      "skipped": "number",
      "total": "number"
    },
    "coverage": {
      "total": "number",
      "covered": "number",
      "missing": "number"
    },
    "generatedSpecs": "number",
    "decisions": {
      "total": "number",
      "byAction": {
        "none": "number",
        "retry": "number",
        "create_bug": "number",
        "comment": "number",
        "escalate": "number"
      }
    },
    "classifications": {
      "product_bug": "number",
      "flaky": "number",
      "test_issue": "number",
      "environment": "number"
    },
    "avgConfidence": "number",
    "bugsCreated": "number",
    "risk": {
      "@tag": {
        "criteria": "number",
        "covered": "number",
        "missing": "number",
        "passed": "number",
        "failed": "number",
        "flaky": "number",
        "bugs": "number",
        "avgConfidence": "number"
      }
    }
  }
]
```

## How to Use

1. Place your `metrics-history.json` file in the `dashboard/` directory
2. Open `dashboard/index.html` in a web browser
3. The dashboard will automatically load and display the data

The dashboard will fall back to sample mock data if the JSON file is not available.

## Chart Types

- **Test Outcomes**: Doughnut chart of passed, failed, and flaky tests
- **Decision Actions Overview**: Doughnut chart of automated decisions
- **Test Results Over Time**: Line chart showing trend over pipeline runs
- **Analyst Confidence Trend**: Line chart of confidence levels over time
- **Failure Classification**: Bar chart of failure types
- **Decision Actions by Type**: Bar chart of decision types

## Theme

The dashboard supports both dark and light themes. Click the theme toggle button in the top right to switch between them.