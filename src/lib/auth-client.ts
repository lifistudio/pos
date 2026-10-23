import { createAuthClient } from "better-auth/react";

/** Login/logout lewat endpoint Better Auth (/api/auth/*). Data bisnis tetap lewat /api/v1. */
export const authClient = createAuthClient();
