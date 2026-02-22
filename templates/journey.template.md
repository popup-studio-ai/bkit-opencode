---
template: journey
version: 1.0
description: User Journey document for detailed journey design
variables:
  - feature: Feature name
  - date: Creation date
---

# {feature} User Journey

> **Feature**: {feature}
> **Date**: {date}
> **Design Doc**: [{feature}.design.md](../features/{feature}.design.md)

## 1. Journey Overview

- Target Users: {user types}
- Journey Goal: {what the user achieves}

## 2. User Personas

| Persona | Description | Goals | Pain Points |
|---------|-------------|-------|-------------|
| {name} | {description} | {goals} | {pain points} |

## 3. Journey Map

### 3.1 Happy Path

{Step-by-step flow with screen transitions}

### 3.2 Alternative Paths

{Alternative flows for different user decisions}

### 3.3 Error Paths

{Error scenarios and recovery flows}

## 4. Screen Flow Diagram

{Visual flow of screens with actions}

## 5. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|--------------|------------|----------|
| US-01 | {persona} | {action} | {benefit} | Must/Should/Could |

## 6. Acceptance Criteria

| Story ID | Given | When | Then |
|----------|-------|------|------|
| US-01 | {precondition} | {action} | {expected result} |
