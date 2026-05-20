import { revalidatePath } from "next/cache";
import { auth, signIn } from "@/auth";
import { toggleFollow } from "@/lib/social";
import { prisma } from "@/lib/db";

export async function FollowButton({
  followedId,
  followedHandle,
}: {
  followedId: string;
  followedHandle: string;
}) {
  const session = await auth();
  const isMe = session?.user?.id === followedId;
  let following = false;
  let followerCount = 0;
  followerCount = await prisma.follow.count({ where: { followedId } });
  if (session?.user?.id && !isMe) {
    const f = await prisma.follow.findUnique({
      where: {
        followerId_followedId: { followerId: session.user.id, followedId },
      },
    });
    following = !!f;
  }

  async function action() {
    "use server";
    const s = await auth();
    if (!s?.user?.id) {
      await signIn("github", { redirectTo: `/u/${followedHandle}` });
      return;
    }
    if (s.user.id === followedId) return;
    await toggleFollow({ followerId: s.user.id, followedId });
    revalidatePath(`/u/${followedHandle}`);
  }

  if (isMe) {
    return (
      <span className="font-mono text-xs text-muted">
        {followerCount.toLocaleString()} follower{followerCount === 1 ? "" : "s"}
      </span>
    );
  }

  return (
    <form action={action} className="flex items-center gap-3">
      <button
        type="submit"
        className={
          following
            ? "rounded-md border border-brand/60 bg-surface px-3 py-1.5 text-sm text-brand"
            : "rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-black hover:bg-brand/90"
        }
      >
        {following ? "Following" : "Follow"}
      </button>
      <span className="font-mono text-xs text-muted">
        {followerCount.toLocaleString()} follower{followerCount === 1 ? "" : "s"}
      </span>
    </form>
  );
}
