import jwt from "jsonwebtoken";
import type { HandlerEvent } from "@netlify/functions";
import crypto from "crypto";

/**
 * A minimal type definition for the Netlify Deploy object,
 * containing only the fields used in this function.
 */
export type NetlifyDeploy = {
  id: string;
  state?: string | null;
  name?: string | null;
  branch?: string | null;
  commit_ref?: string | null;
  commit_url?: string | null;
  context?: string | null;
  error_message?: string | null;
  updated_at?: string | null;
  url?: string | null;
  deploy_ssl_url?: string | null;
};

export class Response {
  constructor(
    public readonly message: string = "",
    public readonly code: number = 500
  ) {}
}

export function validateSignature(
  token: string,
  secret: string,
  buffer: string
) {
  const decoded = jwt.verify(token, secret, {
    issuer: "netlify",
    algorithms: ["HS256"],
  }) as jwt.JwtPayload;
  const hashedBody = crypto.createHash("sha256").update(buffer).digest("hex");
  return decoded.sha256 === hashedBody;
}

/**
 * Verifies the incoming Netlify webhook signature and extracts the deploy ID.
 * Throws an error if validation fails or the deploy ID cannot be found.
 * @param event The Netlify handler event.
 * @returns The deploy ID from the request body.
 */
export function verifyAndParse(event: HandlerEvent): NetlifyDeploy {
  if (event.body == null) {
    throw new Response("Request body is empty.", 400);
  }

  const secret = process.env.JWT;
  const signature = event.headers["x-webhook-signature"];
  if (secret != null) {
    if (signature == null) {
      throw new Response(
        "Request is missing the x-webhook-signature header.",
        401
      );
    }

    if (!validateSignature(signature, secret, event.body)) {
      throw new Response("Invalid signature.", 401);
    }
  }

  const deploy = JSON.parse(event.body) as NetlifyDeploy | null | undefined;
  if (deploy?.id == null) {
    throw new Response("Failed to get deploy ID from request body.", 400);
  }

  return secret == null ? { id: deploy.id } : deploy;
}

export async function fetchNetlifyDeploy(data: NetlifyDeploy): Promise<NetlifyDeploy> {
  if (data.state != null) {
    return data;
  }

  const deploy = await fetch(`https://api.netlify.com/api/v1/deploys/${data.id}`);

  if (!deploy.ok) {
    throw new Response(
      `Failed to fetch deploy details from Netlify API: ${deploy.status}`,
      502
    );
  }

  return deploy.json();
}
