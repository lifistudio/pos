import type { Access } from "@/server/rbac/access";

export type Actor = {
  type: "USER" | "API_KEY" | "OAUTH";
  userId: string;
  apiKeyId?: string;
  /** Token OAuth (aplikasi AI yang login lewat OAuth): hanya-baca. */
  oauthTokenId?: string;
  oauthClientId?: string;
  user: { id: string; name: string; email: string };
  access: Access;
  ip: string | null;
  userAgent: string | null;
};

export type AppEnv = {
  Variables: {
    actor: Actor;
  };
};
