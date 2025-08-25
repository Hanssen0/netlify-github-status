import type { Handler, HandlerEvent } from "@netlify/functions";
import { fetchNetlifyDeploy, verifyAndParse, Response } from "./netlify.mts";
import {
  getCommitStatusByContext,
  getCommitStatusDescription,
  getOctokit,
  parseRepoInfoFromCommitUrl,
} from "./github.mts";
import { randomUUID } from "crypto";

async function innerHandler(reqId: string, event: HandlerEvent) {
  const deploy = await fetchNetlifyDeploy(verifyAndParse(event));
  console.debug(`[${reqId}] Processing deploy ${JSON.stringify(deploy)}`);

  if (
    deploy.state == null ||
    deploy.commit_ref == null ||
    deploy.commit_url == null ||
    deploy.branch == null ||
    deploy.name == null
  ) {
    throw new Response("Skipped: No commit reference.", 200);
  }

  if (deploy.context === "deploy-preview") {
    throw new Response("Skipped: Deploy preview.", 200);
  }

  const repoInfo = parseRepoInfoFromCommitUrl(deploy.commit_url);
  const commitStatusDescription = getCommitStatusDescription(
    deploy.state,
    deploy.error_message
  );
  const context = `Netlify (${deploy.branch} - ${deploy.name})`;
  const environment = `${deploy.branch} - ${deploy.name}`;

  const octokit = await getOctokit(repoInfo);

  const existingStatus = await getCommitStatusByContext(
    octokit,
    repoInfo,
    deploy.commit_ref,
    context
  );

  // Also update the commit status for better visibility in PRs and commit history
  if (
    existingStatus == null ||
    new Date(existingStatus.createdAt).getTime() <=
      new Date(deploy.updated_at ?? 0).getTime()
  ) {
    await octokit.rest.repos.createCommitStatus({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      sha: deploy.commit_ref,
      state: ({
        building: "pending",
        ready: "success",
        error: "failure",
      }[deploy.state] ?? "error") as
        | "pending"
        | "success"
        | "failure"
        | "error",
      target_url: `https://app.netlify.com/sites/${deploy.name}/deploys/${deploy.id}`,
      description: commitStatusDescription,
      context,
    });
    console.debug(
      `[${reqId}] Successfully created/updated commit status for context: "${context}"`
    );
  } else {
    console.debug(
      `[${reqId}] Skipping commit status update: a more recent status already exists for context "${context}".`
    );
  }

  // Find an existing deployment or create a new one.
  // This prevents creating duplicate deployments for the same Netlify deploy.
  const existingDeployment = (
    await octokit.rest.repos.listDeployments({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      task: `deploy:netlify-${deploy.id}`,
      environment,
      per_page: 1,
    })
  ).data[0];
  // Find an existing deployment or create a new one.
  // This prevents creating duplicate deployments.
  let deployment = existingDeployment;

  if (deployment == null) {
    console.debug(
      `[${reqId}] No existing deployment found for Netlify. Creating a new one.`
    );
    const newDeploymentResponse = await octokit.rest.repos.createDeployment({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      ref: deploy.commit_ref,
      environment: `${deploy.branch} - ${deploy.name}`,
      task: `deploy:netlify-${deploy.id}`,
      description: `Netlify deployment triggered by commit.`,
      auto_merge: false,
      required_contexts: [],
    });

    // Check if the deployment was created successfully
    if (
      newDeploymentResponse.status !== 201 ||
      !("id" in newDeploymentResponse.data)
    ) {
      throw new Response(
        `Failed to create deployment. Status: ${newDeploymentResponse.status}`,
        502
      );
    }
    // The created deployment object is in the `data` property of the response
    deployment = newDeploymentResponse.data;
  } else {
    console.debug(
      `[${reqId}] Found existing deployment with ID: ${deployment.id}`
    );
  }

  // To avoid race conditions or overwriting a more recent status,
  // only update the deployment status if the GitHub deployment object
  // hasn't been updated since the Netlify deploy was published.
  if (
    existingDeployment == null ||
    new Date(deployment.updated_at).getTime() <=
      new Date(deploy.updated_at ?? 0).getTime()
  ) {
    await octokit.rest.repos.createDeploymentStatus({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      deployment_id: deployment.id,
      state: ({
        building: "in_progress",
        ready: "success",
        error: "failure",
      }[deploy.state] ?? "error") as
        | "in_progress"
        | "success"
        | "failure"
        | "error",
      log_url: `https://app.netlify.com/sites/${deploy.name}/deploys/${deploy.id}`,
      environment_url:
        (deploy.context === "production"
          ? deploy.url?.replace(/^http:\/\//g, "https://")
          : undefined) ??
        deploy.deploy_ssl_url ??
        undefined,
      description: `Netlify deploy state: ${deploy.state}`,
    });
    console.debug(
      `[${reqId}] Successfully created/updated deployment status for deployment ID: ${deployment.id}`
    );
  } else {
    console.debug(
      `[${reqId}] Skipping deployment status update: a more recent status already exists for deployment ID: ${deployment.id}`
    );
  }

  throw new Response(
    "GitHub deployment and commit status updated successfully.",
    200
  );
}

export const handler: Handler = async (event: HandlerEvent) => {
  const reqId = randomUUID();
  try {
    await innerHandler(reqId, event);
  } catch (err) {
    if (err instanceof Response) {
      if (err.code === 200) {
        console.debug(`[${reqId}] ${err.message}`);
      } else {
        console.error(`[${reqId}] ${err.message}`);
      }

      return {
        statusCode: err.code,
        body: err.message,
      };
    }

    if (err instanceof Error) {
      console.error(`[${reqId}] ${JSON.stringify(err)}`);
      return {
        statusCode: 500,
        body: err.message,
      };
    }
  }

  return {
    statusCode: 200,
  };
};
