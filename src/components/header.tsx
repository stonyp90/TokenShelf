import Link from "next/link";
import { auth, signIn, signOut, enabledProviders } from "@/auth";
import { TokenShelfLogo } from "@/components/brand/logo";
import {
  GitHubIcon,
  GoogleIcon,
  KeycloakIcon,
} from "@/components/brand/provider-icons";

export async function Header() {
  const session = await auth();
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/75 backdrop-blur-xl">
      <div className="container-wide flex items-center justify-between py-3">
        <Link
          href="/"
          className="group flex items-center transition-opacity hover:opacity-90"
        >
          <TokenShelfLogo size={26} />
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <NavLink href="/">Feed</NavLink>
          <NavLink href="/marketplace">Marketplace</NavLink>
          <NavLink href="/new">New</NavLink>

          {session?.user ? (
            <div className="ml-4 flex items-center gap-2">
              <Link
                href={
                  session.user.handle
                    ? `/u/${session.user.handle}`
                    : "/settings"
                }
                className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {session.user.handle
                  ? `@${session.user.handle}`
                  : "Set handle"}
              </Link>
              <Link
                href="/orders"
                className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                Orders
              </Link>
              <Link
                href="/settings"
                className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                Settings
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  className="btn-tokenshelf-outline !py-1.5 !text-xs"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <div className="ml-3 flex items-center gap-2">
              <SignInButtons />
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
    </Link>
  );
}

function SignInButtons() {
  // Render a button per enabled provider. Empty providers list = nothing
  // configured locally; show a placeholder instead of broken buttons.
  if (enabledProviders.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        auth not configured
      </span>
    );
  }
  return (
    <>
      {enabledProviders.includes("github") && (
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="btn-tokenshelf inline-flex items-center gap-2 !py-1.5 !text-xs"
            aria-label="Sign in with GitHub"
          >
            <GitHubIcon size={14} />
            GitHub
          </button>
        </form>
      )}
      {enabledProviders.includes("google") && (
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="btn-tokenshelf-outline inline-flex items-center gap-2 !py-1.5 !text-xs"
            aria-label="Sign in with Google"
          >
            <GoogleIcon size={14} />
            Google
          </button>
        </form>
      )}
      {enabledProviders.includes("keycloak") && (
        <form
          action={async () => {
            "use server";
            await signIn("keycloak", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="btn-tokenshelf-outline inline-flex items-center gap-2 !py-1.5 !text-xs"
            aria-label="Sign in with SSO"
          >
            <KeycloakIcon size={14} />
            SSO
          </button>
        </form>
      )}
    </>
  );
}
