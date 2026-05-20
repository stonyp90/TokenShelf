import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

export async function Header() {
  const session = await auth();
  return (
    <header className="sticky top-0 z-10 border-b border-border/60 bg-bg/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-brand shadow-[0_0_12px_2px_hsl(142_71%_50%/.6)]" />
          TokenShelf
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted">
          <Link href="/" className="hover:text-text">
            Feed
          </Link>
          <Link href="/marketplace" className="hover:text-text">
            Marketplace
          </Link>
          <Link href="/new" className="hover:text-text">
            New
          </Link>
          {session?.user ? (
            <div className="flex items-center gap-3">
              <Link
                href={session.user.handle ? `/u/${session.user.handle}` : "/settings"}
                className="hover:text-text"
              >
                {session.user.handle ? `@${session.user.handle}` : "Set handle"}
              </Link>
              <Link href="/orders" className="hover:text-text">
                Orders
              </Link>
              <Link href="/settings" className="hover:text-text">
                Settings
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button className="rounded border border-border px-2.5 py-1 hover:bg-surface" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: "/" });
              }}
            >
              <button
                className="rounded bg-brand px-3 py-1.5 font-medium text-black hover:bg-brand/90"
                type="submit"
              >
                Sign in with GitHub
              </button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
