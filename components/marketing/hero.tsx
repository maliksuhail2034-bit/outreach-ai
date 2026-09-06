import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion/fade-in";
import { Container } from "./container";
import { ProductPreview } from "./product-preview";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <Container className="pb-16 pt-20 sm:pb-24 sm:pt-28 lg:pt-32">
        <FadeIn>
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Run cold email outreach from one workspace.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground text-balance sm:text-lg">
              Polimatiq brings your mailboxes, leads, campaigns, sequences, sending, replies, warmup, and
              analytics into one place. No more switching between five different tools.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">Get started</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="#preview">Explore the product</Link>
              </Button>
            </div>
          </div>
        </FadeIn>

        <FadeIn delay={0.15}>
          <div id="preview" className="mx-auto mt-16 max-w-5xl scroll-mt-24 sm:mt-20">
            <ProductPreview />
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
