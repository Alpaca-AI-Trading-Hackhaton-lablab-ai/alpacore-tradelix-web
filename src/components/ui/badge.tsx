import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center rounded-md border px-2 py-0.5 font-medium text-xs transition-colors",
	{
		variants: {
			variant: {
				default: "border-transparent bg-primary text-primary-foreground",
				secondary: "border-transparent bg-secondary text-secondary-foreground",
				destructive: "border-transparent bg-destructive text-white",
				outline: "text-foreground",
				success: "border-emerald-500/30 bg-emerald-500/15 text-emerald-200",
				warning: "border-amber-500/30 bg-amber-500/15 text-amber-200",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return (
		<span
			className={cn(badgeVariants({ variant, className }))}
			data-slot="badge"
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
