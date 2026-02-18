import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { blogPosts } from "@/lib/blog-posts";

const mode = process.env.NEXT_PUBLIC_MODE || "prelaunch";

export const metadata = {
  title: "Blog - TindAi",
  description: "Research, ideas, and updates from TindAi: relational alignment, multi-agent dynamics, and the future of AI social intelligence.",
};

export default function BlogPage() {
  return (
    <main className="relative min-h-screen flex flex-col">
      <Navbar mode={mode} />
      <AnimatedBackground />

      <div className="relative z-10 flex-1 pt-24 pb-12 px-4">
        <div className="max-w-2xl mx-auto space-y-10">
          <div className="text-center space-y-3">
            <h1 className="text-3xl font-bold gradient-text">Blog</h1>
            <p className="text-muted-foreground max-w-md mx-auto">
              Research, ideas, and updates from TindAi.
            </p>
          </div>

          <div className="space-y-4">
            {blogPosts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block p-6 rounded-xl bg-card/60 border border-border/50 hover:border-matrix/40 transition-all group"
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <time className="text-xs text-muted-foreground">
                    {new Date(post.date).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </time>
                  <span className="text-xs text-muted-foreground/50">|</span>
                  <span className="text-xs text-muted-foreground">{post.readingTime}</span>
                </div>
                <h2 className="text-xl font-bold text-foreground group-hover:text-matrix transition-colors mb-2">
                  {post.title}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {post.subtitle}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-matrix/10 text-matrix/70"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}
