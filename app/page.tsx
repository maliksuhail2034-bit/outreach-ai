import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { SiteHeader } from "@/components/marketing/site-header";
import { Hero } from "@/components/marketing/hero";
import { ProblemSection } from "@/components/marketing/problem-section";
import { Workflow } from "@/components/marketing/workflow";
import { Features } from "@/components/marketing/features";
import { ProductShowcase } from "@/components/marketing/product-showcase";
import { PricingPreview } from "@/components/marketing/pricing-preview";
import { FinalCta } from "@/components/marketing/final-cta";
import { SiteFooter } from "@/components/marketing/footer";

export default async function RootPage() {
  const user = await getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <ProblemSection />
        <Workflow />
        <Features />
        <ProductShowcase />
        <PricingPreview />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
