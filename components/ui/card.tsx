import * as React from "react";
import { cn } from "@/lib/utils";

type CardProps = React.ComponentProps<"div"> & { asArticle?: boolean };

function Card({ className, asArticle = false, ...props }: CardProps) {
  const Comp = asArticle ? "article" : "div";
  return <Comp data-slot="card" className={cn("rounded-2xl border bg-card text-card-foreground", className)} {...props} />;
}

export { Card };
