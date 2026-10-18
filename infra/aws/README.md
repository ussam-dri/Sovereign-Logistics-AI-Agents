# AWS deployment (ECS Fargate mockup)

Fictional demo stack: ECR images, ECS Fargate services, Application Load Balancer, optional RDS PostgreSQL.

## Prerequisites

- AWS CLI configured
- Node.js 20+ and AWS CDK v2: `npm install -g aws-cdk`
- Docker

## Bootstrap (once per account/region)

```bash
cd infra/aws
npm install
cdk bootstrap
```

## Deploy

```bash
cd infra/aws
npm run build
cdk deploy --all
```

Outputs include `LoadBalancerDNS`. Open `http://<dns>/` for the dashboard and `http://<dns>/api/` for coordinator (path-based routing).

## Images

Build and push from repo root (replace `ACCOUNT` and `REGION`):

```bash
aws ecr get-login-password --region REGION | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.REGION.amazonaws.com
# Build each service Dockerfile and tag per stack ECR repos (see lib/sovereign-stack.ts)
```

For local parity, use the same `docker-compose.yml` before cloud deploy.

## Teardown

```bash
cdk destroy --all
```
