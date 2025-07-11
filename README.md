# Netlify GitHub Status

[![API](https://img.shields.io/website?url=https%3A%2F%2Fnetlify-github-status.netlify.app%2F.netlify%2Ffunctions%2Fhealth&label=API)](https://netlify-github-status.netlify.app/.netlify/functions/health)
[![GitHub Bot](https://img.shields.io/badge/GitHub-Bot-green)](https://github.com/apps/netlify-github-status)
[![Netlify Status](https://api.netlify.com/api/v1/badges/c9c7c4db-72bf-4226-ab92-432d82344958/deploy-status)](https://app.netlify.com/projects/netlify-github-status/deploys)

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/Hanssen0/netlify-github-status)

This project provides a Netlify Function that automatically updates your GitHub repository with detailed status information about your Netlify deployments. It creates both **Commit Statuses** and **GitHub Deployments**, providing direct feedback within your GitHub workflow.

## Why Use This?

While Netlify's built-in GitHub integration posts a basic "check" on your commits, this function offers more comprehensive and detailed feedback:

- **GitHub Deployments:** It leverages GitHub's native Deployments API, creating a deployment history for each environment (e.g., `production`, `staging`).
- **Live URLs:** Each deployment status includes a direct link to the live environment URL, making it easy to access your deployed site.
- **Detailed Context:** Commit statuses are clearly labeled with the Netlify site name and branch (e.g., `Netlify (main - my-awesome-site)`), which is especially helpful when you have multiple sites deploying from a single monorepo.
- **Direct Log Links:** Each status links directly back to the specific Netlify deploy log for easier debugging.

## Features

- **Commit Status Updates:** See Netlify's deployment status (`pending`, `success`, `error`) directly on your commits and in pull requests.
- **GitHub Deployments Integration:** Creates native GitHub Deployments for each Netlify deploy.
- **Descriptive Contexts:** Statuses are created with a clear context, making it easy to distinguish between different sites and branches.
- **Idempotent & Reliable:** Prevents duplicate deployments and avoids overwriting newer statuses, ensuring your deployment history is clean and accurate.
- **Flexible Authentication:** Supports authentication via a GitHub App (recommended) or a Personal Access Token.
- **Skips Deploy Previews:** Automatically ignores deploy previews to keep your commit history clean.

## How It Works

1.  When a Netlify deployment starts, succeeds, or fails, it triggers an outgoing webhook.
2.  The webhook sends a payload containing deployment information to this function.
3.  The function authenticates with the GitHub API and:
    a. Creates or updates the **commit status** for the specific commit hash.
    b. Creates a new **GitHub Deployment** (or finds an existing one for the same Netlify deploy).
    c. Creates a **deployment status** for that GitHub Deployment, linking to the live site and Netlify logs.

## Quick Start: Using the Public Service

You can use a publicly hosted instance of this function without needing to fork or deploy this repository yourself.

> **Note on the Public Service:** This method uses a shared, publicly hosted function. It's perfect for personal projects, trials, or low-traffic sites. For business-critical or high-volume production sites, we strongly recommend the **Self-Hosting Guide** to ensure maximum reliability and avoid shared rate limits.

### Step 1: Install the GitHub App

1.  Go to the **[Netlify GitHub Status GitHub App](https://github.com/apps/netlify-github-status)** page.
2.  Click **Install** and grant it access to the repositories you want to monitor.

### Step 2: Configure the Netlify Webhook

For each Netlify site you want to connect:

1.  Go to **Site settings > Build & deploy > Deploy notifications**.
2.  Find the "Outgoing webhooks" section and click **Add notification**.
3.  Select the following events from the "Event to listen for" dropdown:
    - **Deploy building**
    - **Deploy succeeded**
    - **Deploy failed**
4.  For **URL to notify**, enter: `https://netlify-github-status.netlify.app/.netlify/functions/deployment`
5.  Leave the **JWT secret token** field blank.
6.  Save the webhook.

That's it! Your next deployment will now automatically update your GitHub commit statuses and deployments.

## Self-Hosting Guide

For maximum control and reliability, you can host the function on your own Netlify account.

### Step 1: Deploy the Function to Netlify

1.  Click the **"Deploy to Netlify"** button at the top of this README.
2.  Netlify will guide you through forking this repository to your GitHub account and creating a new site to host the function.

### Step 2: Create GitHub Credentials

To interact with the GitHub API, the function needs credentials. Using a dedicated GitHub App is the recommended method, as it offers better security and more granular permissions.

#### Method A: Create a GitHub App (Recommended)

1.  Navigate to **Settings** > **Developer settings** > **GitHub Apps** on GitHub and click **New GitHub App**.
2.  Fill in the app details:
    - **GitHub App name:** Give it a unique, descriptive name (e.g., "My Site's Netlify Deploy Notifier").
    - **Homepage URL:** You can use the URL of your forked repository.
3.  **Webhook:** Uncheck the "Active" checkbox. We will use Netlify's webhooks, not GitHub's.
4.  Under **Repository permissions**, grant the following permissions:
    - **Commit statuses**: `Read & write`
    - **Deployments**: `Read & write`
5.  Click **Create GitHub App**.
6.  On the app's settings page, take note of the **App ID** (you'll need it soon).
7.  Generate a private key by clicking **Generate a private key**. A `.pem` file will be downloaded. **Treat this file like a password; it provides full access to your app.**
8.  Finally, **Install the App** on your GitHub account or organization, granting it access to the repositories you want to monitor.

#### Method B: Create a Personal Access Token (PAT)

> **Note:** This method is less secure as the token has broad permissions. It is not recommended for team or organization use.

1.  Go to **Settings** > **Developer settings** > **Personal access tokens** > **Tokens (classic)**.
2.  Click **Generate new token** and select **Generate new token (classic)**.
3.  Give the token a descriptive name and grant the full `repo` scope. This scope includes the necessary `repo:status` and `repo_deployment` permissions.
4.  Click **Generate token** and **copy the token immediately**. You will not be able to see it again.

### Step 3: Configure Environment Variables on Netlify

Now, provide the credentials and secrets to the function you deployed in Step 1.

1.  Go to the Netlify dashboard for the site that hosts your function.
2.  Navigate to **Site settings > Build & deploy > Environment > Environment variables**.
3.  Click **Edit variables** and add the following:

    **1. Webhook Secret (Optional but Recommended):**

    - `JWT`: A secret string to verify webhook integrity. If you set this, you must provide the same value in the webhook configuration. You can generate one with `openssl rand -hex 32`.

    **2. GitHub Credentials (choose the set that matches your method from Step 2):**

    - **For GitHub App:**

      - `GITHUB_APP_ID`: The App ID you noted down earlier.
      - `GITHUB_APP_PRIVATE_KEY`: The **Base64-encoded** content of the `.pem` file you downloaded.

      To get the Base64 string, run one of these commands and copy the single-line output:

      ```bash
      # On macOS or Linux (ensures a single line output)
      cat your-private-key.pem | base64 | tr -d '\n'

      # On Windows (PowerShell)
      [Convert]::ToBase64String([IO.File]::ReadAllBytes("your-private-key.pem"))
      ```

    - **For Personal Access Token:**
      - `GITHUB_TOKEN`: The Personal Access Token you generated and copied.

### Step 4: Connect Your Sites with Webhooks

The final step is to configure the Netlify sites you want to monitor to send deployment notifications to your new function.

For **each** Netlify site you want to monitor:

1.  Go to that site's dashboard, then **Site settings > Build & deploy > Deploy notifications**.
2.  In the "Outgoing webhooks" section, click **Add notification**.
3.  Select these events from the "Event to listen for" dropdown:
    - **Deploy building**
    - **Deploy succeeded**
    - **Deploy failed**
4.  For **URL to notify**, enter the URL of your deployed function. It will look like this: `https://<your-function-site-name>.netlify.app/.netlify/functions/deployment`.
5.  For **JWT secret token**, paste the secret string you created for the `JWT` environment variable. If you chose not to use one, leave this field blank.
6.  Save the webhook.

Your setup is now complete! The next deployment on your monitored site will trigger the function and update GitHub.

## Environment Variables Summary

| Variable                 | Required | Description                                                                                         |
| ------------------------ | :------: | --------------------------------------------------------------------------------------------------- |
| `JWT`                    | Optional | A secret token to verify webhook integrity. If set, it must match the token in the Netlify webhook. |
| `GITHUB_APP_ID`          |  App\*   | The ID of your GitHub App. _Required if using GitHub App authentication._                           |
| `GITHUB_APP_PRIVATE_KEY` |  App\*   | The Base64-encoded private key for your GitHub App. _Required if using GitHub App authentication._  |
| `GITHUB_TOKEN`           |  PAT\*   | A GitHub Personal Access Token with the `repo` scope. _Required if using PAT authentication._       |
