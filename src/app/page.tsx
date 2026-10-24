import Link from "next/link";
import { prisma } from "@/lib/db";
import { ProjectCard } from "@/components/project-card";
import { signIn, enabledProviders } from "@/auth";
import { GitHubIcon, GoogleIcon, KeycloakIcon } from "@/components/brand/provider-icons";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await prisma.project.findMany({
    where: { published: true },
    orderBy: [{ verifiedReceiptCount: "desc" }, { createdAt: "desc" }],
    take: 9,
    include: { owner: { select: { handle: true, image: true, name: true } } },
  });

  return (
    <div className="space-y-24 pb-16">
      {/* ─────────────── Hero ─────────────── */}
      <section className="relative pt-12 animate-slide-up">
        {/* Layered, no-fill background: subtle radial wash + dot grid */}
        <div
          aria-hidden
          className="absolute inset-x-0 -top-16 -z-10 h-[520px]"
          style={{
            background:
              "radial-gradient(60% 80% at 30% 0%, hsl(var(--primary) / 0.10), transparent 60%), radial-gradient(40% 60% at 90% 10%, hsl(var(--accent) / 0.07), transparent 60%)",
          }}
        />
        <div className="bg-dot-grid absolute inset-x-0 -top-16 -z-10 h-[520px] opacity-30" />

        <div className="label">Verifiable AI engineering</div>
        <h1 className="heading-xl mt-4 max-w-4xl text-balance leading-[1.02]">
          Save up to 90% on AI tokens.{" "}
          <span className="text-tokenshelf underline decoration-2 decoration-primary/70 underline-offset-[8px]">
            Earn a certified badge.
          </span>
        </h1>
        <p className="body-lg mt-6 max-w-2xl">
          An open-source daemon on consenting builders&rsquo; machines that already
          cuts AI token bills 60&ndash;90%, signs every receipt with{" "}
          <span className="font-mono text-foreground">ed25519</span>, and earns
          builders an{" "}
          <span className="font-medium text-foreground">official certified badge</span>{" "}
          with their productivity score &mdash; portable, signed, theirs to display.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {enabledProviders.includes("github") && (
            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: "/" });
              }}
            >
              <button className="btn-tokenshelf inline-flex items-center gap-2" type="submit">
                <GitHubIcon size={16} />
                Sign in with GitHub
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
                className="btn-tokenshelf-outline inline-flex items-center gap-2"
                type="submit"
              >
                <GoogleIcon size={16} />
                Sign in with Google
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
                className="btn-tokenshelf-outline inline-flex items-center gap-2"
                type="submit"
              >
                <KeycloakIcon size={16} />
                SSO
              </button>
            </form>
          )}
          <Link href="/marketplace" className="btn-tokenshelf-outline">
            Browse the marketplace
          </Link>
          <a
            href="https://github.com/a-team/tokenshelf-agent"
            className="btn-tokenshelf-outline inline-flex items-center gap-2"
            rel="noopener noreferrer"
          >
            <GitHubIcon size={14} />
            Get the daemon
          </a>
        </div>

        {/* Trust strip — the four commitments at a glance */}
        <div className="mt-14 grid grid-cols-2 gap-x-8 gap-y-6 border-y border-border py-6 lg:grid-cols-4">
          {[
            {
              label: "Open daemon",
              copy: "Rust capture tool is open source & auditable. Your project code stays private.",
            },
            {
              label: "Secrets filtered",
              copy: "API keys, tokens, passwords stripped before anything leaves the laptop.",
            },
            {
              label: "No latency penalty",
              copy: "Smaller prompts run faster; measurement is fully out-of-band.",
            },
            {
              label: "Builder-owned",
              copy: "Score and prompts: show or hide per audience, anytime.",
            },
          ].map((t) => (
            <div key={t.label}>
              <div className="label">{t.label}</div>
              <p className="body-md mt-1 text-sm">{t.copy}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────── How it works ─────────────── */}
      <section className="space-y-8">
        <div className="max-w-2xl">
          <div className="label">How it works</div>
          <h2 className="heading-lg mt-2">Three steps from install to badge.</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            {
              n: "01",
              title: "Install the daemon",
              copy: "One Rust binary, cross-platform. macOS, Linux, Windows. Apache-2.0 on GitHub — read, build, verify the hash yourself.",
              cmd: "brew install tokenshelf-agent",
            },
            {
              n: "02",
              title: "Code as usual",
              copy: "Claude Code, Cursor, Codex, Aider — the daemon trims context (60–90% savings) and captures usage out-of-band. Zero added latency on the AI call.",
              cmd: "tokenshelf consent --project my-app",
            },
            {
              n: "03",
              title: "Earn the certified badge",
              copy: "Time, $ spent, tokens, and an overall score (%) per project. Cryptographically signed. Yours to display on your profile, LinkedIn, anywhere.",
              cmd: "tokenshelf badge --show",
            },
          ].map((s) => (
            <div key={s.n} className="card-tokenshelf p-6">
              <div className="data-token-strong text-tokenshelf">{s.n}</div>
              <h3 className="heading-md mt-3 text-lg">{s.title}</h3>
              <p className="body-md mt-2 text-sm">{s.copy}</p>
              <div className="mt-4 rounded-sm bg-secondary px-3 py-2 font-mono text-xs text-muted-foreground">
                <span className="select-none text-primary">$</span> {s.cmd}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────── Certified badge preview ─────────────── */}
      <section className="space-y-8">
        <div className="max-w-2xl">
          <div className="label">The official certified badge</div>
          <h2 className="heading-lg mt-2">
            What it looks like.{" "}
            <span className="text-muted-foreground">
              Signed, portable, builder-owned.
            </span>
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
          {/* The badge card itself */}
          <div className="card-tokenshelf-elevated overflow-hidden">
            <div className="border-b border-border bg-gradient-to-br from-primary/15 to-transparent p-5">
              <div className="flex items-center justify-between">
                <div className="label">TokenShelf · Certified</div>
                <span className="rounded-sm border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  ed25519 ✓
                </span>
              </div>
              <div className="mt-3 font-serif text-2xl font-bold tracking-tight">
                Ada Lovelace
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                @ada · a.team builder · 2026
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-border">
              {[
                { k: "Score", v: "87%", sub: "Tier A · Top 12% of network" },
                { k: "Engagements", v: "12", sub: "Last 12 months" },
                { k: "Model spend", v: "$2,418", sub: "Across 12 projects" },
                { k: "Tokens", v: "2.4M", sub: "Input + output + cache" },
              ].map((s) => (
                <div key={s.k} className="bg-card p-4">
                  <div className="data-token text-[10px] uppercase tracking-widest">
                    {s.k}
                  </div>
                  <div className="mt-1 font-serif text-2xl font-bold">
                    {s.v}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {s.sub}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between bg-card px-5 py-3 text-xs text-muted-foreground">
              <span className="data-token">
                sig: <span className="text-foreground">9f3a…4e2c</span>
              </span>
              <span>verifier · tokenshelf.dev</span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-4">
            <p className="body-lg">
              Every metric on the badge is grounded in something measurable
              and signed:{" "}
              <span className="font-medium text-foreground">
                time invested
              </span>
              ,{" "}
              <span className="font-medium text-foreground">
                model spend in dollars
              </span>
              ,{" "}
              <span className="font-medium text-foreground">
                token use across input, output, cache
              </span>
              , and an{" "}
              <span className="font-medium text-foreground">
                overall score (%)
              </span>{" "}
              from objective signals.
            </p>
            <ul className="body-md space-y-2 text-sm">
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-block h-2 w-2 rounded-full bg-primary" />
                <span>
                  <span className="font-medium text-foreground">
                    Builder decides visibility.
                  </span>{" "}
                  Score on or off the public profile. Prompts shared or
                  hidden per audience. One command, anytime.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-block h-2 w-2 rounded-full bg-accent" />
                <span>
                  <span className="font-medium text-foreground">
                    Buyers verify the math themselves.
                  </span>{" "}
                  Receipts are signed with ed25519; the verifier key is
                  public at{" "}
                  <span className="font-mono text-foreground">
                    /.well-known/tokenshelf-verify.json
                  </span>
                  .
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-block h-2 w-2 rounded-full bg-success" />
                <span>
                  <span className="font-medium text-foreground">
                    Trust tier per receipt
                  </span>{" "}
                  <span className="ml-1 inline-flex gap-1.5 align-middle">
                    <span className="tier-verified rounded-sm px-1.5 py-0.5 font-mono text-[10px]">
                      VERIFIED
                    </span>
                    <span className="tier-proxied rounded-sm px-1.5 py-0.5 font-mono text-[10px]">
                      PROXIED
                    </span>
                    <span className="tier-self rounded-sm px-1.5 py-0.5 font-mono text-[10px]">
                      SELF_REPORTED
                    </span>
                  </span>{" "}
                  &mdash; so a quick glance tells you how the number got
                  there.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ─────────────── Recent receipts (existing marketplace) ─────────────── */}
      {projects.length > 0 && (
        <section className="space-y-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="label">Recent receipts</div>
              <h2 className="heading-lg mt-2">From the marketplace.</h2>
            </div>
            <Link
              href="/marketplace"
              className="text-sm font-medium text-primary hover:underline"
            >
              View all &rarr;
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}

      {/* ─────────────── Final CTA ─────────────── */}
      <section className="card-tokenshelf p-10 text-center">
        <div className="label">Ready when you are</div>
        <h2 className="heading-lg mx-auto mt-3 max-w-2xl">
          Install once. Save tokens. Earn the badge.
        </h2>
        <p className="body-md mx-auto mt-3 max-w-xl">
          Beta cohort onboarding now. Cost savings start the moment the
          daemon is installed; certified badge is awarded after the first
          engagement.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/auth/signin" className="btn-tokenshelf">
            Sign in with GitHub
          </Link>
          <a
            href="https://github.com/a-team/tokenshelf-agent"
            className="btn-tokenshelf-outline"
            rel="noopener noreferrer"
          >
            View the daemon source
          </a>
        </div>
      </section>
    </div>
  );
}
