import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

/**
 * Minimal mockup: VPC, ECS cluster, ALB, placeholder Fargate service.
 * Build/push images from repo Dockerfiles to the ECR repos created here.
 */
export class SovereignStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "Vpc", { maxAzs: 2, natGateways: 1 });

    const cluster = new ecs.Cluster(this, "Cluster", { vpc });

    const coordinatorRepo = new ecr.Repository(this, "CoordinatorRepo", {
      repositoryName: "sovereign-coordinator",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    const frontendRepo = new ecr.Repository(this, "FrontendRepo", {
      repositoryName: "sovereign-frontend",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    const taskDef = new ecs.FargateTaskDefinition(this, "CoordinatorTask", {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    taskDef.addContainer("Coordinator", {
      image: ecs.ContainerImage.fromEcrRepository(coordinatorRepo, "latest"),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "coordinator",
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      portMappings: [{ containerPort: 8000 }],
      environment: {
        DEMO_SHIPMENT_REF: "SHP-1042",
      },
    });

    const service = new ecs.FargateService(this, "CoordinatorService", {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
    });

    const listener = alb.addListener("Http", { port: 80 });
    listener.addTargets("CoordinatorTarget", {
      port: 8000,
      targets: [service],
      healthCheck: { path: "/health" },
    });

    new cdk.CfnOutput(this, "LoadBalancerDNS", { value: alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, "CoordinatorEcrUri", { value: coordinatorRepo.repositoryUri });
    new cdk.CfnOutput(this, "FrontendEcrUri", { value: frontendRepo.repositoryUri });
  }
}
