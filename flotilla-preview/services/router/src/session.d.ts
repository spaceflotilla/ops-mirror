import "@fastify/secure-session";

declare module "@fastify/secure-session" {
  interface SessionData {
    userEmail?: string;
    oauthReturnTo?: string;
  }
}
