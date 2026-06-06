import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface TestRequestBody {
  radarrUrl?: unknown;
  radarrApiKey?: unknown;
}

function normalizeRadarrUrl(radarrUrl: string): string | null {
  try {
    const url = new URL(radarrUrl.trim());

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: TestRequestBody;

  try {
    body = (await request.json()) as TestRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const radarrUrlValue = typeof body.radarrUrl === "string" ? body.radarrUrl.trim() : "";
  const radarrApiKey = typeof body.radarrApiKey === "string" ? body.radarrApiKey.trim() : "";

  if (!radarrUrlValue) {
    return NextResponse.json(
      { success: false, message: "Radarr Base URL is required to test connection." },
      { status: 400 },
    );
  }

  const baseUrl = normalizeRadarrUrl(radarrUrlValue);
  if (!baseUrl) {
    return NextResponse.json(
      { success: false, message: "Radarr Base URL must be a valid http or https URL." },
      { status: 400 },
    );
  }

  const apiHeaders = {
    Accept: "application/json",
    "X-Api-Key": radarrApiKey,
  };

  try {
    // We fetch system status to check if Radarr is up and the API key is correct
    const response = await fetch(`${baseUrl}/api/v3/system/status`, {
      headers: apiHeaders,
      cache: "no-store",
      // Set a short timeout for the connection test (5 seconds)
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 401) {
      return NextResponse.json({
        success: false,
        message: "Unauthorized. Please verify your Radarr API key.",
      });
    }

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        message: `Radarr responded with status ${response.status}: ${response.statusText}`,
      });
    }

    // Try to parse the response body to extract version info
    const data = await response.json().catch(() => null) as Record<string, unknown> | null;
    const version = data && typeof data === "object" && typeof data.version === "string" ? data.version : "";

    let successMessage = "Successfully connected to Radarr!";
    if (version) {
      successMessage += ` (Version: ${version})`;
    }

    return NextResponse.json({
      success: true,
      message: successMessage,
    });
  } catch (error) {
    console.error("Connection test failed", error);

    let message = "Unable to connect to Radarr. Ensure the URL is correct, Radarr is running, and accessible.";
    if (error instanceof Error) {
      if (error.name === "TimeoutError" || error.message.includes("timeout")) {
        message = "Connection timed out. Check that Radarr is running and is reachable at the specified URL.";
      } else {
        message = `Connection failed: ${error.message}`;
      }
    }

    return NextResponse.json({
      success: false,
      message,
    });
  }
}
