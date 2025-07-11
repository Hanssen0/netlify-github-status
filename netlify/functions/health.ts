import type { Handler } from "@netlify/functions";

/**
 * A simple health check endpoint.
 * It confirms the function is deployed and reachable.
 * A real-world implementation might also check dependencies
 * like database connections or third-party APIs.
 */
const handler: Handler = async () => {
  try {
    // For a more advanced check, you could verify essential environment variables
    // or ping a critical downstream service here.

    const response = {
      status: "ok",
      timestamp: new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred.";
    console.error("Health check failed:", errorMessage);

    return {
      statusCode: 503, // Service Unavailable
      body: JSON.stringify({ status: "error", message: errorMessage }),
    };
  }
};

export { handler };
