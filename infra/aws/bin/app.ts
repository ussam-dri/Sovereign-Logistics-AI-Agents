#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { SovereignStack } from "../lib/sovereign-stack";

const app = new cdk.App();
new SovereignStack(app, "SovereignAgentsMockup", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "eu-west-1",
  },
  description: "Fictional sovereign agents demo on ECS Fargate",
});
