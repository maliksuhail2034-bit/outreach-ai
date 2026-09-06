import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion/fade-in";
import { Container } from "./container";

export function FinalCta() {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <FadeIn>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Build your outreach operation from one workspace.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Everything you need to manage the core outreach workflow, without stitching together a complicated
              stack.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">Get started</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="#pricing">View pricing</Link>
              </Button>
            </div>
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
