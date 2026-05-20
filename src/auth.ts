import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      authorization: { params: { scope: "read:user user:email repo" } },
    }),
  ],
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
        user.email?.split("@")[0] ?? user.name?.replace(/\s+/g, "").toLowerCase() ?? "user";
      const base = seed.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 24) || "user";
      let handle = base;
      let n = 0;
      // simple uniqueness loop — fine for MVP traffic
      while (await prisma.user.findUnique({ where: { handle } })) {
        n += 1;
        handle = `${base}${n}`;
      }
      await prisma.user.update({ where: { id: user.id }, data: { handle } });
    },
  },
});
