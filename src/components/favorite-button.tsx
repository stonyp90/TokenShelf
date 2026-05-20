import { revalidatePath } from "next/cache";
import { auth, signIn } from "@/auth";
import { toggleFavorite } from "@/lib/social";
import { prisma } from "@/lib/db";

export async function FavoriteButton({
  projectId,
  redirectAfter,
}: {
  projectId: string;
  redirectAfter: string;
}) {
  const session = await auth();
  const favCount = await prisma.favorite.count({ where: { projectId } });
  let mine = false;
  if (session?.user?.id) {
    const fav = await prisma.favorite.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId } },
    });
    mine = !!fav;
  }
  async function action() {
    "use server";
    const s = await auth();
    if (!s?.user?.id) {
      await signIn("github", { redirectTo: redirectAfter });
      return;
    }
    await toggleFavorite({ userId: s.user.id, projectId });
    revalidatePath(redirectAfter);
  }
  return (
    <form action={action}>
      <button
        type="submit"
        title={mine ? "Remove from favorites" : "Add to favorites"}
        className={
          mine
            ? "rounded-md border border-token/60 bg-surface px-2 py-1 text-xs text-token"
            : "rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text"
        }
      >
        ★ {favCount.toLocaleString()}
      </button>
    </form>
  );
}
