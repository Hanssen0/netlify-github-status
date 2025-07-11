import { Octokit, App } from "octokit";
import { Response } from "./netlify.mts";

export async function getOctokit(repoInfo?: { owner: string; repo: string }) {
  const { GITHUB_TOKEN, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY } = process.env;

  // If GITHUB_TOKEN is provided, use it (Personal Access Token auth)
  if (GITHUB_TOKEN != null) {
    return new Octokit({ auth: GITHUB_TOKEN });
  }

  // If GitHub App credentials are provided, use them
  if (GITHUB_APP_ID != null && GITHUB_APP_PRIVATE_KEY != null) {
    if (repoInfo == null) {
      throw new Response(
        "Repository info (owner, repo) is required for GitHub App authentication.",
        400
      );
    }
    const app = new App({
      appId: GITHUB_APP_ID,
      privateKey: atob(GITHUB_APP_PRIVATE_KEY),
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
  throw new Response(
    "Server configuration error: Missing GitHub environment variable (GITHUB_TOKEN or GITHUB_APP_ID & GITHUB_APP_PRIVATE_KEY)."
  );
}

/**
 * Creates a user-friendly description for the GitHub commit status.
 * @param state The GitHub state for the deployment.
 * @param errorMessage An optional error message to include in the description.
 * @returns A descriptive string.
 */
export function getCommitStatusDescription(
  state: string,
  errorMessage?: string | null
): string {
  switch (state) {
    case "building":
      return `Deploying...`;
    case "ready":
      return `Deployment successful!`;
    default:
      return `Deployment failed ${
        errorMessage != null ? `: ${errorMessage}` : "."
      }`;
  }
}

/**
 * Parses the repository owner and name from a GitHub commit URL.
 * @param commitUrl The full URL to the commit on GitHub.
 * @returns An object with owner and repo, or null if parsing fails.
 */
export function parseRepoInfoFromCommitUrl(commitUrl: string): {
  owner: string;
  repo: string;
} {
  const url = new URL(commitUrl);
  if (url.hostname === "github.com") {
    // The path is expected to be in the format: /owner/repo/commit/hash
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 3 && pathParts[2] === "commit") {
      return { owner: pathParts[0], repo: pathParts[1] };
    }
  }
  throw new Response(`Unable to parse commit url ${commitUrl}`);
}

/**
 * The context of a commit status, as returned by the GitHub GraphQL API.
 */
export type CommitStatusContext = {
  context: string;
  state: string;
  description: string | null;
  targetUrl: string | null;
  createdAt: string;
  creator: {
    login: string;
  } | null;
};

/**
 * The response shape for the GetSpecificCommitStatus GraphQL query.
 */
export type GetSpecificCommitStatusQueryResponse = {
  repository: {
    object: {
      status: {
        context: CommitStatusContext | null;
      } | null;
    } | null;
  } | null;
};

/**
 * Fetches a specific commit status by its context name using the GitHub GraphQL API.
 * @param octokit An authenticated Octokit instance.
 * @param repoInfo An object containing the repository owner and name.
 * @param commitSha The SHA of the commit.
 * @param contextName The context name of the status to fetch.
 * @returns The commit status context object if found, otherwise null.
 */
export async function getCommitStatusByContext(
  octokit: Octokit,
  repoInfo: { owner: string; repo: string },
  commitSha: string,
  contextName: string
): Promise<CommitStatusContext | null> {
  const query = `
    query GetSpecificCommitStatus($owner: String!, $repo: String!, $commitSha: GitObjectID!, $contextName: String!) {
      repository(owner: $owner, name: $repo) {
        object(oid: $commitSha) {
          ... on Commit {
            status {
              context(name: $contextName) {
                context
                state
                description
                targetUrl
                createdAt
                creator {
                  login
                }
              }
            }
          }
        }
      }
    }`;

  const response = await octokit.graphql<GetSpecificCommitStatusQueryResponse>(
    query,
    {
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      commitSha: commitSha,
      contextName: contextName,
    }
  );

  return response.repository?.object?.status?.context ?? null;
}
