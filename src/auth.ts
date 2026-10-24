import NextAuth, { type NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Keycloak from "next-auth/providers/keycloak";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

// Providers are wired conditionally: only the ones with env vars set are
// active. Keeps local + per-env config flexible (e.g. dev = GitHub only,
// prod = GitHub + Google + Keycloak SSO).
const providers: NextAuthConfig["providers"] = [];

if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      authorization: { params: { scope: "read:user user:email repo" } },
    }),
  );
}

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: { params: { scope: "openid email profile" } },
    }),
  );
}

if (
  process.env.AUTH_KEYCLOAK_ID &&
  process.env.AUTH_KEYCLOAK_SECRET &&
  process.env.AUTH_KEYCLOAK_ISSUER
) {
  providers.push(
    Keycloak({
      clientId: process.env.AUTH_KEYCLOAK_ID,
      clientSecret: process.env.AUTH_KEYCLOAK_SECRET,
      issuer: process.env.AUTH_KEYCLOAK_ISSUER,
    }),
  );
}

export const enabledProviders = providers
  .map((p) => (typeof p === "function" ? null : (p as { id?: string }).id))
  .filter((v): v is string => Boolean(v));

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers,
  callbacks: {
    async session({ session, user }) {
      const u = await prisma.user.findUnique({
        where: { id: user.id },
        select: { handle: true },
      });
      if (session.user) {
        session.user.id = user.id;
        session.user.handle = u?.handle ?? null;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      // First-time login: mint a default handle from email/name so /u/[handle]
      // works immediately. Users can edit it in /settings later.
      const seed =
        user.email?.split("@")[0] ??
        user.name?.replace(/\s+/g, "").toLowerCase() ??
        "user";
      const base = seed.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 24) || "user";
      let handle = base;
      let n = 0;
      while (await prisma.user.findUnique({ where: { handle } })) {
        n += 1;
        handle = `${base}${n}`;
      }
      await prisma.user.update({ where: { id: user.id }, data: { handle } });
    },
  },
});
