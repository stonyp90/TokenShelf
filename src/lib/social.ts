// Social helpers. Server actions live in the components / pages that call
// these — this module just provides the DB-side logic so the actions stay
// thin.

import { prisma } from "@/lib/db";

export async function toggleFollow(args: { followerId: string; followedId: string }) {
  if (args.followerId === args.followedId) return { followed: false };
  const existing = await prisma.follow.findUnique({
    where: { followerId_followedId: { followerId: args.followerId, followedId: args.followedId } },
  });
  if (existing) {
    await prisma.follow.delete({ where: { id: existing.id } });
    return { followed: false };
  }
  await prisma.follow.create({
    data: { followerId: args.followerId, followedId: args.followedId },
  });
  return { followed: true };
}

export async function toggleFavorite(args: { userId: string; projectId: string }) {
  const existing = await prisma.favorite.findUnique({
    where: { userId_projectId: { userId: args.userId, projectId: args.projectId } },
  });
  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    return { favorited: false };
  }
  await prisma.favorite.create({
    data: { userId: args.userId, projectId: args.projectId },
  });
  return { favorited: true };
}
