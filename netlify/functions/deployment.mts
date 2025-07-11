import type { Handler, HandlerEvent } from "@netlify/functions";
import { Octokit, App } from "octokit";
import jwt from "jsonwebtoken";
import crypto from "crypto";

interface NetlifyDeployPayload {
  id: string;
  site_id: string;
  build_id: string;
  state: string; // e.g., 'building', 'ready', 'error'
  name: string; // site name
  url: string;
  ssl_url: string;
  admin_url: string;
  deploy_url: string;
  deploy_ssl_url: string;
  commit_ref: string | null;
  commit_url: string | null;
  branch: string;
  context: "production" | "deploy-preview" | "branch-deploy";
  error_message: string | null;
}

function validateSignature(token: string, secret: string, buffer: string) {
  const decoded = jwt.verify(token, secret, {
    issuer: "netlify",
    algorithms: ["HS256"],
  }) as jwt.JwtPayload;
  const hashedBody = crypto.createHash("sha256").update(buffer).digest("hex");
  return decoded.sha256 === hashedBody;
}

/**
 * Verifies the incoming Netlify webhook signature and parses the body.
 * Throws an error if validation fails.
 * @param event The Netlify handler event.
 * @returns The parsed deploy payload.
 */
function verifyAndParse(event: HandlerEvent): NetlifyDeployPayload {
  const secret = process.env.NETLIFY_JWT;
  const signature = event.headers["x-webhook-signature"];

  if (secret == null) {
    throw new Error("Webhook secret is not configured in NETLIFY_JWT.");
  }
  if (signature == null) {
    throw new Error("Request is missing the x-webhook-signature header.");
  }
  if (event.body == null) {
    throw new Error("Request body is empty.");
  }
  if (!validateSignature(signature, secret, event.body)) {
    throw new Error("Invalid signature.");
  }
  return JSON.parse(event.body) as NetlifyDeployPayload;
}

async function getOctokit(repoInfo?: { owner: string; repo: string }) {
  const { GITHUB_TOKEN, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY } = process.env;

  // If GITHUB_TOKEN is provided, use it (Personal Access Token auth)
  if (GITHUB_TOKEN != null) {
    return new Octokit({ auth: GITHUB_TOKEN });
  }

  // If GitHub App credentials are provided, use them
  if (GITHUB_APP_ID != null && GITHUB_APP_PRIVATE_KEY != null) {
    if (repoInfo == null) {
      throw new Error(
        "Repository info (owner, repo) is required for GitHub App authentication."
      );
    }
    const app = new App({
      appId: GITHUB_APP_ID,
      privateKey: GITHUB_APP_PRIVATE_KEY,
    });

    // Get the installation ID for the repository
    const { data: installation } =
      await app.octokit.rest.apps.getRepoInstallation({
        owner: repoInfo.owner,
        repo: repoInfo.repo,
      });

    // Return an Octokit instance authenticated as that installation
    return app.getInstallationOctokit(installation.id);
  }

  // If no credentials are provided
  throw new Error(
    "Server configuration error: Missing GitHub environment variable (GITHUB_TOKEN or GITHUB_APP_ID & GITHUB_APP_PRIVATE_KEY)."
  );
}

type GithubState = "error" | "pending" | "success";

/**
 * Maps Netlify's deployment state to a corresponding GitHub deployment status state.
 * @param netlifyState The state from the Netlify payload.
 * @returns The corresponding GitHub state
 */
function mapNetlifyStateToGithub(netlifyState: string): GithubState {
  switch (netlifyState) {
    case "building":
      return "pending";
    case "ready": // 'ready' indicates a successful deployment.
      return "success";
    default:
      return "error";
  }
}

/**
 * Creates a user-friendly description for the GitHub commit status.
 * @param state The GitHub state for the deployment.
 * @param context The Netlify deployment context (e.g., 'production').
 * @returns A descriptive string.
 */
function getCommitStatusDescription(
  state: GithubState,
  context: string,
  errorMessage?: string | null
): string {
  switch (state) {
    case "pending":
      return `Deploying to ${context}...`;
    case "success":
      return `Deployment to ${context} successful!`;
    default:
      return `Deployment to ${context} failed ${
        errorMessage != null ? `: ${errorMessage}` : "."
      }`;
  }
}

/**
 * Parses the repository owner and name from a GitHub commit URL.
 * @param commitUrl The full URL to the commit on GitHub.
 * @returns An object with owner and repo, or null if parsing fails.
 */
function parseRepoInfoFromCommitUrl(
  commitUrl: string | null
): { owner: string; repo: string } | null {
  if (commitUrl == null) {
    return null;
  }

  try {
    const url = new URL(commitUrl);
    if (url.hostname !== "github.com") {
      return null;
    }
    // The path is expected to be in the format: /owner/repo/commit/hash
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 3 && pathParts[2] === "commit") {
      return { owner: pathParts[0], repo: pathParts[1] };
    }
  } catch (error) {
    console.error(`Failed to parse commit URL "${commitUrl}":`, error);
  }
  return null;
}

export const handler: Handler = async (event: HandlerEvent) => {
  let body: NetlifyDeployPayload;
  try {
    body = verifyAndParse(event);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred.";
    console.error("Signature validation failed:", errorMessage);
    return {
      statusCode: 401, // Unauthorized
      body: `Unauthorized: ${errorMessage}`,
    };
  }

  if (body.commit_ref == null) {
    console.log(
      "No commit_ref found, skipping GitHub deployment status update."
    );
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Skipped: No commit reference." }),
    };
  }

  if (body.context === "deploy-preview") {
    console.log(
      "Context is deploy preview, skipping GitHub deployment status update."
    );
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Skipped: Deploy preview." }),
    };
  }

  const repoInfo = parseRepoInfoFromCommitUrl(body.commit_url);
  if (repoInfo == null) {
    console.log(
      `Could not parse repository info from commit_url, skipping. URL: ${body.commit_url}`
    );
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Skipped: No valid commit_url found." }),
    };
  }

  const githubState = mapNetlifyStateToGithub(body.state);
  const commitStatusDescription = getCommitStatusDescription(
    githubState,
    body.branch,
    body.error_message
  );

  try {
    const octokit = await getOctokit(repoInfo);

    const deployment = await octokit.rest.repos.createDeployment({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      ref: body.commit_ref,
      environment: `${body.branch} - ${body.name}`,
      description: `Netlify deployment triggered by commit.`,
      auto_merge: false,
      required_contexts: [],
    });

    // Check if the deployment was created successfully
    if (deployment.status !== 201 || !("id" in deployment.data)) {
      throw new Error(
        `Failed to create deployment. Status: ${deployment.status}`
      );
    }

    await octokit.rest.repos.createDeploymentStatus({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      deployment_id: deployment.data.id,
      state: githubState,
      log_url: `https://app.netlify.com/sites/${body.name}/deploys/${body.id}`,
      environment_url: body.ssl_url ?? body.deploy_ssl_url,
      description: `Netlify deploy state: ${body.state}`,
    });

    // Also update the commit status for better visibility in PRs and commit history
    await octokit.rest.repos.createCommitStatus({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      sha: body.commit_ref,
      state: githubState,
      target_url:
        body.state === "ready"
          ? body.ssl_url ?? body.deploy_ssl_url
          : `https://app.netlify.com/sites/${body.name}/deploys/${body.id}`,
      description: commitStatusDescription,
      context: `Netlify (${body.branch} - ${body.name})`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "GitHub deployment and commit status updated successfully.",
      }),
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred.";
    console.error("GitHub API call failed:", errorMessage);
    return {
      statusCode: 502, // Bad Gateway, as we failed to talk to an upstream service (GitHub)
      body: `GitHub API Error: ${errorMessage}`,
    };
  }
};
